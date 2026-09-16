export type SortField = 'name' | 'size' | 'date' | 'class';
export type SortDirection = 'asc' | 'desc';

export interface SortableItem {
  name: string;
  size: number;
  modifiedTimestamp: number;
  storageClass: string;
}

export function compareSortable(a: SortableItem, b: SortableItem, sortField: SortField, sortDirection: SortDirection): number {
  let cmp = 0;
  if (sortField === 'name') cmp = a.name.localeCompare(b.name);
  else if (sortField === 'size') cmp = a.size - b.size;
  else if (sortField === 'date') cmp = a.modifiedTimestamp - b.modifiedTimestamp;
  else if (sortField === 'class') cmp = a.storageClass.localeCompare(b.storageClass);
  return sortDirection === 'asc' ? cmp : -cmp;
}
