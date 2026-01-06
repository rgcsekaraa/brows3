'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { BucketWithRegion, bucketApi, isTauri } from '@/lib/tauri';
import { useProfileStore } from '@/store/profileStore';

interface UseBucketsResult {
  buckets: BucketWithRegion[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// Cache bucket list per profile in memory for instant loading
const bucketCache = new Map<string, { data: BucketWithRegion[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function useBuckets(): UseBucketsResult {
  const [buckets, setBuckets] = useState<BucketWithRegion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { activeProfileId } = useProfileStore();
  const fetchInProgress = useRef(false);
  const mountedRef = useRef(true);

  const fetchBuckets = useCallback(async (skipCache = false) => {
    if (!activeProfileId) {
      setBuckets([]);
      setIsLoading(false);
      return;
    }

    // Check cache first for instant loading
    if (!skipCache) {
      const cached = bucketCache.get(activeProfileId);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        setBuckets(cached.data);
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
        setBuckets(data);
        // Cache the result
        bucketCache.set(activeProfileId, { data, timestamp: Date.now() });
      }
    } catch (err) {
      if (mountedRef.current) {
        const message = err instanceof Error ? err.message : 'Failed to load buckets';
        setError(message);
        setBuckets([]);
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
    fetchBuckets();
    
    return () => {
      mountedRef.current = false;
    };
  }, [fetchBuckets]);

  return { buckets, isLoading, error, refresh };
}
