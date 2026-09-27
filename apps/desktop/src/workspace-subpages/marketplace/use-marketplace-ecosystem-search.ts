import { useCallback, useRef, useState } from 'react';
import type { HostCommand, HostResponse, MarketplaceSearchHit } from '@piwin/contracts';
import { isMarketplaceSearchResult } from '@piwin/contracts';

export type MarketplaceEcosystemSearch = {
  hits: MarketplaceSearchHit[];
  loading: boolean;
  error: string | null;
  searchedQuery: string;
  browse: (limit?: number) => Promise<void>;
  search: (query: string) => Promise<void>;
  reset: () => void;
};

export type UseMarketplaceEcosystemSearchOptions = {
  request: (command: HostCommand) => Promise<HostResponse>;
  onError?: ((error: string) => void) | undefined;
};

export function useMarketplaceEcosystemSearch(
  options: UseMarketplaceEcosystemSearchOptions,
): MarketplaceEcosystemSearch {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [hits, setHits] = useState<MarketplaceSearchHit[]>([]);
  const [browseHits, setBrowseHits] = useState<MarketplaceSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedQuery, setSearchedQuery] = useState('');
  const requestSequence = useRef(0);

  const browse = useCallback(async (limit = 4): Promise<void> => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const response = await optionsRef.current.request({
        type: 'marketplace/search',
        query: '',
        limit,
      });
      if (sequence !== requestSequence.current) return;
      if (!response.success) {
        setError(response.error);
        return;
      }
      const nextHits = isMarketplaceSearchResult(response.data) ? response.data.hits : [];
      setBrowseHits(nextHits);
      setHits(nextHits);
      setError(
        isMarketplaceSearchResult(response.data) ? (response.data.remoteError ?? null) : null,
      );
    } catch (caught: unknown) {
      if (sequence === requestSequence.current) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, []);

  const search = useCallback(
    async (rawQuery: string): Promise<void> => {
      const trimmed = rawQuery.trim();
      if (!trimmed) {
        setHits(browseHits);
        setError(null);
        setLoading(false);
        setSearchedQuery('');
        return;
      }

      const sequence = ++requestSequence.current;
      setSearchedQuery(trimmed);
      setLoading(true);
      setError(null);

      try {
        const response = await optionsRef.current.request({
          type: 'marketplace/search',
          query: trimmed,
        });
        if (sequence !== requestSequence.current) return;
        if (!response.success) {
          setHits([]);
          setError(response.error);
          optionsRef.current.onError?.(response.error);
          return;
        }

        const data = isMarketplaceSearchResult(response.data)
          ? response.data
          : { query: trimmed, hits: [] as MarketplaceSearchHit[] };
        setHits(data.hits);
        const remoteError = data.remoteError ?? null;
        setError(remoteError);
        if (remoteError) {
          optionsRef.current.onError?.(remoteError);
        }
      } catch (caught: unknown) {
        if (sequence !== requestSequence.current) return;
        const message = caught instanceof Error ? caught.message : String(caught);
        setHits([]);
        setError(message);
        optionsRef.current.onError?.(message);
      } finally {
        if (sequence === requestSequence.current) setLoading(false);
      }
    },
    [browseHits],
  );

  const reset = useCallback((): void => {
    requestSequence.current += 1;
    setHits(browseHits);
    setError(null);
    setLoading(false);
    setSearchedQuery('');
  }, [browseHits]);

  return { hits, loading, error, searchedQuery, browse, search, reset };
}
