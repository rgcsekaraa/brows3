import { test, expect } from './fixtures';
import type { SavedJob } from '../../src/lib/tauri';

const sample = (): SavedJob => ({
  id: 'backup', config: { name: 'Project backup', local_path: '/Users/demo/projects/a-long-folder-name/backup-source', profile_id: 'a', bucket: 'demo-bucket', region: 'us-east-1', prefix: 'backups/projects/', options: { include: ['**/*.txt'], exclude: ['cache/**'], skip_existing: true }, bandwidth: 65536, interval_minutes: 60, allow_replacement: false }, enabled: true, next_run: 1800612000, last_run: null,
});

test('saving a scheduled job requires explicit approval and keeps destination and rules', async ({ page, backend }) => {
  await page.goto('/bucket?name=demo-bucket&region=us-east-1');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sync local folder...' }).click();
  await page.getByRole('button', { name: 'Choose folder' }).click();
  await page.getByRole('button', { name: 'Save as a job' }).click();
  await page.getByLabel('Job name', { exact: true }).fill('Project backup');
  await page.getByRole('combobox', { name: /^Schedule/ }).click();
  await page.getByRole('option', { name: 'Every hour', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save job', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Approve saved job' }).check();
  await page.getByLabel('Include patterns').fill('**/*.txt');
  await expect(page.getByRole('checkbox', { name: 'Approve saved job' })).not.toBeChecked();
  // Changing source rules resets saved-job approval and its draft.
  await page.getByLabel('Job name', { exact: true }).fill('Project backup');
  await page.getByRole('combobox', { name: /^Schedule/ }).click();
  await page.getByRole('option', { name: 'Every hour', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Approve saved job' }).check();
  for (const width of [1440, 800]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('dialog').locator('.MuiDialogContent-root').evaluate(el => { el.scrollTop = 0; });
    expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (test.info().project.name === 'chromium') await page.screenshot({ path: `.impeccable/review/save-job-${width}.png` });
  }
  await page.getByRole('button', { name: 'Save job', exact: true }).click();
  await expect(page.getByText('Job saved. Open Jobs', { exact: false })).toBeVisible();
  expect(backend.savedJobs[0].config).toMatchObject({ profile_id: 'a', bucket: 'demo-bucket', prefix: '', local_path: '/virtual/downloads', interval_minutes: 60, allow_replacement: true, options: { include: ['**/*.txt'], skip_existing: false } });
  expect(backend.calls.filter(c => c.command === 'start_folder_sync')).toHaveLength(0);
});

test('jobs support run, confirmed cancellation, pause, resume and confirmed deletion', async ({ page, backend }) => {
  backend.savedJobs = [sample()];
  await page.goto('/jobs');
  await expect(page.getByRole('heading', { name: 'Project backup' })).toBeVisible();
  for (const width of [1440, 800]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (test.info().project.name === 'chromium') await page.screenshot({ path: `.impeccable/review/jobs-${width}.png` });
  }
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'Run now', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run now', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel run', exact: true }).click();
  expect(backend.calls.filter(c => c.command === 'cancel_saved_job')).toHaveLength(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel run', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Keep job' }).click();
  expect(backend.savedJobs).toHaveLength(1);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete job', exact: true }).click();
  await expect(page.getByText('No saved jobs yet.', { exact: false })).toBeVisible();
});

test('job errors remain visible across polling and deletion is recoverable', async ({ page, backend }) => {
  backend.savedJobs = [sample()]; backend.jobError = 'Profile settings changed. Recreate this job.';
  await page.goto('/jobs');
  await page.getByRole('button', { name: 'Run now', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Profile settings changed' })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh jobs' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Profile settings changed' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete job', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Profile settings changed');
  await page.getByRole('button', { name: 'Keep job' }).click();
  expect(backend.savedJobs).toHaveLength(1);
});

test('jobs remain manageable when their last profile is deleted', async ({ page, backend }) => {
  backend.savedJobs = [sample()]; backend.profiles = [];
  await page.goto('/jobs');
  await expect(page.getByRole('heading', { name: 'Jobs', exact: true })).toBeVisible();
  await expect(page.getByText('Profile unavailable', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run now', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete job', exact: true }).click();
  await expect(page.getByText('No saved jobs yet.', { exact: false })).toBeVisible();
});

test('dark theme shows paused failures and empty guidance without horizontal scrolling', async ({ page, backend }) => {
  const job = sample(); job.enabled = false; job.next_run = null;
  job.last_run = { id: 'failed', started_at: 1800000000, finished_at: 1800000010, status: 'Failed', message: 'Profile settings changed. Delete and recreate this job to approve the new destination.', transfer_ids: [], cancel_requested: false };
  backend.savedJobs = [job];
  await page.addInitScript(() => localStorage.setItem('brows3-app-v2', JSON.stringify({ state: { themeMode: 'dark' }, version: 0 })));
  await page.goto('/jobs');
  await expect(page.getByText('Profile settings changed.', { exact: false })).toBeVisible();
  for (const width of [1440, 800]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (test.info().project.name === 'chromium') await page.screenshot({ path: `.impeccable/review/jobs-dark-${width}.png` });
  }
  backend.savedJobs = [];
  await page.getByRole('button', { name: 'Refresh jobs' }).click();
  await expect(page.getByText('No saved jobs yet.', { exact: false })).toBeVisible();
});
