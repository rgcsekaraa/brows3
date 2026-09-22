// Shared table/preview ordering adapted from @antonp2k's PR #39.
export type SortField = 'name' | 'size' | 'date' | 'class';
export type SortDirection = 'asc' | 'desc';
export interface SortableItem {
  name: string;
  size: number;
  modifiedTimestamp: number;
  storageClass: string;
}
export function compareSortable(a: SortableItem, b: SortableItem, field: SortField, direction: SortDirection): number {
  let cmp = 0;
  if (field === 'name') cmp = a.name.localeCompare(b.name);
  else if (field === 'size') cmp = a.size - b.size;
  else if (field === 'date') cmp = (Number.isFinite(a.modifiedTimestamp) ? a.modifiedTimestamp : 0) - (Number.isFinite(b.modifiedTimestamp) ? b.modifiedTimestamp : 0);
  else cmp = a.storageClass.localeCompare(b.storageClass);
  return direction === 'asc' ? cmp : -cmp;
}
