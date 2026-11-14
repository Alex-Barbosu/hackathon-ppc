#!/usr/bin/env python3
"""End-to-end tus check through Caddy: big upload, a dropped connection, resume, hash compare.

The bytes are generated in memory (deterministic per 16 MB chunk), so no file is read or sent.
Run from the repo root with the stack up: `make a-tus-check MIB=1024 DROP=20`
(or: tus_check.py <size_mib> <drop_at_chunk>). Needs python3 and `docker compose` for the heap readings.
"""
import base64, hashlib, http.client, json, os, random, re, ssl, subprocess, sys, threading, time

SIZE = int(sys.argv[1]) * 1024 * 1024
DROP_CHUNK = int(sys.argv[2])
CHUNK = 16 * 1024 * 1024
SEED = 20261114
HOST = "localhost"
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE


def env_value(key):
    for line in open(".env"):
        if line.startswith(key + "="):
            return line.strip().split("=", 1)[1]
    raise SystemExit(f"{key} missing from .env")


def conn():
    return http.client.HTTPSConnection(HOST, 443, context=ctx, timeout=600)


def call(method, path, headers=None, body=None):
    c = conn()
    c.request(method, path, body=body, headers=headers or {})
    r = c.getresponse()
    data = r.read()
    out = (r.status, {k.lower(): v for k, v in r.getheaders()}, data)
    c.close()
    return out


def chunk_bytes(index):
    """Chunk i of the virtual file; same bytes every time it is asked for."""
    length = min(CHUNK, SIZE - index * CHUNK)
    return random.Random(SEED + index).randbytes(length)


def heap_used():
    try:
        out = subprocess.run(
            ["docker", "compose", "exec", "-T", "filegrid-api", "wget", "-qO-",
             "http://127.0.0.1:8080/actuator/prometheus"],
            capture_output=True, text=True, timeout=20).stdout
        total = 0.0
        for line in out.splitlines():
            if line.startswith("jvm_memory_used_bytes{") and 'area="heap"' in line:
                total += float(line.rsplit(" ", 1)[1])
        return total / (1024 * 1024)
    except Exception:
        return None


samples = []
stop = threading.Event()


def sampler():
    while not stop.is_set():
        h = heap_used()
        if h is not None:
            samples.append((time.time(), h))
        stop.wait(3)


# ---- login
status, _, body = call("POST", "/api/v1/auth/login", {"Content-Type": "application/json"},
                       json.dumps({"username": "field", "password": env_value("DEMO_PASSWORD")}))
assert status == 200, f"login {status}"
auth = {"Authorization": "Bearer " + json.loads(body)["token"]}
tus = {**auth, "Tus-Resumable": "1.0.0"}

# ---- expected hash, computed while generating (never held in memory beyond one chunk)
expected = hashlib.sha256()
for i in range((SIZE + CHUNK - 1) // CHUNK):
    expected.update(chunk_bytes(i))
expected = expected.hexdigest()

threading.Thread(target=sampler, daemon=True).start()
time.sleep(1)
before = heap_used()

# ---- create
meta = ",".join(f"{k} {base64.b64encode(v.encode()).decode()}" for k, v in
                {"category": "video", "filename": "drone-line-check.mp4", "filetype": "video/mp4",
                 "region": "muntenia"}.items())
status, h, _ = call("POST", "/api/v1/files/tus", {**tus, "Upload-Length": str(SIZE), "Upload-Metadata": meta})
assert status == 201, f"create {status}"
location = h["location"]
print(f"created {location}  size={SIZE // (1024 * 1024)} MiB  expected sha256={expected[:16]}...")

started = time.time()
offset = 0
dropped = False
file_id = None
resumes = 0
while offset < SIZE:
    index = offset // CHUNK
    piece = chunk_bytes(index)[offset - index * CHUNK:]
    headers = {**tus, "Content-Type": "application/offset+octet-stream", "Upload-Offset": str(offset),
               "Content-Length": str(len(piece))}

    if index == DROP_CHUNK and not dropped:
        # Send part of the chunk, then kill the socket without finishing it.
        dropped = True
        c = conn()
        c.putrequest("PATCH", location)
        for k, v in headers.items():
            c.putheader(k, v)
        c.endheaders()
        sent = 6_000_000
        c.send(piece[:sent])
        time.sleep(0.5)
        c.sock.close()
        print(f"  dropped the connection after {sent} bytes of chunk {index}")
        time.sleep(2)
        status, h, _ = call("HEAD", location, tus)
        assert status == 200, f"head {status}"
        resumed_at = int(h["upload-offset"])
        print(f"  server says Upload-Offset={resumed_at}  (chunk start {offset}, sent {sent})")
        assert offset <= resumed_at <= offset + sent, "offset outside the bytes that were sent"
        offset = resumed_at
        resumes += 1
        continue

    status, h, body = call("PATCH", location, headers, piece)
    if status == 409:
        status, h, _ = call("HEAD", location, tus)
        offset = int(h["upload-offset"])
        continue
    assert status == 204, f"patch {status} {body[:200]}"
    offset = int(h["upload-offset"])
    if "x-filegrid-file-id" in h:
        file_id = h["x-filegrid-file-id"]
    if index % 8 == 0:
        print(f"  {offset // (1024 * 1024)} MiB")

elapsed = time.time() - started
stop.set()
assert file_id, "no X-FileGrid-File-Id on the last chunk"
print(f"uploaded in {elapsed:.1f}s ({SIZE / 1024 / 1024 / elapsed:.0f} MiB/s), file id {file_id}")

# ---- receipt
status, _, body = call("GET", f"/api/v1/files/{file_id}", auth)
meta_json = json.loads(body)
print(f"receipt: storage={meta_json['storage']} size={meta_json['sizeBytes']} sha256={meta_json['sha256'][:16]}... "
      f"status={meta_json['status']}")
assert meta_json["sha256"] == expected, "receipt hash differs from the hash of what was sent"
assert meta_json["sizeBytes"] == SIZE
assert meta_json["storage"] == "s3"

# ---- download through a link, hashing as it streams (nothing saved)
status, _, body = call("POST", f"/api/v1/files/{file_id}/download-link", auth)
url = json.loads(body)["url"]
c = conn()
c.request("GET", url)
r = c.getresponse()
assert r.status == 200, f"download {r.status}"
digest = hashlib.sha256()
total = 0
while True:
    block = r.read(1024 * 1024)
    if not block:
        break
    digest.update(block)
    total += len(block)
c.close()
print(f"downloaded {total} bytes, sha256={digest.hexdigest()[:16]}...  header={r.getheader('X-Content-SHA256')[:16]}...")
assert digest.hexdigest() == expected and total == SIZE, "downloaded bytes differ from what was uploaded"

status, _, body = call("POST", f"/api/v1/files/{file_id}/verify", auth)
print("verify:", json.loads(body)["ok"])

heaps = [h for _, h in samples]
print(f"API heap before: {before:.0f} MiB | during upload+download: min {min(heaps):.0f} / max {max(heaps):.0f} MiB "
      f"({len(heaps)} samples) | file was {SIZE // (1024 * 1024)} MiB")
print("RESULT: OK  resumes=", resumes)
