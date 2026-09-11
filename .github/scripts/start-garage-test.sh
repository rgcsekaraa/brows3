#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?Run this script in CI}"
: "${GITHUB_ENV:?Run this script in CI}"

cat > "$RUNNER_TEMP/brows3-garage.toml" <<'CONFIG'
metadata_dir = "/tmp/garage/meta"
data_dir = "/tmp/garage/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "1111111111111111111111111111111111111111111111111111111111111111"
[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"
CONFIG

docker run -d --name brows3-garage-test \
  -p 127.0.0.1:3900:3900 \
  -v "$RUNNER_TEMP/brows3-garage.toml:/etc/garage.toml:ro" \
  dxflrs/garage:v1.0.1

for attempt in {1..30}; do
  if docker exec brows3-garage-test /garage status >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

BROWS3_GARAGE_NODE_ID=$(docker exec brows3-garage-test /garage node id --quiet)
BROWS3_GARAGE_NODE_ID=${BROWS3_GARAGE_NODE_ID%%@*}
docker exec brows3-garage-test /garage layout assign -z test -c 1G "$BROWS3_GARAGE_NODE_ID"
docker exec brows3-garage-test /garage layout apply --version 1
docker exec brows3-garage-test /garage key import --yes -n brows3-test \
  GK111111111111111111111111 \
  1111111111111111111111111111111111111111111111111111111111111111
docker exec brows3-garage-test /garage bucket create brows3-test
docker exec brows3-garage-test /garage bucket allow --read --write --owner brows3-test --key brows3-test

cat >> "$GITHUB_ENV" <<'ENV'
BROWS3_S3_TEST_ENDPOINT=http://127.0.0.1:3900
BROWS3_S3_TEST_ACCESS_KEY=GK111111111111111111111111
BROWS3_S3_TEST_SECRET_KEY=1111111111111111111111111111111111111111111111111111111111111111
BROWS3_S3_TEST_REGION=garage
BROWS3_S3_TEST_BUCKET=brows3-test
ENV
