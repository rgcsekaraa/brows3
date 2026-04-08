const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi']);
const BINARY_EXTENSIONS = new Set([
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar',
  'mp3', 'wav', 'flac', 'aac', 'm4a', 'opus',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'exe', 'dll', 'so', 'dylib', 'bin', 'iso',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'parquet', 'avro', 'orc', 'feather',
]);

const TEXT_CONTENT_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/yaml',
  'application/x-yaml',
  'text/yaml',
  'text/x-yaml',
  'application/xml',
  'text/xml',
  'application/javascript',
  'text/javascript',
  'application/x-javascript',
  'application/toml',
  'application/x-toml',
  'application/x-sh',
  'application/x-shellscript',
  'application/x-httpd-php',
  'application/x-ndjson',
  'application/x-terraform',
  'application/x-hcl',
  'application/vnd.hashicorp.hcl',
  'application/x-empty',
]);

export type ObjectKind = 'image' | 'video' | 'pdf' | 'text' | 'binary';

export const getObjectName = (objectKey: string): string => objectKey.split('/').pop() || objectKey;

export const getObjectExtension = (name: string): string => {
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index + 1).toLowerCase() : '';
};

const normalizeContentType = (contentType?: string | null): string => {
  if (!contentType) return '';
  return contentType.split(';', 1)[0].trim().toLowerCase();
};

const isTextContentType = (contentType?: string | null): boolean => {
  const normalized = normalizeContentType(contentType);
  return normalized.startsWith('text/')
    || normalized.endsWith('+json')
    || normalized.endsWith('+xml')
    || normalized.endsWith('+yaml')
    || TEXT_CONTENT_TYPES.has(normalized);
};

const kindFromContentType = (contentType?: string | null): ObjectKind | null => {
  const normalized = normalizeContentType(contentType);
  if (!normalized) return null;
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('video/')) return 'video';
  if (normalized === 'application/pdf') return 'pdf';
  if (isTextContentType(normalized)) return 'text';
  return null;
};

const kindFromName = (name: string): ObjectKind => {
  const extension = getObjectExtension(name);
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (extension === 'pdf') return 'pdf';
  if (BINARY_EXTENSIONS.has(extension)) return 'binary';

  // Default ambiguous names to text. Content type, when present, remains authoritative.
  // This avoids blocking editable objects simply because they use uncommon or no suffixes.
  return 'text';
};

export const getObjectKind = (name: string, contentType?: string | null): ObjectKind => {
  return kindFromContentType(contentType) ?? kindFromName(name);
};

export const canObjectBePreviewed = (name: string, contentType?: string | null): boolean => {
  return getObjectKind(name, contentType) !== 'binary';
};

export const canObjectBeEdited = (name: string, contentType?: string | null): boolean => {
  return getObjectKind(name, contentType) === 'text';
};

export const getEditorLanguage = (name: string, contentType?: string | null): string => {
  const normalized = normalizeContentType(contentType);
  if (normalized.endsWith('json') || normalized.endsWith('+json')) return 'json';
  if (normalized.endsWith('yaml') || normalized.endsWith('+yaml')) return 'yaml';
  if (normalized === 'application/xml' || normalized === 'text/xml') return 'xml';
  if (normalized === 'application/toml' || normalized === 'application/x-toml') return 'ini';

  const ext = getObjectExtension(name);
  switch (ext) {
    case 'js': case 'jsx': return 'javascript';
    case 'ts': case 'tsx': return 'typescript';
    case 'py': return 'python';
    case 'rs': return 'rust';
    case 'md': case 'markdown': return 'markdown';
    case 'sh': case 'bash': case 'zsh': case 'fish': return 'shell';
    case 'yml': case 'yaml': return 'yaml';
    case 'json': case 'lock': return 'json';
    case 'xml': case 'svg': return 'xml';
    case 'html': return 'html';
    case 'css': case 'scss': case 'less': case 'sass': return 'css';
    case 'sql': return 'sql';
    case 'java': return 'java';
    case 'cpp': case 'c': case 'h': case 'hpp': return 'cpp';
    case 'cs': return 'csharp';
    case 'go': return 'go';
    case 'dockerfile': return 'dockerfile';
    case 'lua': return 'lua';
    case 'rb': return 'ruby';
    case 'php': return 'php';
    case 'ini': case 'conf': case 'cfg': case 'properties': case 'env': case 'toml': return 'ini';
    case 'bat': case 'cmd': case 'ps1': return 'bat';
    case 'kt': case 'kts': return 'kotlin';
    case 'swift': return 'swift';
    case 'scala': return 'scala';
    case 'pl': return 'perl';
    case 'graphql': case 'gql': return 'graphql';
    case 'tf': case 'hcl': return 'hcl';
    case 'r': return 'r';
    default: return 'plaintext';
  }
};
