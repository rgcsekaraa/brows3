import { test as base, expect } from '@playwright/test';
import packageJson from '../../package.json';
import type { Profile, S3Object, TransferJob } from '../../src/lib/tauri';

type Args = Record<string, unknown>;
const object = (key: string, size = 20): S3Object => ({ key, size, last_modified: '2026-01-01T00:00:00Z', storage_class: 'STANDARD' });

export class DesktopBackend {
  profiles: Profile[] = [
    { id: 'a', name: 'Development', credential_type: { type: 'Environment' }, region: 'us-east-1', is_default: true },
    { id: 'b', name: 'Production', credential_type: { type: 'Environment' }, region: 'us-east-1', is_default: false },
  ];
  activeProfile = 'a';
  emptyListingPages = 0;
  buckets = ['demo-bucket'];
  bucketPolicy: string | null = null;
  deleteBucketError = '';
  calls: { command: string; args: Args }[] = [];
  unexpected: string[] = [];
  transfers: TransferJob[] = [];
  content = 'original text';
  contentType = 'text/plain';
  etag = '"v1"';
  conflict = false;
  objects = [object('notes.txt'), object('sound.wav', 1644), object('nested/match.txt')];

  async invoke(command: string, args: Args = {}): Promise<unknown> {
    this.calls.push({ command, args });
    switch (command) {
      case 'plugin:app|version': return packageJson.version;
      case 'plugin:path|resolve_directory': return '/virtual/config';
      case 'get_log_file_info': return { log_file_path: '/virtual/logs/brows3.log', log_dir_path: '/virtual/logs', panic_log_path: '/virtual/logs/panic.log', panic_log_exists: false };
      case 'list_profiles': return this.profiles;
      case 'get_active_profile': return this.profiles.find(profile => profile.id === this.activeProfile);
      case 'set_active_profile': this.activeProfile = String(args.id); return null;
      case 'refresh_s3_client':
      case 'set_transfer_concurrency':
      case 'plugin:event|emit':
      case 'plugin:clipboard-manager|write_text': return null;
      case 'plugin:updater|check': return null;
      case 'list_buckets_with_regions':
      case 'list_buckets': return this.buckets.map(name => ({ name, region: 'us-east-1', creation_date: null, object_count: null, total_size: null, total_size_formatted: null }));
      case 'create_bucket':
        if (args.expectedProfileId !== this.activeProfile) throw new Error('The active profile changed.');
        this.buckets.push(String(args.bucketName));
        return null;
      case 'delete_bucket':
        if (args.expectedProfileId !== this.activeProfile) throw new Error('The active profile changed.');
        if (args.confirmation !== args.bucketName) throw new Error('Bucket confirmation does not match.');
        if (this.deleteBucketError) throw new Error(this.deleteBucketError);
        this.buckets = this.buckets.filter(name => name !== args.bucketName);
        return null;
      case 'get_bucket_policy': return this.bucketPolicy;
      case 'put_bucket_policy':
        if (args.expectedProfileId !== this.activeProfile || args.expectedPolicy !== this.bucketPolicy) throw new Error('The policy or profile changed.');
        this.bucketPolicy = args.policy as string | null;
        return null;
      case 'get_bucket_region': return 'us-east-1';
      case 'list_objects': {
        if (this.emptyListingPages > 0) {
          this.emptyListingPages -= 1;
          return { objects: [], common_prefixes: [], next_continuation_token: `page-${this.emptyListingPages}`, is_truncated: true, prefix: args.prefix || '', bucket_region: 'us-east-1' };
        }
        const prefix = String(args.prefix || '');
        const objects = this.activeProfile === 'a' ? this.objects : [object('production.txt')];
        return { objects: objects.filter(item => item.key.startsWith(prefix) && !item.key.slice(prefix.length).includes('/')), common_prefixes: prefix ? [] : ['nested/'], next_continuation_token: null, is_truncated: false, prefix, bucket_region: 'us-east-1' };
      }
      case 'search_objects': return { objects: this.objects.filter(item => item.key.includes(String(args.query))), scanned_objects: this.objects.length, is_truncated: false };
      case 'get_object_metadata': return { key: args.key, size: this.content.length, content_type: String(args.key).endsWith('.wav') ? 'audio/wav' : String(args.key).endsWith('.svg') ? 'image/svg+xml' : this.contentType, e_tag: this.etag, last_modified: null, storage_class: null, user_metadata: {} };
      case 'get_object_content': return { content: this.content, e_tag: this.etag, profile_id: this.activeProfile };
      case 'put_object_content':
        if (this.conflict || args.expectedEtag !== this.etag) throw new Error('This object has changed since it was opened.');
        if (args.expectedProfileId !== this.activeProfile) throw new Error('The active profile changed.');
        this.content = String(args.content);
        this.etag = '"v2"';
        return this.etag;
      case 'get_presigned_url': return `https://media.brows3.test/${args.key}`;
      case 'copy_object':
      case 'move_object': {
        if (args.expectedProfileId !== this.activeProfile) throw new Error('The active profile changed.');
        this.objects.push(object(String(args.destinationKey)));
        if (command === 'move_object') this.objects = this.objects.filter(item => item.key !== args.sourceKey);
        return null;
      }
      case 'delete_objects': this.objects = this.objects.filter(item => !(args.keys as string[]).includes(item.key)); return null;
      case 'list_transfers': return this.transfers;
      case 'plugin:dialog|save': return '/virtual/downloads/notes.txt';
      case 'plugin:dialog|open': return (args.options as Args)?.directory ? '/virtual/downloads' : ['/virtual/upload.txt'];
      case 'queue_download':
      case 'queue_upload': {
        const id = `transfer-${this.transfers.length + 1}`;
        this.transfers.unshift({ id, profile_id: this.activeProfile, transfer_type: command === 'queue_download' ? 'Download' : 'Upload', bucket: String(args.bucketName), bucket_region: String(args.bucketRegion), key: String(args.key), local_path: String(args.localPath), total_bytes: Number(args.totalBytes), processed_bytes: 0, status: 'Pending', created_at: Date.now() });
        return id;
      }
      case 'cancel_transfer': {
        const job = this.transfers.find(job => job.id === args.jobId);
        if (job) job.status = 'Cancelled';
        return !!job;
      }
      case 'retry_transfer': {
        const original = this.transfers.find(job => job.id === args.jobId);
        if (!original) return null;
        const id = `transfer-${this.transfers.length + 1}`;
        this.transfers.unshift({ ...original, id, status: 'Pending', processed_bytes: 0, created_at: Date.now() });
        return id;
      }
      default:
        this.unexpected.push(command);
        throw new Error(`Unmocked desktop command: ${command}`);
    }
  }
}

export const test = base.extend<{ backend: DesktopBackend }>({
  backend: [async ({ page }, use) => {
    const backend = new DesktopBackend();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('__smokeInvoke', (command: string, args: Args) => backend.invoke(command, args));
    await page.addInitScript(() => {
      const callbacks = new Map<number, (event: unknown) => void>();
      let nextId = 0;
      const host = window as unknown as { __smokeInvoke: (command: string, args: Record<string, unknown>) => Promise<unknown> };
      const violations: string[] = [];
      document.addEventListener('securitypolicyviolation', event => violations.push(`${event.violatedDirective}: ${event.blockedURI}`));
      Object.assign(window, {
        __smokeCspViolations: violations,
        __TAURI__: {},
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
        __TAURI_INTERNALS__: {
          metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
          transformCallback: (callback: (event: unknown) => void) => { callbacks.set(++nextId, callback); return nextId; },
          unregisterCallback: (id: number) => callbacks.delete(id),
          invoke: (command: string, args: Record<string, unknown>) => {
            if (command === 'plugin:event|listen') return Promise.resolve(args.handler);
            if (command === 'plugin:event|unlisten') { callbacks.delete(Number(args.eventId)); return Promise.resolve(); }
            return host.__smokeInvoke(command, args);
          },
        },
      });
    });
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    await use(backend);
    expect.soft(backend.unexpected, 'Unexpected native calls').toEqual([]);
    expect.soft(await page.evaluate(() => (window as unknown as { __smokeCspViolations: string[] }).__smokeCspViolations), 'Content security policy violations').toEqual([]);
    expect(errors, 'Uncaught browser errors').toEqual([]);
  }, { auto: true }],
});
export { expect };
