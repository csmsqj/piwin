/**
 * Generation-only DuckDuckGo floor.
 *
 * A chat model without native search and with every search source off used to
 * drop `web_search` before the model could call it. This copy enables
 * DuckDuckGo for route resolution and the tool executor. It does not write the
 * settings switch.
 */

import type {
  ModelConfigEntry,
  SearchRoutePolicy,
  WebConfig,
  WebSearchSource,
} from '@piwin/contracts';
import { inferSearchRoutePolicy } from '@piwin/contracts';
import {
  evaluateSearchReadiness,
  type NativeSearchAdapterSupport,
} from './search-route-resolver.js';

type FloorWebConfig = Pick<WebConfig, 'searchSources'> &
  Partial<Pick<WebConfig, 'searchRoutePolicy' | 'searchDelegateModel'>>;

export function webConfigWithDuckDuckGoFloor<T extends FloorWebConfig>(
  web: T,
  input: {
    model?: Pick<ModelConfigEntry, 'id' | 'enabled' | 'capabilities'> | null;
    adapter: NativeSearchAdapterSupport;
    /** Route policy for this generation when it overrides the saved web policy. */
    policy?: SearchRoutePolicy;
  },
): T {
  if (web.searchDelegateModel) {
    return web;
  }
  const sources = web.searchSources ?? [];
  const policy = input.policy ?? inferSearchRoutePolicy(web.searchRoutePolicy, sources);
  if (policy === 'native-only') {
    return web;
  }
  if (sources.some((source) => source.enabled)) {
    return web;
  }
  const nativeReady = evaluateSearchReadiness({
    policy,
    ...(input.model === undefined ? {} : { model: input.model }),
    adapter: input.adapter,
    web,
  }).native.ready;
  if (nativeReady) {
    return web;
  }
  return {
    ...web,
    searchSources: enableDuckDuckGo(sources),
  };
}

function enableDuckDuckGo(sources: readonly WebSearchSource[]): WebSearchSource[] {
  const index = sources.findIndex((source) => source.kind === 'duckduckgo');
  if (index < 0) {
    return [{ id: 'duckduckgo', kind: 'duckduckgo', enabled: true }, ...sources];
  }
  return sources.map((source, sourceIndex) =>
    sourceIndex === index ? { ...source, enabled: true } : source,
  );
}
