'use client';
import { useEffect } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useRouter } from 'next/navigation';
import { SavedJob } from '@/lib/tauri';
import { toast } from '@/store/toastStore';

export function useSavedJobEvents() {
  const router = useRouter();
  useEffect(() => {
    if (!('__TAURI__' in window)) return;
    let stopped = false;
    const unlisteners: UnlistenFn[] = [];
    const keep = (stop: UnlistenFn) => { if (stopped) stop(); else unlisteners.push(stop); };
    void listen<SavedJob>('saved-job-finished', ({ payload: job }) => {
      if (stopped) return;
      const notify = job.last_run?.status === 'Completed' ? toast.success : toast.error;
      notify(`${job.config.name}: ${job.last_run?.status ?? 'Finished'}`, job.last_run?.message, { label: 'View jobs', onClick: () => router.push('/jobs') });
    }).then(keep).catch(error => console.warn('Job notifications unavailable:', error));
    void listen<string>('saved-job-storage-error', ({ payload }) => { if (!stopped) toast.error(payload); }).then(keep).catch(error => console.warn('Job storage notifications unavailable:', error));
    return () => { stopped = true; unlisteners.forEach(stop => stop()); };
  }, [router]);
}
