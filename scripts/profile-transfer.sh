#!/usr/bin/env bash
set -euo pipefail

case ${1:-} in
  plain) protected=false ;;
  protected) protected=true ;;
  *) echo 'usage: bash scripts/profile-transfer.sh plain|protected NEW_RESULT_DIRECTORY' >&2; exit 2 ;;
esac
out=${2:?new result directory required}
: "${BROWS3_PROFILE_PORT:?disposable MinIO loopback port required}"
: "${PROFILE_REVISION:?identify the measured source revision}"
: "${PROFILE_FIXTURE:?record the immutable MinIO image digest}"
mkdir "$out"
{
  printf 'revision=%s\nfixture=%s\nmode=%s\n' "$PROFILE_REVISION" "$PROFILE_FIXTURE" "$1"
  uname -srm
  if [[ -r /proc/cpuinfo ]]; then sed -n '/^model name/{p;q;}' /proc/cpuinfo; fi
  if [[ -r /sys/fs/cgroup/cpu.max ]]; then printf 'cpu.max='; cat /sys/fs/cgroup/cpu.max; fi
  df -PT "${TMPDIR:-/tmp}" | awk 'NR==2 {print "fixture_fs=" $1 ":" $2 ":" $7}'
  printf 'rustflags=%s\ntarget=%s\ntmpdir=%s\n' "${RUSTFLAGS:-}" "${CARGO_BUILD_TARGET:-native}" "${TMPDIR:-/tmp}"
  rustc -Vv
  cargo -V
  sha256sum src-tauri/Cargo.lock src-tauri/src/transfer/manager/transfer_profile.rs scripts/profile-transfer.sh
} > "$out/environment.txt"
export AWS_EC2_METADATA_DISABLED=true NO_PROXY=127.0.0.1 no_proxy=127.0.0.1
cargo test --manifest-path src-tauri/Cargo.toml --locked --release --lib "profile_${1}_single_file" \
  -- --ignored --nocapture --test-threads=1 | tee "$out/test.log"
sed -n 's/^.*BROWS3_PROFILE //p' "$out/test.log" > "$out/raw.jsonl"
jq -es --argjson protected "$protected" '
  def median: sort | .[length / 2 | floor];
  group_by(.payload_bytes) |
  if map(.[0].payload_bytes) != [4096,8388608] then error("missing workload") else . end |
  map(if (map(.sample) | sort) != [0,1,2,3,4,5] or
         (all(.[]; .protected == $protected and .warmup == (.sample == 0)
              and .upload_ns > 0 and .download_ns > 0) | not) or
         (map(.sha256) | unique | length) != 1
      then error("incomplete or inconsistent profile") else . end |
      map(select(.warmup | not)) |
      {protected: .[0].protected, payload_bytes: .[0].payload_bytes, sha256: .[0].sha256,
       samples: length, stored_bytes_median: (map(.stored_bytes) | median),
       upload_ms_median: (map(.upload_ns / 1e6) | median),
       download_ms_median: (map(.download_ns / 1e6) | median)})
' "$out/raw.jsonl" > "$out/summary.json"
cat "$out/summary.json"
