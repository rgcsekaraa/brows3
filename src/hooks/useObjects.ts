'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ListObjectsResult, objectApi, S3Object } from '@/lib/tauri';
import { useProfileStore } from '@/store/profileStore';

interface BucketStats {
  isCached: boolean;
}

interface UseObjectsResult {
  data: ListObjectsResult | null;
  isLoading: boolean;
  error: string | null;
  stats: BucketStats;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  isLoadingMore: boolean;
  hasMore: boolean;
}

export function useObjects(bucketName: string, bucketRegion?: string, prefix = ''): UseObjectsResult {
  const [data, setData] = useState<ListObjectsResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<BucketStats>({ 
    isCached: false, 
  });
  
  const { activeProfileId } = useProfileStore();
  
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [continuationToken, setContinuationToken] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  
  const lastKey = useRef<string>('');
  const fetchInProgress = useRef(false);

  // Core fetch function
  const fetchItems = useCallback(async (bypassCache = false) => {
    if (!bucketName || !activeProfileId) return null;
    
    fetchInProgress.current = true;
    setIsLoading(true);
    setError(null);

    // If refreshing/bypassing cache, reset pagination state immediately
    // effectively blocking loadMore until refresh completes
    if (bypassCache) {
      setContinuationToken(null);
      setHasMore(false);
    }

    try {
      const result = await objectApi.listObjects(bucketName, bucketRegion, prefix, '/', undefined, bypassCache);
      setData(result);
      setContinuationToken(result.next_continuation_token || null);
      setHasMore(!!result.next_continuation_token);
      return result;
    } catch (err: any) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`Failed to load bucket "${bucketName}" with prefix "${prefix}":`, err);
      }
      
      let msg = 'Failed to load objects';
      if (err instanceof Error) {
        msg = err.message;
      } else if (typeof err === 'string') {
        msg = err;
      } else if (typeof err === 'object' && err !== null) {
        if (err.message) {
          msg = err.message;
        } else if (err.error) {
          msg = typeof err.error === 'string' ? err.error : JSON.stringify(err.error);
        } else if (err.toString && err.toString() !== '[object Object]') {
          msg = err.toString();
        } else {
          try {
            const jsonStr = JSON.stringify(err);
            msg = jsonStr !== '{}' ? jsonStr : 'Access denied or bucket not found';
          } catch {
            msg = 'Access denied or bucket not found';
          }
        }
      }
      setError(msg);
      return null;
    } finally {
      setIsLoading(false);
      fetchInProgress.current = false;
    }
  }, [bucketName, bucketRegion, prefix, activeProfileId]);

  useEffect(() => {
    let cancelled = false;
    const currentKey = `${activeProfileId}:${bucketName}:${prefix}`;
    
    if (lastKey.current === currentKey) return;

    lastKey.current = currentKey;

    // Fast state reset for navigation
    setData(null);
    setIsLoading(true);
    setContinuationToken(null);
    setHasMore(false);

    const run = async () => {
      await fetchItems(false);
      if (!cancelled) {
        setStats({ isCached: true });
      }
    };

    run();

    return () => { cancelled = true; };
  }, [bucketName, bucketRegion, prefix, activeProfileId, fetchItems]);

  const loadMore = useCallback(async () => {
    if (!bucketName || !activeProfileId || !continuationToken || isLoadingMore || fetchInProgress.current) return;
    
    setIsLoadingMore(true);
    try {
       const result = await objectApi.listObjects(bucketName, bucketRegion, prefix, '/', continuationToken);
       setData(prev => {
         if (!prev) return result;
         const uniquePrefixes = Array.from(new Set([...prev.common_prefixes, ...result.common_prefixes]));
         return {
           ...result,
           objects: [...prev.objects, ...result.objects],
           common_prefixes: uniquePrefixes,
           prefix: prev.prefix
         };
       });
       setContinuationToken(result.next_continuation_token || null);
       setHasMore(!!result.next_continuation_token);
    } catch (err) {
       console.error('Load more error:', err);
    } finally {
       setIsLoadingMore(false);
    }
  }, [bucketName, bucketRegion, prefix, activeProfileId, continuationToken, isLoadingMore]);

  const refresh = useCallback(async () => {
    if (!bucketName || !activeProfileId) return;
    // Clear data immediately to show loading state
    setData(null);
    await fetchItems(true);
  }, [bucketName, bucketRegion, prefix, activeProfileId, fetchItems]);

  return { data, isLoading, error, stats, refresh, loadMore, hasMore, isLoadingMore };
}
