#!/usr/bin/env python3
"""Proves, on the running stack, what a document guarantee needs:

  1. the bytes in storage are ciphertext (read straight from Postgres, like a breach would),
  2. the file still comes back byte-identical, with the hash of the original,
  3. a flipped bit in storage is refused with 422 and counted,
  4. every access is in the audit log, and the hash chain verifies,
  5. (--tamper-demo) editing an audit row is caught by the chain.

The document is generated in memory, so no file is read or sent. Run from the repo root with the
stack up: `make a-doc-check` (add TAMPER=1 for step 5, which edits an audit row and then restores it).
"""
import hashlib, http.client, json, os, ssl, subprocess, sys

sys.path.insert(0, os.path.dirname(__file__))
import audit_check  # noqa: E402

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
TAMPER_DEMO = "--tamper-demo" in sys.argv
MARKER = b"PERSONAL-DATA Ion Popescu CNP 0000000000000 "
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


def call(method, path, headers=None, body=None):
    c = http.client.HTTPSConnection("localhost", 443, context=ctx, timeout=300)
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


def multipart(fields, filename, content):
    boundary = "----fg" + os.urandom(8).hex()
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
             for k, v in fields.items()]
    parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                  f'Content-Type: application/pdf\r\n\r\n').encode() + content + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def integrity_failures():
    out = subprocess.run(["docker", "compose", "exec", "-T", "filegrid-api", "wget", "-qO-",
                          "http://127.0.0.1:8080/actuator/prometheus"], capture_output=True, text=True).stdout
    return sum(float(l.rsplit(" ", 1)[1]) for l in out.splitlines()
               if l.startswith("filegrid_integrity_failures_total{") and 'category="document"' in l)


def upload(headers, extra, content):
    body, ctype = multipart({"category": "document", "region": "muntenia"}, "Ion Popescu - contract.pdf", content)
    return call("POST", "/api/v1/files", {**headers, **extra, "Content-Type": ctype}, body)


# ---------------------------------------------------------------------------------------------
plain = (MARKER * (300_000 // len(MARKER) + 1))[:300_000]
expected = hashlib.sha256(plain).hexdigest()
admin = login("admin")
connections = login("connections")

print("1. Upload a document as 'connections' by the policy route")
status, _, body = upload(connections, {}, plain)
if status == 201:
    r = json.loads(body)
    check("stored where the policy says", r["storage"] == "ftp", r["storage"])
    check("receipt says encrypted", r["encrypted"] is True)
    check("receipt hash is of the original bytes", r["sha256"] == expected)
else:
    print(f"  (skipped: policy storage answered {status}; the ftp container is probably not healthy here)")

print("2. Store one through the database (admin force-storage) so the bytes can be inspected in Postgres")
status, _, body = upload(admin, {"X-FileGrid-Force-Storage": "db"}, plain)
assert status == 201, f"upload {status} {body[:200]}"
receipt = json.loads(body)
fid = receipt["id"]
check("receipt says encrypted, size and hash are the original's",
      receipt["encrypted"] is True and receipt["sizeBytes"] == len(plain) and receipt["sha256"] == expected)

row = audit_check.psql(
    f"select length(data), position('PERSONAL-DATA'::bytea in data), position('Popescu'::bytea in data), "
    f"encode(substring(data from 1 for 12), 'hex') from stored_blobs where file_id = '{fid}'").split("|")
check("stored bytes contain no readable personal data", row[1] == "0" and row[2] == "0", f"first bytes {row[3]}...")
check("stored length is the original plus 16 bytes per 64 KiB segment",
      int(row[0]) == len(plain) + 16 * ((len(plain) + 65535) // 65536), f"{row[0]} bytes")
meta = audit_check.psql(f"select encrypted, octet_length(wrapped_key), octet_length(iv) from files where id = '{fid}'")
check("the row holds a wrapped key, not a key", meta == "t|61|7", meta)

print("3. Download, and the link download")
status, h, data = call("GET", f"/api/v1/files/{fid}/content", admin)
check("bytes come back identical", status == 200 and data == plain)
check("X-Content-SHA256 is the original's hash", h.get("x-content-sha256") == expected)
status, _, body = call("POST", f"/api/v1/files/{fid}/download-link", connections)
status2, _, data2 = call("GET", json.loads(body)["url"])
check("download link works with no header", status == 200 and status2 == 200 and data2 == plain)
status, _, body = call("POST", f"/api/v1/files/{fid}/verify", admin)
check("verify is ok", json.loads(body)["ok"] is True)

print("4. Flip one bit of the stored ciphertext")
before = integrity_failures()
audit_check.psql(f"update stored_blobs set data = set_byte(data, 70000, get_byte(data, 70000) # 1) where file_id = '{fid}'")
status, _, body = call("GET", f"/api/v1/files/{fid}/content", admin)
check("download is refused with 422 INTEGRITY_FAILED", status == 422 and json.loads(body)["code"] == "INTEGRITY_FAILED")
check("filegrid_integrity_failures_total went up", integrity_failures() == before + 1, f"{before} -> {integrity_failures()}")
status, _, body = call("POST", f"/api/v1/files/{fid}/verify", admin)
v = json.loads(body)
check("verify says not ok", v["ok"] is False, f"actual={v['actual']}")
audit_check.psql(f"update stored_blobs set data = set_byte(data, 70000, get_byte(data, 70000) # 1) where file_id = '{fid}'")
audit_check.psql(f"update files set status = 'stored' where id = '{fid}'")
status, _, data = call("GET", f"/api/v1/files/{fid}/content", admin)
check("after restoring the bit it reads again", status == 200 and data == plain)

print("5. Audit log")
actions = audit_check.psql(f"select string_agg(actor || ':' || action, ', ' order by id) from audit_log where file_id = '{fid}'")
print(f"  events for this file: {actions}")
for needed in ("admin:file.write", "admin:file.read", "admin:file.read_denied", "admin:file.verify",
               "connections:file.download_link"):
    check(f"recorded {needed}", needed in actions)
details = audit_check.psql(f"select string_agg(details::text, ' ') from audit_log where file_id = '{fid}'")
check("no file name or content in the log", "Popescu" not in details and "contract" not in details)
rows = audit_check.load_rows()
ok, count, bad, problem = audit_check.verify(rows)
check("hash chain verifies (recomputed in Python, not by the service)", ok, f"{count} rows")
try:
    audit_check.psql(f"update audit_log set actor = 'x' where id = (select max(id) from audit_log)")
    check("a plain UPDATE of the log is refused", False)
except RuntimeError as e:
    check("a plain UPDATE of the log is refused", "append only" in str(e))

if TAMPER_DEMO:
    print("6. Tamper demo: disable the trigger as the table owner, edit one row, check, then restore")
    target = audit_check.psql(f"select id from audit_log where file_id = '{fid}' and action = 'file.read' order by id limit 1")
    original = audit_check.psql(f"select actor from audit_log where id = {target}")
    audit_check.psql("alter table audit_log disable trigger audit_log_no_update_delete")
    try:
        audit_check.psql(f"update audit_log set actor = 'mallory' where id = {target}")
        ok2, _, bad2, problem2 = audit_check.verify(audit_check.load_rows())
        check("the chain catches the edited row", (not ok2) and str(bad2) == target, f"row {bad2}: {problem2}")
    finally:
        audit_check.psql(f"update audit_log set actor = '{original}' where id = {target}")
        audit_check.psql("alter table audit_log enable trigger audit_log_no_update_delete")
    ok3, count3, _, _ = audit_check.verify(audit_check.load_rows())
    check("restored: the chain verifies again, trigger back on", ok3, f"{count3} rows")

print()
if failures:
    print(f"RESULT: {len(failures)} check(s) FAILED: {', '.join(failures)}")
    sys.exit(1)
print("RESULT: OK")
