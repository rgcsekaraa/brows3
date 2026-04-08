import { useState, useEffect, useCallback, useRef } from 'react';
import { ListObjectsResult, objectApi } from '@/lib/tauri';
import { useProfileStore } from '@/store/profileStore';
import { useAppStore } from '@/store/appStore';
import { useSettingsStore } from '@/store/settingsStore';

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
  
  const fetchIdRef = useRef(0);
  const lastDataKeyRef = useRef<string>('');
  const viewKeyRef = useRef<string>('');
  const loadedViewKeyRef = useRef<string>('');
  const fetchInProgress = useRef(false);

  // Core fetch function
  const fetchItems = useCallback(async (bypassCache = false) => {
    if (!bucketName || !activeProfileId) return null;
    
    const currentFetchId = ++fetchIdRef.current;
    const currentViewKey = `${activeProfileId}:${bucketName}:${prefix}`;
    const activeRegion = useAppStore.getState().discoveredRegions[bucketName] || bucketRegion;
    fetchInProgress.current = true;
    setIsLoading(true);
    setError(null);

    const key = `${bucketName}/${prefix}`;
    if (key !== lastDataKeyRef.current) {
        setData(null);
        lastDataKeyRef.current = key;
    }

    if (bypassCache) {
      setContinuationToken(null);
      setHasMore(false);
    }

    try {
      const result = await objectApi.listObjects(bucketName, activeRegion, prefix, '/', undefined, bypassCache);
      
      // RACING CONDITION FIX:
      // If a new fetch started while we were awaiting, ignore this result.
      if (currentFetchId !== fetchIdRef.current || currentViewKey !== viewKeyRef.current) {
          return null;
      }

      setData(result);
      setContinuationToken(result.next_continuation_token || null);
      setHasMore(!!result.next_continuation_token);
      loadedViewKeyRef.current = currentViewKey;

      if (result.bucket_region) {
          useAppStore.getState().setDiscoveredRegion(bucketName, result.bucket_region);
      }
      
      return result;
    } catch (err: any) {
      if (currentFetchId !== fetchIdRef.current || currentViewKey !== viewKeyRef.current) return null;

      if (process.env.NODE_ENV === 'development') {
        console.warn(`Failed to load bucket "${bucketName}" with prefix "${prefix}":`, err);
      }
      setError(err.message || String(err));
      return null;
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setIsLoading(false);
        fetchInProgress.current = false;
      }
    }
  }, [bucketName, bucketRegion, prefix, activeProfileId]);

  useEffect(() => {
    let cancelled = false;
    const currentKey = `${activeProfileId}:${bucketName}:${prefix}`;
    
    if (loadedViewKeyRef.current === currentKey) {
      return;
    }

    viewKeyRef.current = currentKey;

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
    return () => {
      cancelled = true;
      if (viewKeyRef.current === currentKey) {
        viewKeyRef.current = '';
      }
    };
  }, [bucketName, prefix, activeProfileId, fetchItems]);

  // Track last fetch time
  const lastFetchTime = useRef<number>(0);

  // Refresh when tab regains visibility (user returns to app)
  const autoRefreshOnFocus = useSettingsStore(state => state.autoRefreshOnFocus);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && bucketName && activeProfileId && autoRefreshOnFocus) {
        // Only refresh if last fetch was > 30 seconds ago
        const now = Date.now();
        if (now - lastFetchTime.current > 30000) {
          lastFetchTime.current = now;
          fetchItems(true);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [bucketName, activeProfileId, fetchItems, autoRefreshOnFocus]);

  const loadMore = useCallback(async () => {
    if (!bucketName || !activeProfileId || !continuationToken || isLoadingMore || fetchInProgress.current) return;
    
    const currentViewKey = `${activeProfileId}:${bucketName}:${prefix}`;
    const activeRegion = useAppStore.getState().discoveredRegions[bucketName] || bucketRegion;
    const currentFetchId = fetchIdRef.current;
    const requestToken = continuationToken;
    setIsLoadingMore(true);
    try {
       const result = await objectApi.listObjects(bucketName, activeRegion, prefix, '/', requestToken);
       if (currentViewKey !== viewKeyRef.current || currentFetchId !== fetchIdRef.current) {
         return;
       }
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
    setData(null);
    await fetchItems(true);
  }, [bucketName, activeProfileId, fetchItems]);

  return { data, isLoading, error, stats, refresh, loadMore, hasMore, isLoadingMore };
}
