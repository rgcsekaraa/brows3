#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 3 ]]; then
  echo 'usage: bash scripts/compare-transfer-profiles.sh BEFORE_PLAIN AFTER_PLAIN AFTER_PROTECTED' >&2
  exit 2
fi
controls() {
  sed -E '/^(revision|mode)=/d; /  src-tauri\/Cargo.lock$/d' "$1/environment.txt"
}
diff -u <(controls "$1") <(controls "$2")
diff -u <(controls "$2") <(controls "$3")
diff -u <(grep '^revision=' "$2/environment.txt") <(grep '^revision=' "$3/environment.txt")
jq -es '
  .[0] as $before | .[1] as $plain | .[2] as $protected |
  if any(.[]; length != 2) then error("expected two workload sizes per run") else . end |
  [range(0; 2) as $i |
   [$before[$i], $plain[$i], $protected[$i]] as $rows |
   if ($rows | map(.protected)) != [false, false, true] or
      ($rows | map(.payload_bytes) | unique) != [[4096,8388608][$i]] or
      ($rows | map(.sha256) | unique | length) != 1 or
      ($rows | all(.[]; .samples == 5 and .upload_ms_median > 0 and .download_ms_median > 0) | not)
   then error("mode, workload, digest or sample mismatch") else . end |
   {payload_bytes: $plain[$i].payload_bytes, sha256: $plain[$i].sha256,
    original_plain: $before[$i], integrated_plain: $plain[$i], integrated_protected: $protected[$i],
    plain_upload_drift_ms: ($plain[$i].upload_ms_median - $before[$i].upload_ms_median),
    plain_download_drift_ms: ($plain[$i].download_ms_median - $before[$i].download_ms_median),
    protection_upload_ms: ($protected[$i].upload_ms_median - $plain[$i].upload_ms_median),
    protection_download_ms: ($protected[$i].download_ms_median - $plain[$i].download_ms_median),
    protection_stored_bytes: ($protected[$i].stored_bytes_median - $plain[$i].stored_bytes_median)}]
' "$1/summary.json" "$2/summary.json" "$3/summary.json"
