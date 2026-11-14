#!/bin/sh
# Builds the S3 identity file from env at start, so no credential is ever committed.
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
exec weed server -dir=/data -ip=seaweedfs -ip.bind=0.0.0.0 \
  -master.volumeSizeLimitMB=1024 -volume.max=0 \
  -s3 -s3.port=8333 -s3.config=/tmp/s3.json
