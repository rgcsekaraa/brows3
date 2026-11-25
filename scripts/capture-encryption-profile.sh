#!/usr/bin/env bash
# Build once, collect in-window user-space CPU stacks and resolve their symbols.
set -euo pipefail
if [[ $# != 1 ]]; then
  echo "Usage: $0 NEW_OUTPUT_DIRECTORY" >&2
  exit 2
fi
out=$(realpath -m "$1")
cd "$(dirname "$0")/.."
: "${BROWS3_PROFILER_LIBRARY:?Run inside nix develop .#notebook}"
command -v pprof >/dev/null
mkdir -p "$(dirname "$out")"
mkdir "$out"
build=$(mktemp)
trap 'rm -f "$build"' EXIT
echo "Building the release benchmark with debug symbols..."
cargo test --manifest-path src-tauri/Cargo.toml --release --locked --lib --no-run \
  --config 'profile.release.package.brows3.strip=false' \
  --config 'profile.release.package.brows3.debug=1' --message-format=json-render-diagnostics > "$build"
binary=$(jq -er --slurp '[.[] | select(.reason == "compiler-artifact" and .profile.test and .executable != null)] | last.executable' "$build")
{
  date -u +%FT%TZ
  rustc --version
  if [[ -f .brows3-source-revision ]]; then
    cat .brows3-source-revision
  elif git rev-parse --verify HEAD 2>/dev/null; then
    if ! git diff --quiet HEAD -- src-tauri; then echo "Includes local Rust source changes"; fi
  else
    echo "Source archive (revision unavailable)"
  fi
  uname -smr
  echo "500 Hz requested, 3 seconds accumulated pre-transmit wall time per profile"
} > "$out/conditions.txt"
echo "Capturing plain and encrypted PUT preparation at 4 KiB and 8 MiB..."
env BROWS3_CPU_PROFILE_DIR="$out" CPUPROFILE_FREQUENCY=500 \
  LD_PRELOAD="$BROWS3_PROFILER_LIBRARY" \
  "$binary" capture_cpu_before_wire --ignored --nocapture --test-threads=1 2>&1 | tee "$out/capture.log"
for size in 4kib 8mib; do
  for mode in plain encrypted; do
    name="$out/$size-$mode"
    echo "Resolving symbols for $size $mode..."
    pprof -symbolize=local -proto -output="$name.pb.gz" "$binary" "$name.prof"
    pprof -symbolize=none -traces -sample_index=samples -unit=count "$name.pb.gz" | gzip -n > "$name.stacks.gz"
  done
done
echo "Raw and symbolized profiles saved in $out"
