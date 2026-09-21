import type { TransferJob } from './tauri';

export function transferSpeed(job: TransferJob): number {
  const rate = job.bytes_per_second ?? 0;
  return job.status === 'InProgress' && Number.isFinite(rate) && rate > 0 ? rate : 0;
}

export function totalTransferSpeed(jobs: TransferJob[], type?: TransferJob['transfer_type']): number {
  return jobs.reduce((sum, job) => sum + ((!type || job.transfer_type === type) && !job.is_group_root ? transferSpeed(job) : 0), 0);
}

export function formatTransferSpeed(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '0 B/s';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
  const unit = Math.min(Math.floor(Math.log(rate) / Math.log(1024)), units.length - 1);
  const index = Math.max(0, unit);
  return `${(rate / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
