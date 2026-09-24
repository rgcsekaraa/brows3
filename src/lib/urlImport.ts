export interface UrlImportEntry {
  max_attempts: number;
  url: string;
  path: string;
  headers: Record<string, string>;
  replace: boolean;
  sha256: string | null;
  max_bytes: number;
}
export const MAX_URL_IMPORTS = 500;
export const DEFAULT_URL_LIMIT = 50 * 1024 ** 3;
export const MAX_MANIFEST_BYTES = 2 * 1024 ** 2;

export function validateHttpUrl(value: string): string {
  if (value.length > 16384 || /[\u0000-\u0020\u007f]/.test(value)) return 'URL contains whitespace/control characters or is too long.';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return 'Use an HTTP or HTTPS URL without embedded credentials.';
    if (url.hash) return 'Remove the URL fragment.';
  } catch { return 'Enter a valid absolute HTTP or HTTPS URL.'; }
  return '';
}
export function validateImport(entry: UrlImportEntry): string {
  if (!Number.isInteger(entry.max_attempts) || entry.max_attempts < 1 || entry.max_attempts > 5) return 'Download attempts must be between 1 and 5.';
  const error = validateHttpUrl(entry.url); if (error) return error;
  if (!entry.path || /[\\\u0000-\u001f\u007f]/.test(entry.path) || entry.path.split('/').some(p => !p || p === '.' || p === '..')) return 'Enter a relative filename/path without empty or dot segments.';
  if (new TextEncoder().encode(entry.path).length > 1024) return 'Destination path exceeds 1,024 bytes.';
  if (!Number.isSafeInteger(entry.max_bytes) || entry.max_bytes <= 0 || entry.max_bytes > 5 * 1024 ** 4) return 'Size limit must be between 1 byte and 5 TiB.';
  if (entry.sha256 && !/^[a-f\d]{64}$/i.test(entry.sha256)) return 'SHA-256 must contain 64 hexadecimal characters.';
  if (!entry.headers || typeof entry.headers !== 'object' || Array.isArray(entry.headers) || Object.keys(entry.headers).length > 20) return 'Headers must be an object with at most 20 entries.';
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(entry.headers)) {
    const lower = name.toLowerCase();
    if (seen.has(lower) || !/^[!#$%&'*+.^_`|~\w-]+$/.test(name) || typeof value !== 'string' || /[\r\n\u0000]/.test(value) || value.length > 8192) return 'Invalid or duplicate source header.';
    if (['host','connection','content-length','transfer-encoding','range','if-range','accept-encoding','proxy-authorization','proxy-connection','cookie','upgrade','te','trailer'].includes(lower)) return 'A source header is reserved by the downloader.';
    seen.add(lower);
  }
  return '';
}
function entry(value: unknown): UrlImportEntry {
  const row = typeof value === 'string' ? { url: value } : value;
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Each entry must be a URL string or an object.');
  const data = row as Record<string, unknown>;
  if (Object.keys(data).some(k => !['url','path','headers','replace','sha256','max_bytes','max_attempts'].includes(k))) throw new Error('Unknown import field. Use url, path, headers, replace, sha256, max_bytes or max_attempts.');
  if (typeof data.url !== 'string' || (data.path !== undefined && typeof data.path !== 'string')) throw new Error('URL and destination path must be text.');
  if (data.replace !== undefined && typeof data.replace !== 'boolean') throw new Error('replace must be true or false.');
  if (data.sha256 !== undefined && data.sha256 !== null && typeof data.sha256 !== 'string') throw new Error('sha256 must be text.');
  let name = '';
  try { name = decodeURIComponent(new URL(data.url).pathname.split('/').pop() || ''); } catch { /* Report in review without dropping the row. */ }
  return { url: data.url.trim(), path: (data.path as string | undefined) ?? name, headers: (data.headers ?? {}) as Record<string,string>, replace: (data.replace ?? false) as boolean, sha256: (data.sha256 || null) as string | null, max_bytes: (data.max_bytes ?? DEFAULT_URL_LIMIT) as number, max_attempts: (data.max_attempts ?? 3) as number };
}
// RFC-style CSV fields, including quoted commas, escaped quotes and newlines.
function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } } else field += c; }
    else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field); field = ''; closed = false;
      if (c !== ',') { if (row.some(v => v.length)) rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else if (c === '"' && !field && !closed) quoted = true;
    else { if (closed || c === '"') throw new Error('Malformed CSV quoting.'); field += c; }
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field.');
  row.push(field); if (row.some(v => v.length)) rows.push(row);
  return rows;
}
export function parseUrlImports(text: string, format: 'text' | 'json' | 'csv'): UrlImportEntry[] {
  if (new TextEncoder().encode(text).length > MAX_MANIFEST_BYTES) throw new Error('Import file exceeds 2 MiB.');
  text = text.replace(/^\uFEFF/, '');
  let values: unknown[];
  if (format === 'json') { const parsed: unknown = JSON.parse(text); if (!Array.isArray(parsed)) throw new Error('JSON must be an array of URLs or file objects.'); values = parsed; }
  else if (format === 'csv') {
    const [names = [], ...rows] = csvRows(text); const header = names.map(n => n.trim());
    if (!header.includes('url') || new Set(header).size !== header.length) throw new Error('CSV requires a unique url column.');
    values = rows.map((row, i) => {
      if (row.length !== header.length) throw new Error(`CSV row ${i + 2} has the wrong number of columns.`);
      const value: Record<string, unknown> = Object.fromEntries(header.map((h, j) => [h, row[j]]));
      for (const k of ['path','sha256','headers','replace','max_bytes','max_attempts']) if (value[k] === '') delete value[k];
      if (value.headers !== undefined) value.headers = JSON.parse(String(value.headers));
      if (value.replace !== undefined) { if (!['true','false'].includes(String(value.replace))) throw new Error('CSV replace must be true or false.'); value.replace = value.replace === 'true'; }
      if (value.max_bytes !== undefined) value.max_bytes = Number(value.max_bytes);
      if (value.max_attempts !== undefined) value.max_attempts = Number(value.max_attempts);
      return value;
    });
  } else values = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!values.length || values.length > MAX_URL_IMPORTS) throw new Error(`Import between 1 and ${MAX_URL_IMPORTS} URLs at a time.`);
  return values.map(entry);
}
