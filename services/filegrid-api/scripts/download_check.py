#!/usr/bin/env python3
"""Proves, on the running stack, how a large download behaves.

  1. A file up to the limit (64 MiB) is hashed first: the first byte waits for that pass.
  2. A larger file is read once: the first byte leaves at once, and it still arrives identical.
  3. A larger file that fails its check is cut short: the client never gets a complete body,
     the failure is counted, and the file is marked corrupt. After the hash is put back it reads again.

The files are generated in memory and sent as category video (policy: s3). The "corrupt" case changes the
recorded hash in Postgres, so the stored bytes no longer match it, and puts it back. Run from the repo root
with the stack up: `make a-download-check` (MIB_SMALL=48 MIB_LARGE=96 to change the sizes).
"""
import hashlib, http.client, json, os, ssl, subprocess, sys, time

sys.path.insert(0, os.path.dirname(__file__))
import audit_check  # noqa: E402

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
MIB = 1024 * 1024
SMALL = int(os.environ.get("MIB_SMALL", "48")) * MIB
LARGE = int(os.environ.get("MIB_LARGE", "96")) * MIB
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


def conn():
    return http.client.HTTPSConnection("localhost", 443, context=ctx, timeout=600)


def call(method, path, headers=None, body=None):
    c = conn()
    c.request(method, path, body=body, headers=headers or {})
    r = c.getresponse()
    data = r.read()
    out = (r.status, {k.lower(): v for k, v in r.getheaders()}, data)
    c.close()
    return out


def login(user):
    status, _, body = call("POST", "/api/v1/auth/login", {"Content-Type": "application/json"},
                           json.dumps({"username": user, "password": env_value("DEMO_PASSWORD")}))
    assert status == 200, f"login {user}: {status}"
    return {"Authorization": "Bearer " + json.loads(body)["token"]}


def make_bytes(size):
    block = os.urandom(1 * MIB)
    return (block * (size // MIB + 1))[:size]


def upload(headers, content):
    boundary = "----fg" + os.urandom(8).hex()
    head = (f'--{boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\nvideo\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="region"\r\n\r\nmuntenia\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.mp4"\r\n'
            f'Content-Type: video/mp4\r\n\r\n').encode()
    tail = f"\r\n--{boundary}--\r\n".encode()
    total = len(head) + len(content) + len(tail)
    c = conn()
    c.putrequest("POST", "/api/v1/files")
    for k, v in {**headers, "Content-Type": f"multipart/form-data; boundary={boundary}",
                 "Content-Length": str(total)}.items():
        c.putheader(k, v)
    c.endheaders()
    c.send(head)
    for i in range(0, len(content), MIB):
        c.send(content[i:i + MIB])
    c.send(tail)
    r = c.getresponse()
    data = r.read()
    c.close()
    return r.status, data


def tus_upload(headers, content):
    """Multipart is capped at 64 MiB, so a larger file goes up the way the field app sends video: tus, 16 MiB chunks."""
    import base64
    tus = {**headers, "Tus-Resumable": "1.0.0"}
    meta = ",".join(f"{k} {base64.b64encode(v.encode()).decode()}" for k, v in
                    {"category": "video", "filename": "clip.mp4", "filetype": "video/mp4", "region": "muntenia"}.items())
    status, h, _ = call("POST", "/api/v1/files/tus", {**tus, "Upload-Length": str(len(content)), "Upload-Metadata": meta})
    assert status == 201, f"tus create {status}"
    location, offset, file_id = h["location"], 0, None
    step = 16 * MIB
    while offset < len(content):
        piece = content[offset:offset + step]
        status, h, body = call("PATCH", location, {**tus, "Content-Type": "application/offset+octet-stream",
                                                   "Upload-Offset": str(offset), "Content-Length": str(len(piece))}, piece)
        assert status == 204, f"tus patch {status} {body[:200]}"
        offset = int(h["upload-offset"])
        file_id = h.get("x-filegrid-file-id", file_id)
    return file_id


def timed_download(headers, fid):
    """Returns (status, headers, bytes received, seconds to first body byte, total seconds, complete?)."""
    c = conn()
    started = time.monotonic()
    c.request("GET", f"/api/v1/files/{fid}/content", headers=headers)
    r = c.getresponse()
    first = None
    got = bytearray()
    complete = True
    try:
        while True:
            chunk = r.read(256 * 1024)
            if not chunk:
                break
            if first is None:
                first = time.monotonic() - started
            got.extend(chunk)
    except (http.client.IncompleteRead, ConnectionError, OSError) as e:
        complete = False
        if isinstance(e, http.client.IncompleteRead):
            got.extend(e.partial)
    total = time.monotonic() - started
    hdrs = {k.lower(): v for k, v in r.getheaders()}
    # read(n) returns b"" when the server closes early, so compare with what Content-Length promised.
    if "content-length" in hdrs and len(got) != int(hdrs["content-length"]):
        complete = False
    c.close()
    return r.status, hdrs, bytes(got), first, total, complete


def metric_sum(name, label):
    out = subprocess.run(["docker", "compose", "exec", "-T", "filegrid-api", "wget", "-qO-",
                          "http://127.0.0.1:8080/actuator/prometheus"], capture_output=True, text=True).stdout
    return sum(float(l.rsplit(" ", 1)[1]) for l in out.splitlines()
               if l.startswith(name + "{") and label in l)


# ---------------------------------------------------------------------------------------------
admin = login("admin")

print(f"1. A {SMALL // MIB} MiB file (up to the limit): hashed first")
small = make_bytes(SMALL)
small_sha = hashlib.sha256(small).hexdigest()
status, body = upload(admin, small)
assert status == 201, f"upload {status} {body[:200]}"
small_id = json.loads(body)["id"]
status, h, data, first_small, total_small, complete = timed_download(admin, small_id)
check("it comes back identical", status == 200 and complete and hashlib.sha256(data).hexdigest() == small_sha)
print(f"  first byte after {first_small:.2f} s, whole file after {total_small:.2f} s")
del small, data

print(f"2. A {LARGE // MIB} MiB file (over the limit): read once")
large = make_bytes(LARGE)
large_sha = hashlib.sha256(large).hexdigest()
fid = tus_upload(admin, large)
assert fid, "no file id from the last chunk"
status, _, body = call("GET", f"/api/v1/files/{fid}", admin)
check("receipt hash is of the original bytes", json.loads(body)["sha256"] == large_sha)
reads_before = metric_sum("filegrid_ops_total", 'op="read"')
status, h, data, first_large, total_large, complete = timed_download(admin, fid)
check("it comes back identical", status == 200 and complete and hashlib.sha256(data).hexdigest() == large_sha)
check("X-Content-SHA256 is the original's hash", h.get("x-content-sha256") == large_sha)
check("the first byte does not wait for a hashing pass",
      first_large < max(0.5, first_small * 0.5), f"{first_large:.2f} s (the {SMALL // MIB} MiB file: {first_small:.2f} s)")
print(f"  first byte after {first_large:.2f} s, whole file after {total_large:.2f} s")
check("the read was counted once, ok", metric_sum("filegrid_ops_total", 'op="read"') == reads_before + 1)
check("the file is marked verified", audit_check.psql(
    f"select last_verified_at is not null from files where id = '{fid}'") == "t")
status, _, _ = call("POST", f"/api/v1/files/{fid}/verify", admin)
check("verify works as before", status == 200)
del data

print("3. The same large file, with a recorded hash that does not match the stored bytes")
failures_before = metric_sum("filegrid_integrity_failures_total", 'category="video"')
audit_check.psql(f"update files set sha256 = repeat('0', 64) where id = '{fid}'")
try:
    status, h, data, first_bad, total_bad, complete = timed_download(admin, fid)
    check("the transfer is cut short, never complete", not complete or len(data) < LARGE,
          f"{len(data)} of {LARGE} bytes received, complete={complete}")
    check("the last chunk was held back", len(data) <= LARGE - 1, f"missing {LARGE - len(data)} bytes")
    time.sleep(1)
    check("filegrid_integrity_failures_total went up",
          metric_sum("filegrid_integrity_failures_total", 'category="video"') == failures_before + 1)
    state = audit_check.psql(f"select status from files where id = '{fid}'")
    check("the file is marked corrupt", state == "corrupt", state)
finally:
    audit_check.psql(f"update files set sha256 = '{large_sha}', status = 'stored' where id = '{fid}'")
status, h, data, _, _, complete = timed_download(admin, fid)
check("with the hash put back it reads again", status == 200 and complete and hashlib.sha256(data).hexdigest() == large_sha)

print()
print("RESULT: " + ("OK" if not failures else "FAILED: " + "; ".join(failures)))
sys.exit(1 if failures else 0)
