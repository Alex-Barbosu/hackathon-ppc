#!/bin/sh
# Builds the S3 identity file from env (no credential is ever committed), starts
# SeaweedFS, creates the buckets FileGrid expects, then marks itself ready.
# Buckets are created here rather than in a one-shot container because
# `docker compose up --wait` treats an exited container as a failed start.
set -eu
cat > /tmp/s3.json <<JSON
{
  "identities": [
    {
      "name": "filegrid",
      "credentials": [{ "accessKey": "${S3_ACCESS_KEY}", "secretKey": "${S3_SECRET_KEY}" }],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    }
  ]
}
JSON
rm -f /tmp/buckets-ready

weed server -dir=/data -ip=seaweedfs -ip.bind=0.0.0.0 \
  -master.volumeSizeLimitMB=1024 -volume.max=0 \
  -s3 -s3.port=8333 -s3.config=/tmp/s3.json &
pid=$!
trap 'kill -TERM "$pid" 2>/dev/null' TERM INT

until wget -qO /dev/null http://127.0.0.1:8333/status 2>/dev/null; do sleep 1; done
for b in filegrid-outage filegrid-video filegrid-document filegrid-meter; do
  echo "s3.bucket.create -name $b" | weed shell -master=127.0.0.1:9333 >/dev/null 2>&1 || true
done
touch /tmp/buckets-ready
echo "seaweedfs: buckets ready"

wait "$pid"
