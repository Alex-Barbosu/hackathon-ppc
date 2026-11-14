#!/usr/bin/env python3
"""A big video over the slow lane: 300 ms of latency and a lossy link, resumed until it is whole.

The field app's worst case. The upload goes through Toxiproxy's slow lane (https://localhost:8443), set with
the same call the Chaos page uses (`POST /chaos/network`, target `client`). Each time the link breaks, the client asks the
server how much it has (`HEAD`) and goes on from there. At the end the SHA-256 of what is stored must equal the hash of
what was sent, and a normal download must give the same bytes.

The bytes are generated in memory (deterministic per 16 MiB chunk), so no file is read or sent from disk.
Run from the repo root with the stack up: `make a-slowlane-check MIB=1024 LATENCY=300 LOSS=10`
(or: slowlane_check.py <size_mib> <latency_ms> <loss_pct>). The slow lane is always cleared at the end.
"""
import base64, hashlib, http.client, json, os, random, ssl, subprocess, sys, threading, time

SIZE = int(sys.argv[1] if len(sys.argv) > 1 else 1024) * 1024 * 1024
LATENCY = int(sys.argv[2] if len(sys.argv) > 2 else 300)
LOSS = float(sys.argv[3] if len(sys.argv) > 3 else 10)
CHUNK = 16 * 1024 * 1024
SEED = 20261115
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
failures = []


def check(label, ok, detail=""):
    print(f"  [{'ok' if ok else 'FAIL'}] {label}{(' - ' + detail) if detail else ''}")
    if not ok:
        failures.append(label)


def env_value(key):
    for line in open(".env"):
        if line.startswith(key + "="):
            return line.strip().split("=", 1)[1]
    raise SystemExit(f"{key} missing from .env")


def conn(port):
    return http.client.HTTPSConnection("localhost", port, context=ctx, timeout=180)


def call(method, path, headers=None, body=None, port=443):
    c = conn(port)
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
        out = subprocess.run(["docker", "compose", "exec", "-T", "filegrid-api", "wget", "-qO-",
                              "http://127.0.0.1:8080/actuator/prometheus"], capture_output=True, text=True, timeout=20).stdout
        return sum(float(l.rsplit(" ", 1)[1]) for l in out.splitlines()
                   if l.startswith("jvm_memory_used_bytes{") and 'area="heap"' in l) / (1024 * 1024)
    except Exception:
        return None


def login(user):
    status, _, body = call("POST", "/api/v1/auth/login", {"Content-Type": "application/json"},
                           json.dumps({"username": user, "password": env_value("DEMO_PASSWORD")}))
    assert status == 200, f"login {user}: {status}"
    return {"Authorization": "Bearer " + json.loads(body)["token"]}


def network(auth, **condition):
    status, _, body = call("POST", "/chaos/network", {**auth, "Content-Type": "application/json"},
                           json.dumps({"target": "client", **condition}))
    assert status in (200, 202), f"chaos/network {status} {body[:200]}"


field = login("field")
admin = login("admin")
tus = {**field, "Tus-Resumable": "1.0.0"}

expected = hashlib.sha256()
for i in range((SIZE + CHUNK - 1) // CHUNK):
    expected.update(chunk_bytes(i))
expected = expected.hexdigest()

samples = []
stop = threading.Event()


def sampler():
    while not stop.is_set():
        h = heap_used()
        if h is not None:
            samples.append(h)
        stop.wait(5)


threading.Thread(target=sampler, daemon=True).start()
print(f"1. Slow lane on: {LATENCY} ms round trip, {LOSS:g}% of connections broken. File: {SIZE // (1024 * 1024)} MiB")
try:
    network(admin, latencyMs=LATENCY, lossPct=LOSS)
    # Proof that the lane is slow and lossy: the same small request, on the lane and on the normal port.
    t = time.monotonic()
    call("GET", "/api/v1/health")
    normal = time.monotonic() - t
    lane = []
    for _ in range(10):
        t = time.monotonic()
        try:
            call("GET", "/api/v1/health", port=8443)
            lane.append(time.monotonic() - t)
        except OSError:
            pass
    check("the lane is slower than the normal port", bool(lane) and min(lane) > normal + 0.2,
          f"{normal * 1000:.0f} ms normal, {min(lane) * 1000:.0f} ms on the lane" if lane else "no answer")

    meta = ",".join(f"{k} {base64.b64encode(v.encode()).decode()}" for k, v in
                    {"category": "video", "filename": "slow-lane.mp4", "filetype": "video/mp4", "region": "muntenia"}.items())
    for attempt in range(20):
        try:
            status, h, _ = call("POST", "/api/v1/files/tus", {**tus, "Upload-Length": str(SIZE), "Upload-Metadata": meta}, port=8443)
            if status == 201:
                break
        except OSError:
            pass
    assert status == 201, f"create {status}"
    location = h["location"]

    print("2. Upload, resuming after every broken connection")
    started = time.monotonic()
    offset, file_id, breaks = 0, None, 0
    last_print = 0
    while offset < SIZE:
        index = offset // CHUNK
        piece = chunk_bytes(index)[offset - index * CHUNK:]
        try:
            status, h, body = call("PATCH", location, {**tus, "Content-Type": "application/offset+octet-stream",
                                                       "Upload-Offset": str(offset), "Content-Length": str(len(piece))},
                                   piece, port=8443)
        except (OSError, http.client.HTTPException):
            status, h = None, {}
        if status == 204:
            offset = int(h["upload-offset"])
            file_id = h.get("x-filegrid-file-id", file_id)
        else:
            # A broken connection (or any other answer): ask the server where it is.
            breaks += 1
            for _ in range(30):
                try:
                    s2, h2, _ = call("HEAD", location, tus, port=8443)
                    if s2 == 200:
                        offset = int(h2["upload-offset"])
                        break
                except (OSError, http.client.HTTPException):
                    pass
            else:
                raise SystemExit("could not learn the offset after 30 tries")
        if offset // (64 * 1024 * 1024) > last_print:
            last_print = offset // (64 * 1024 * 1024)
            print(f"  {offset // (1024 * 1024)} MiB, {breaks} broken so far, {time.monotonic() - started:.0f} s")
    elapsed = time.monotonic() - started
finally:
    network(admin, latencyMs=0, lossPct=0)
    stop.set()

assert file_id, "no X-FileGrid-File-Id on the last chunk"
mib = SIZE / 1024 / 1024
print(f"  uploaded in {elapsed:.0f} s ({mib / elapsed:.1f} MiB/s), {breaks} times the client had to ask where the upload stood, "
      f"each costs at most one {CHUNK // 1024 // 1024} MiB chunk")
check("the link broke and the upload still finished", breaks > 0 or LOSS == 0, f"{breaks} breaks")

print("3. What is stored")
status, _, body = call("GET", f"/api/v1/files/{file_id}", field)
meta_json = json.loads(body)
check("size is exactly the size sent", meta_json["sizeBytes"] == SIZE, str(meta_json["sizeBytes"]))
check("SHA-256 is the hash of what was sent", meta_json["sha256"] == expected, meta_json["sha256"][:16] + "...")
status, _, body = call("POST", f"/api/v1/files/{file_id}/download-link", field)
c = conn(443)
c.request("GET", json.loads(body)["url"])
r = c.getresponse()
digest, total = hashlib.sha256(), 0
while True:
    block = r.read(1024 * 1024)
    if not block:
        break
    digest.update(block)
    total += len(block)
c.close()
check("a normal download gives the same bytes", r.status == 200 and total == SIZE and digest.hexdigest() == expected,
      f"{total} bytes")
status, _, body = call("POST", f"/api/v1/files/{file_id}/verify", field)
check("verify says ok", json.loads(body)["ok"] is True)
if samples:
    print(f"  API heap while it ran: min {min(samples):.0f} / max {max(samples):.0f} MiB ({len(samples)} samples), file {mib:.0f} MiB")

print()
print("RESULT: " + ("OK" if not failures else "FAILED: " + "; ".join(failures)))
sys.exit(1 if failures else 0)
