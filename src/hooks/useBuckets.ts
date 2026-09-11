'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { BucketWithRegion, bucketApi, subscribeCacheInvalidation } from '@/lib/tauri';
import { useProfileStore } from '@/store/profileStore';
import { useSettingsStore } from '@/store/settingsStore';

interface UseBucketsResult {
  buckets: BucketWithRegion[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  fetchBuckets: (skipCache?: boolean) => Promise<void>;
  isCached: boolean;
  cacheAge: number | null; // milliseconds since cache was created
}

// Cache bucket list per profile in memory for instant loading
const bucketCache = new Map<string, { data: BucketWithRegion[]; timestamp: number }>();
const bucketFetchPromises = new Map<string, Promise<BucketWithRegion[]>>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes - buckets rarely change

function fetchBucketsForProfile(profileId: string): Promise<BucketWithRegion[]> {
  const inflight = bucketFetchPromises.get(profileId);
  if (inflight) {
    return inflight;
  }

  const request = bucketApi.listBucketsWithRegions().finally(() => {
    if (bucketFetchPromises.get(profileId) === request) {
      bucketFetchPromises.delete(profileId);
    }
  });

  bucketFetchPromises.set(profileId, request);
  return request;
}

// Export for footer to access
export function getBucketCacheInfo(profileId: string | null): { timestamp: number | null; isCached: boolean } {
  if (!profileId) return { timestamp: null, isCached: false };
  const cached = bucketCache.get(profileId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { timestamp: cached.timestamp, isCached: true };
  }
  return { timestamp: null, isCached: false };
}

// Clear cache for a specific profile (call after write operations)
export function invalidateBucketCache(profileId?: string) {
  if (profileId) {
    bucketCache.delete(profileId);
  } else {
    bucketCache.clear();
  }
}

subscribeCacheInvalidation(scope => {
  invalidateBucketCache();
  if (scope === 'buckets') bucketFetchPromises.clear();
});

export function useBuckets(options: { enabled?: boolean } = { enabled: true }): UseBucketsResult {
  const enabled = options.enabled ?? true;
  const [buckets, setBuckets] = useState<BucketWithRegion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheTimestamp, setCacheTimestamp] = useState<number | null>(null);
  const { activeProfileId } = useProfileStore();
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  const fetchBuckets = useCallback(async (skipCache = false) => {
    if (!activeProfileId) {
      requestIdRef.current += 1;
      setBuckets([]);
      setIsLoading(false);
      setCacheTimestamp(null);
      return;
    }

    const profileId = activeProfileId;

    // Check cache first for instant loading
    if (!skipCache) {
      const cached = bucketCache.get(profileId);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        setBuckets(cached.data);
        setCacheTimestamp(cached.timestamp);
        setIsLoading(false);
        return;
      }
    }

    const requestId = ++requestIdRef.current;

    setIsLoading(true);
    setError(null);

    try {
      const data = await fetchBucketsForProfile(profileId);
      
      if (mountedRef.current && requestId === requestIdRef.current && useProfileStore.getState().activeProfileId === profileId) {
        const now = Date.now();
        setBuckets(data);
        setCacheTimestamp(now);
        // Cache the result
        bucketCache.set(profileId, { data, timestamp: now });
      }
    } catch (err) {
      if (mountedRef.current && requestId === requestIdRef.current && useProfileStore.getState().activeProfileId === profileId) {
        let message = 'Failed to load buckets';
        if (err instanceof Error) {
          message = err.message;
        } else if (typeof err === 'string') {
          message = err;
        } else if (err && typeof err === 'object') {
          try {
            message = JSON.stringify(err);
          } catch {
            message = String(err);
          }
        }
        
        setError(message);
        setBuckets([]);
        setCacheTimestamp(null);
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [activeProfileId]);

  useEffect(() => subscribeCacheInvalidation(scope => {
    setCacheTimestamp(null);
    if (scope === 'buckets') {
      requestIdRef.current += 1;
      if (enabled) void fetchBuckets(true);
    }
  }), [enabled, fetchBuckets]);

  const refresh = useCallback(async () => {
    // Clear cache and force refresh
    if (activeProfileId) {
      bucketCache.delete(activeProfileId);
    }
    await bucketApi.refreshS3Client();
    await fetchBuckets(true);
  }, [activeProfileId, fetchBuckets]);

  // Fetch buckets when active profile changes
  useEffect(() => {
    mountedRef.current = true;
    if (enabled) {
      fetchBuckets();
    }
    
    return () => {
      mountedRef.current = false;
    };
  }, [fetchBuckets, enabled]);

  // Refresh when tab regains visibility (user returns to app)
  const autoRefreshOnFocus = useSettingsStore(state => state.autoRefreshOnFocus);
  
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && enabled && activeProfileId && autoRefreshOnFocus) {
        // Check if cache is stale (older than 1 minute)
        const cached = bucketCache.get(activeProfileId);
        if (!cached || Date.now() - cached.timestamp > 60000) {
          fetchBuckets(true);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [enabled, activeProfileId, fetchBuckets, autoRefreshOnFocus]);

  const isCached = useMemo(() => {
    return cacheTimestamp !== null && !isLoading;
  }, [cacheTimestamp, isLoading]);

  // Compute cache age inline - trivial calculation, no need for useMemo
  const cacheAge = cacheTimestamp ? Date.now() - cacheTimestamp : null;

  return { buckets, isLoading, error, refresh, fetchBuckets, isCached, cacheAge };
}
