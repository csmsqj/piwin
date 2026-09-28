/**
 * Short, secret-free description of a rejected provider HTTP response.
 * Shared by discovery, single-model tests, and the connection test so every
 * probe explains a failure the same way (status + provider's own message).
 */
const MAX_RAW_SNIPPET = 180;

export async function formatProviderHttpFailure(response: Response): Promise<string> {
  const status = `${response.status} ${response.statusText || 'request rejected'}`.trim();
  let raw = '';
  try {
    raw = (await response.text()).trim();
  } catch {
    return status;
  }
  if (!raw) {
    return status;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const message = readProviderErrorMessage(parsed);
    if (message) {
      return `${status}: ${message}`;
    }
  } catch {
    // Keep a short raw snippet for gateways that return plain text.
  }
  if (raw.startsWith('<') || /<html[\s>]/i.test(raw) || /<!doctype html/i.test(raw)) {
    return status;
  }
  return `${status}: ${raw.slice(0, MAX_RAW_SNIPPET)}`;
}

function readProviderErrorMessage(payload: unknown): string | null {
  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim();
  }
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error.trim()) {
    return record.error.trim();
  }
  if (record.error && typeof record.error === 'object') {
    const nested = record.error as Record<string, unknown>;
    if (typeof nested.message === 'string' && nested.message.trim()) {
      return nested.message.trim();
    }
  }
  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message.trim();
  }
  return null;
}
