/**
 * Unified knowledge-base Host commands (registry, search, open-source, session mount).
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { HostCommand, HostResponse, KnowledgeCitation } from '@piwin/contracts';
import { formatError, isRedactedStoredSecret, parseKnowledgeBaseId } from '@piwin/contracts';
import { isPathConfined, isSafeRelativePath } from '@piwin/doc-rag';
import { getSessionRecord, upsertSessionRecord } from '@piwin/session';
import { fail, ok } from '../response-helpers.js';
import { sessionIndexUpdatedPush } from '../session-index-push.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import type { KnowledgeCommandContext } from './knowledge-commands.js';
import {
  addFolderKnowledgeBase,
  assertKnownKnowledgeBaseIds,
  KnowledgeBaseCommandError,
  listKnowledgeBaseSummaries,
  removeKnowledgeBase,
  renameKnowledgeBase,
  touchKnowledgeBases,
  type KnowledgeBaseRuntime,
} from '../knowledge-base-service.js';
import { searchKnowledgeBases } from '../knowledge-retriever.js';
import { KnowledgePathEscapeError, readConfinedLineWindow } from '../knowledge-tools.js';
import { getWikiOverview, readWikiConcept } from '../wiki-service.js';
import { distillWikiConcept, WikiDistillError } from '../wiki-distill.js';
import { testKnowledgeConnection } from '../knowledge-connection-test.js';
import { resolveKnowledgeHttpApiKey } from '../notes-embedding-secret.js';
import { createSecretResolver, type SecretResolver } from '../secret-resolver.js';
import { discoverProviderModels } from '../provider-model-discovery.js';

const TYPES = new Set<HostCommand['type']>([
  'knowledge/bases/list',
  'knowledge/bases/add',
  'knowledge/bases/rename',
  'knowledge/bases/remove',
  'knowledge/search',
  'knowledge/open-source',
  'session/set-knowledge-bases',
  'knowledge/wiki/overview',
  'knowledge/wiki/concept',
  'knowledge/wiki/distill',
  'knowledge/test-connection',
  'knowledge/embedding-models/discover',
]);

export function isKnowledgeBaseCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export function knowledgeRuntimeFromContext(context: KnowledgeCommandContext): KnowledgeBaseRuntime {
  return {
    ...(context.piwinRoot !== undefined ? { piwinRoot: context.piwinRoot } : {}),
    getFolderRag: context.getFolderRag,
    getNotesServices: context.getNotesServices,
    loadConfig: context.loadConfig,
    ...(context.ingestionJobs
      ? { isIndexing: (key) => context.ingestionJobs?.isRunning(key) === true }
      : {}),
    getCardStore: context.getCardStore,
  };
}

export async function publishKnowledgeBasesChanged(
  context: KnowledgeCommandContext,
): Promise<void> {
  if (!context.push) return;
  try {
    const bases = await listKnowledgeBaseSummaries(knowledgeRuntimeFromContext(context));
    context.push({ type: 'knowledge/bases-changed', bases });
  } catch (error) {
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `knowledge/bases-changed failed: ${formatError(error)}`,
    });
  }
}

export async function handleKnowledgeBaseCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: KnowledgeCommandContext,
): Promise<HostResponse | null> {
  if (!isKnowledgeBaseCommand(command)) return null;
  const runtime = knowledgeRuntimeFromContext(context);
  try {
    switch (command.type) {
      case 'knowledge/bases/list': {
        const bases = await listKnowledgeBaseSummaries(runtime);
        return ok(requestId, command.type, { bases });
      }
      case 'knowledge/bases/add': {
        const base = await addFolderKnowledgeBase(runtime, command.folderPath, command.name);
        await publishKnowledgeBasesChanged(context);
        return ok(requestId, command.type, { base });
      }
      case 'knowledge/bases/rename': {
        const base = await renameKnowledgeBase(runtime, command.baseId, command.name);
        await publishKnowledgeBasesChanged(context);
        return ok(requestId, command.type, { base });
      }
      case 'knowledge/bases/remove': {
        await removeKnowledgeBase(runtime, command.baseId, command.deleteIndex);
        await publishKnowledgeBasesChanged(context);
        return ok(requestId, command.type, { removed: true, baseId: command.baseId });
      }
      case 'knowledge/search': {
        const result = await searchKnowledgeBases(runtime, {
          query: command.query,
          ...(command.baseIds ? { baseIds: command.baseIds } : {}),
          ...(command.tags ? { tags: command.tags } : {}),
          ...(command.limit !== undefined ? { limit: command.limit } : {}),
        });
        return ok(requestId, command.type, result);
      }
      case 'knowledge/open-source': {
        const result = await openKnowledgeSource(runtime, command.citation, command.openFile === true);
        return ok(requestId, command.type, result);
      }
      case 'session/set-knowledge-bases': {
        const uniqueIds = uniqueBaseIds(command.baseIds);
        await assertKnownKnowledgeBaseIds(runtime, uniqueIds);
        const session = await persistSessionKnowledgeBases(
          context,
          command.sessionId,
          uniqueIds,
        );
        await touchKnowledgeBases(runtime, uniqueIds);
        context.push?.(
          sessionIndexUpdatedPush({
            op: 'updated',
            sessionId: command.sessionId,
            session,
          }),
        );
        await publishKnowledgeBasesChanged(context);
        return ok(requestId, command.type, { sessionId: command.sessionId, baseIds: uniqueIds });
      }
      case 'knowledge/wiki/overview': {
        const overview = await getWikiOverview(runtime.piwinRoot);
        return ok(requestId, command.type, overview);
      }
      case 'knowledge/wiki/concept': {
        const concept = await readWikiConcept(runtime.piwinRoot, command.slug);
        if (!concept) {
          return fail(requestId, command.type, `Wiki concept not found: ${command.slug}`);
        }
        return ok(requestId, command.type, { concept });
      }
      case 'knowledge/wiki/distill': {
        if (!context.completeJson) {
          return fail(
            requestId,
            command.type,
            'No model is configured for distillation. Set one in Settings → Models.',
          );
        }
        const bases = await listKnowledgeBaseSummaries(runtime);
        const base = bases.find((entry) => entry.id === command.baseId);
        if (!base) {
          return fail(requestId, command.type, `Unknown knowledge base: ${command.baseId}`);
        }
        if (!base.folderPath) {
          return fail(requestId, command.type, `${base.name} has no indexed folder to distil.`);
        }
        const rag = await runtime.getFolderRag();
        // Retrieval, not a raw file dump: the pack is already deduped, ranked
        // and budgeted, which is exactly what the synthesis prompt wants.
        const pack = await rag.retrievePack(
          base.folderPath,
          command.topic?.trim() || base.name,
          { limit: 12 },
        );
        const result = await distillWikiConcept({
          piwinRoot: runtime.piwinRoot,
          base,
          sources: pack.sources.map((source) => ({
            relativePath: source.relativePath,
            text: source.text,
          })),
          ...(command.topic ? { topic: command.topic } : {}),
          completeJson: context.completeJson,
        });
        await publishKnowledgeBasesChanged(context);
        return ok(requestId, command.type, result);
      }
      case 'knowledge/test-connection': {
        return await testKnowledgeConnectionCommand(command, requestId, context);
      }
      case 'knowledge/embedding-models/discover': {
        return await discoverKnowledgeEmbeddingModels(command, requestId, context);
      }
      default:
        return null;
    }
  } catch (error) {
    if (
      error instanceof KnowledgeBaseCommandError ||
      error instanceof KnowledgePathEscapeError ||
      error instanceof WikiDistillError
    ) {
      return fail(requestId, command.type, error.message);
    }
    throw error;
  }
}

/**
 * Connectivity probe for one knowledge endpoint. The endpoint itself is the
 * caller's draft (the button exists to test before saving), so `baseUrl` and
 * `model` always come from the command.
 *
 * Credentials keep the Host-owned rule: a one-shot `apiKey` typed in the form
 * wins, otherwise `apiKeyRef` / `apiKeyEnv` are resolved here so a stored key
 * never has to be pulled back into the renderer.
 */
async function testKnowledgeConnectionCommand(
  command: Extract<HostCommand, { type: 'knowledge/test-connection' }>,
  requestId: string | undefined,
  context: KnowledgeCommandContext,
): Promise<HostResponse> {
  try {
    const oneShotApiKey = command.apiKey?.trim();
    const auth = oneShotApiKey ? {} : await resolveKnowledgeConnectionAuth(command, context);
    const apiKey =
      oneShotApiKey && oneShotApiKey.length > 0
        ? oneShotApiKey
        : await resolveKnowledgeHttpApiKey(auth, knowledgeSecretResolver(context));

    const result = await testKnowledgeConnection({
      kind: command.kind,
      baseUrl: command.baseUrl,
      ...(command.provider !== undefined ? { provider: command.provider } : {}),
      ...(command.model !== undefined ? { model: command.model } : {}),
      ...(apiKey ? { apiKey } : {}),
    });
    return ok(requestId, command.type, result);
  } catch (error) {
    return fail(requestId, command.type, formatError(error));
  }
}

async function discoverKnowledgeEmbeddingModels(
  command: Extract<HostCommand, { type: 'knowledge/embedding-models/discover' }>,
  requestId: string | undefined,
  context: KnowledgeCommandContext,
): Promise<HostResponse> {
  try {
    const oneShotApiKey = command.apiKey?.trim();
    const auth = oneShotApiKey ? {} : await resolveKnowledgeConnectionAuth(command, context);
    const secretResolver = knowledgeSecretResolver(context);
    const result = await discoverProviderModels(
      {
        id: 'notes-embedding',
        name: 'Knowledge embedding',
        protocol: 'openai-compatible',
        baseUrl: command.baseUrl,
        models: [],
      },
      {
        resolveSecret: async () =>
          oneShotApiKey || (await resolveKnowledgeHttpApiKey(auth, secretResolver)) || null,
      },
    );
    return ok(requestId, command.type, result);
  } catch (error) {
    return fail(requestId, command.type, formatError(error));
  }
}

/** Remote settings hide secret refs; recover only placeholders from Host config. */
async function resolveKnowledgeConnectionAuth(
  command: {
    apiKeyRef?: string;
    apiKeyEnv?: string;
    kind?: string;
  },
  context: KnowledgeCommandContext,
): Promise<{ apiKeyRef?: string; apiKeyEnv?: string }> {
  let apiKeyRef = command.apiKeyRef;
  let apiKeyEnv = command.apiKeyEnv;
  if (
    (command.kind === undefined || command.kind === 'embedding') &&
    (isRedactedStoredSecret(apiKeyRef) || isRedactedStoredSecret(apiKeyEnv))
  ) {
    const config = await context.loadConfig();
    const saved = config.notes?.embedding ?? config.knowledge?.embedding;
    if (isRedactedStoredSecret(apiKeyRef)) apiKeyRef = saved?.apiKeyRef;
    if (isRedactedStoredSecret(apiKeyEnv)) apiKeyEnv = saved?.apiKeyEnv;
  }
  return {
    ...(apiKeyRef && !isRedactedStoredSecret(apiKeyRef) ? { apiKeyRef } : {}),
    ...(apiKeyEnv && !isRedactedStoredSecret(apiKeyEnv) ? { apiKeyEnv } : {}),
  };
}

/** The Host owns the stored key; a test may inject a file-store-only resolver. */
function knowledgeSecretResolver(
  context: KnowledgeCommandContext,
): Pick<SecretResolver, 'readSecretByRef'> {
  return (
    context.secretResolver ?? createSecretResolver({ piwinRoot: getPiwinRoot(context.piwinRoot) })
  );
}

function uniqueBaseIds(baseIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of baseIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

async function persistSessionKnowledgeBases(
  context: KnowledgeCommandContext,
  sessionId: string,
  baseIds: string[],
): Promise<ReturnType<typeof indexRecordToSummary>> {
  const indexPath = getPiwinSessionIndexPath(getPiwinRoot(context.piwinRoot));
  const record = await getSessionRecord(indexPath, sessionId);
  if (!record) {
    throw new KnowledgeBaseCommandError(`Unknown session: ${sessionId}`);
  }
  if (baseIds.length > 0) {
    record.knowledgeBaseIds = baseIds;
  } else {
    delete record.knowledgeBaseIds;
  }
  record.updatedAt = new Date().toISOString();
  await upsertSessionRecord(indexPath, record);
  return indexRecordToSummary(record);
}

async function openKnowledgeSource(
  runtime: KnowledgeBaseRuntime,
  citation: KnowledgeCitation,
  openFile: boolean,
): Promise<
  | { kind: 'notes'; noteId: string }
  | {
      kind: 'folder';
      absolutePath: string;
      startLine?: number;
      pageStart?: number;
      opened: boolean;
    }
> {
  const parsed = parseKnowledgeBaseId(citation.baseId);
  if (parsed?.kind === 'notes' || citation.kind === 'notes') {
    const noteId = citation.noteId?.trim();
    if (!noteId) {
      throw new KnowledgeBaseCommandError('noteId is required');
    }
    if (!runtime.getNotesServices) {
      throw new KnowledgeBaseCommandError('Notes services are not available');
    }
    const services = await runtime.getNotesServices();
    await services.store.read(noteId);
    return { kind: 'notes', noteId };
  }
  const relativePath = citation.relativePath?.trim();
  if (!relativePath) {
    throw new KnowledgeBaseCommandError('relativePath is required');
  }
  const bases = await listKnowledgeBaseSummaries(runtime);
  const base = bases.find((item) => item.id === citation.baseId);
  const folderPath = base?.folderPath;
  if (!folderPath) {
    throw new KnowledgeBaseCommandError(`Unknown folder knowledge base: ${citation.baseId}`);
  }
  if (!isSafeRelativePath(relativePath) || !(await isPathConfined(folderPath, relativePath))) {
    throw new KnowledgePathEscapeError(relativePath);
  }
  await readConfinedLineWindow(folderPath, relativePath, citation.startLine, citation.endLine);
  const absolutePath = join(folderPath, relativePath);
  const opened = openFile ? openLocalPath(absolutePath) : false;
  const result: {
    kind: 'folder';
    absolutePath: string;
    startLine?: number;
    pageStart?: number;
    opened: boolean;
  } = { kind: 'folder', absolutePath, opened };
  if (citation.startLine !== undefined) result.startLine = citation.startLine;
  if (citation.pageStart !== undefined) result.pageStart = citation.pageStart;
  return result;
}

function openLocalPath(absolutePath: string): boolean {
  const [cmd, args] =
    process.platform === 'darwin'
      ? (['open', [absolutePath]] as const)
      : process.platform === 'win32'
        ? (['cmd', ['/c', 'start', '', absolutePath]] as const)
        : (['xdg-open', [absolutePath]] as const);
  spawn(cmd, args, { stdio: 'ignore', detached: true })
    .on('error', () => undefined)
    .unref();
  return true;
}
