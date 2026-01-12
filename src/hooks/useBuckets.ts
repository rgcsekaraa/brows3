'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { BucketWithRegion, bucketApi, isTauri, setCacheInvalidator } from '@/lib/tauri';
import { useProfileStore } from '@/store/profileStore';

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
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes - buckets rarely change

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

export function useBuckets(options: { enabled?: boolean } = { enabled: true }): UseBucketsResult {
  const enabled = options.enabled ?? true;
  const [buckets, setBuckets] = useState<BucketWithRegion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheTimestamp, setCacheTimestamp] = useState<number | null>(null);
  const { activeProfileId } = useProfileStore();
  const fetchInProgress = useRef(false);
  const mountedRef = useRef(true);

  // Connect the cache invalidator so write operations trigger a refresh
  useEffect(() => {
    setCacheInvalidator(() => {
      invalidateBucketCache();
      setCacheTimestamp(null); // Reset UI cache state
    });
  }, []);

  const fetchBuckets = useCallback(async (skipCache = false) => {
    if (!activeProfileId) {
      setBuckets([]);
      setIsLoading(false);
      setCacheTimestamp(null);
      return;
    }

    // Check cache first for instant loading
    if (!skipCache) {
      const cached = bucketCache.get(activeProfileId);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        setBuckets(cached.data);
        setCacheTimestamp(cached.timestamp);
        setIsLoading(false);
        return;
      }
    }

    // Prevent duplicate fetches
    if (fetchInProgress.current) return;
    fetchInProgress.current = true;

    setIsLoading(true);
    setError(null);

    try {
      const data = await bucketApi.listBucketsWithRegions();
      
      if (mountedRef.current) {
        const now = Date.now();
        setBuckets(data);
        setCacheTimestamp(now);
        // Cache the result
        bucketCache.set(activeProfileId, { data, timestamp: now });
      }
    } catch (err) {
      if (mountedRef.current) {
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
      if (mountedRef.current) {
        setIsLoading(false);
      }
      fetchInProgress.current = false;
    }
  }, [activeProfileId]);

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

  const isCached = useMemo(() => {
    return cacheTimestamp !== null && !isLoading;
  }, [cacheTimestamp, isLoading]);

  // Compute cache age inline - trivial calculation, no need for useMemo
  const cacheAge = cacheTimestamp ? Date.now() - cacheTimestamp : null;

  return { buckets, isLoading, error, refresh, fetchBuckets, isCached, cacheAge };
}

