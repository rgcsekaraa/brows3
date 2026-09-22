# Saved and scheduled jobs

Status: implemented for the next release; not published yet.

Brows3 can save a local-folder-to-S3 sync and run it manually or at an interval while the app is open. Jobs use the existing folder comparison and upload pipeline. They do not download, delete local files, delete remote-only objects, or run arbitrary commands.

## Create a job

1. Select a profile and open the destination bucket and folder.
2. Choose **Upload > Sync local folder** and select the source folder.
3. Set include/exclude filters and whether to skip existing objects. The current bandwidth setting is saved as a per-transfer limit.
4. Choose **Save as a job**, enter a name, and select a schedule.
5. Read and select the approval checkbox, then choose **Save job**.

Available schedules are **Manual only**, **Every 15 minutes**, **Every hour**, **Every day**, and **Every week**. Saving does not immediately start a run. Open **Jobs** to use **Run now** or manage the schedule.

Saving explicitly approves future uploads from the selected folder to the saved destination. When existing objects are not skipped, approval also covers replacing changed or unverified objects without another prompt. An unverified object has no usable content comparison and may be uploaded again even when its contents match, including some multipart or KMS-encrypted objects. Previous contents may be unrecoverable without bucket versioning. S3 request and transfer charges may apply.

The saved configuration is immutable. To change the folder, destination, filters, replacement policy, bandwidth, name, or interval, delete the saved job and create another. Later changes to general transfer settings do not change a saved job's filters or bandwidth.

## Timing and controls

Scheduling runs inside Brows3. There is no background service, operating-system task, cron integration, or execution after the app exits. Intervals are elapsed delays, not calendar appointments.

The first scheduled run becomes due one interval after saving or resuming. After a successful run, the next interval starts when that run finishes. For example, an hourly job that finishes at 10:20 becomes due at 11:20. The scheduler checks approximately every five seconds; preparation and transfer queues can delay actual uploads.

Only one run of a given saved job can be active. Other jobs can run concurrently. If the computer sleeps while Brows3 remains open, waking can start at most one due run per job. Missed intervals are not accumulated into a backlog.

| Control | Behavior |
| --- | --- |
| Run now | Starts a fresh comparison and upload run, including for a paused or manual job. Does not enable a paused schedule. |
| Pause | Stops future scheduled runs. An active run continues. |
| Resume | Enables an interval schedule. If idle, its next run is one interval from now. |
| Cancel run | Asks for confirmation, cancels pending and active transfers for this run, and pauses its schedule. Completed uploads remain. |
| Delete | Asks for confirmation and removes the saved configuration and schedule. Local files, S3 objects, and transfer history remain. Active jobs cannot be deleted. |

Cancellation during preparation may wait for a local scan or comparison already in progress to finish. It prevents that cancelled preparation from publishing new uploads, but is not an instant interruption of scanning. Individual queued or active transfers can also be cancelled in **Uploads**.

When reopening Brows3, a run interrupted by closing the app is marked **Interrupted**, and a schedule whose due time passed while closed is marked **Missed**. Both are paused without automatic replay. Failed and cancelled runs also pause their schedules. Review the result and Uploads, then choose **Run now** or **Resume** as appropriate.

## Comparison, destination, and limits

Every run scans the local folder again and compares fresh content using the saved filters. It does not reuse an old preview. Matching content is skipped, and **Skip existing objects** skips destination keys that already exist. Remote-only objects remain untouched.

Jobs reuse the existing sync protections: local content is checked through a temporary upload snapshot, and destination writes use conditional requests to detect conflicting changes. Replacements reuse supported destination attributes, including metadata, content headers, storage class, encryption settings, tags, permissions, and object-lock settings. Missing permissions, unsupported encryption, conflicts, or provider limitations can fail a run; this is not a guarantee that every S3-compatible provider supports every attribute. See [Folder sync](FOLDER_SYNC.md) for the underlying workflow.

Each job pins the saved profile identity/version, bucket, region, and prefix. Selecting a different active profile does not redirect it. If the saved profile changes or is unavailable, preparation fails and the schedule pauses. Recreate the job to approve changed profile settings. Jobs refer to the existing profile credential storage; credentials are not copied into the jobs journal.

Supported limits and constraints:

- At most 50 saved jobs.
- The serialized jobs journal is limited to 16 MiB on reads and writes.
- At most 10,000 local files per scan, before include/exclude filtering. Filters do not bypass this scan limit.
- A real absolute local folder is required. Symbolic links and non-regular files are rejected rather than followed.
- Scanning and comparison have time limits, so a large or slow folder may require a smaller scope.
- Temporary disk space is needed for upload snapshots.
- Bandwidth is saved per transfer, so simultaneous transfers can use more than that amount in total.

## Progress, outcomes, and storage recovery

**Jobs** shows the saved destination, schedule, next run, and last run status and message across profiles. This is a durable last outcome, not a complete run history. **Uploads** shows transfer progress and individual transfer results, grouped under the job name.

Completion produces an in-app notification with a **View jobs** action. Notifications depend on the app being open and its event listener being available; the persisted Jobs result remains the source for later review. There are no email, push, or external notifications.

An operating-system lock protects the jobs journal. A second Brows3 instance that cannot acquire that lock has saved jobs disabled and reports an error. Close the other instance and restart to access jobs there. The operating system releases the lock when the owning process exits, including after a crash.

If the journal is corrupted or unsupported, scheduling is disabled and the original file is kept. The application does not silently replace it with an empty journal. Investigate the reported storage error before restoring or recreating saved jobs.

If saving a completed run's result fails, its active reservation is retained to stop another automatic run of that job. Brows3 reports that the result could not be saved. Check disk space and storage access, then restart and review Jobs and Uploads before running again. A missing final record does not mean previously completed uploads were undone.

## UI and verification evidence

The Jobs page and save form preserve the incumbent MUI theme, typography, spacing, dialogs, sidebar, and small rounded controls. Jobs was reviewed in light and dark themes at 1440 and 800 pixels, and the save form was reviewed at both widths. Review found no material issues requiring fixes.

Recorded validation for this implementation: 137 Rust tests passed with 8 ignored; the newly added real MinIO job test also passed separately. Frontend tests: 107 passed. Browser checks: 82 passed. Release checks: 23 passed. The native Tauri debug app build passed. These results describe the tested implementation and do not imply publication or universal S3-provider compatibility.

Implementation references: [job lifecycle and journal](../src-tauri/src/commands/jobs.rs), [sync comparison](../src-tauri/src/commands/sync.rs), [sync file and attribute handling](../src-tauri/src/transfer/sync.rs), [Jobs page](../src/app/jobs/page.tsx), [save form](../src/components/dialogs/SaveSyncJob.tsx), [folder sync dialog](../src/components/dialogs/FolderSyncDialog.tsx), and [in-app notifications](../src/hooks/useSavedJobEvents.ts).
