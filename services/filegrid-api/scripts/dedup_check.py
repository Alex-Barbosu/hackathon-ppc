#!/usr/bin/env python3
"""Proves, on the running stack, content dedup for identical uploads (same category):

  1. The same outage file uploaded twice (same region): the second answer is the first file's receipt (same id and
     signature), with `X-FileGrid-Deduplicated: true`, status 201; one row in `files`; a download works.
  2. Not merged: another region, a forced storage (Storage Lab), and documents (encrypted, audited).
  3. The existing copy is checked before the new bytes are thrown away: with the stored copy damaged, the new upload is
     stored as a file of its own, and the damaged one is not returned.
  4. A file stored in the database is merged with too (the existing copy can be in any storage).

The files are generated in memory; what it makes is deleted at the end. Run from the repo root with the stack up:
`make a-dedup-check`.
"""
import hashlib, http.client, json, os, ssl, sys

sys.path.insert(0, os.path.dirname(__file__))
import audit_check  # noqa: E402

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
failures = []
made = []


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
    c = http.client.HTTPSConnection("localhost", 443, context=ctx, timeout=120)
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


def upload(auth, category, content, region="banat", extra=None):
    boundary = "----fg" + os.urandom(6).hex()
    form = (f'--{boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\n{category}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="region"\r\n\r\n{region}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="record.bin"\r\n'
            f'Content-Type: application/octet-stream\r\n\r\n').encode() + content + f"\r\n--{boundary}--\r\n".encode()
    status, headers, body = call("POST", "/api/v1/files", {**auth, **(extra or {}),
                                 "Content-Type": f"multipart/form-data; boundary={boundary}"}, form)
    receipt = json.loads(body)
    if status == 201 and receipt["id"] not in made:
        made.append(receipt["id"])
    return status, headers, receipt


def rows(sha):
    return int(audit_check.psql(f"select count(*) from files where sha256 = '{sha}'"))


admin = login("admin")
dispatch = login("dispatch")
connections = login("connections")
try:
    print("1. The same outage file twice")
    data = os.urandom(60_000)
    sha = hashlib.sha256(data).hexdigest()
    s1, h1, first = upload(dispatch, "outage", data)
    s2, h2, second = upload(dispatch, "outage", data)
    check("first upload is new (201, no header)", s1 == 201 and "x-filegrid-deduplicated" not in h1)
    check("second upload is the same file: 201 with the header", s2 == 201 and h2.get("x-filegrid-deduplicated") == "true")
    check("same id and same signed receipt", second["id"] == first["id"] and second["signature"] == first["signature"])
    check("one row in files", rows(sha) == 1, str(rows(sha)))
    status, _, body = call("GET", f"/api/v1/files/{first['id']}/content", dispatch)
    check("the file downloads, identical", status == 200 and body == data)

    print("2. Not merged")
    _, h3, other_region = upload(dispatch, "outage", data, region="muntenia")
    check("another region is its own file", other_region["id"] != first["id"] and "x-filegrid-deduplicated" not in h3)
    _, h4, forced = upload(admin, "outage", data, extra={"X-FileGrid-Force-Storage": "db"})
    check("a forced storage is its own file", forced["id"] != first["id"] and "x-filegrid-deduplicated" not in h4)
    doc = os.urandom(30_000)
    _, hd1, d1 = upload(connections, "document", doc)
    _, hd2, d2 = upload(connections, "document", doc)
    check("a document is never merged", d1["id"] != d2["id"] and "x-filegrid-deduplicated" not in hd2)
    check("each document has its own row", rows(hashlib.sha256(doc).hexdigest()) == 2)

    print("3. The existing copy is checked first")
    damaged = os.urandom(20_000)
    dsha = hashlib.sha256(damaged).hexdigest()
    _, _, stored_db = upload(admin, "outage", damaged, region="dobrogea", extra={"X-FileGrid-Force-Storage": "db"})
    s5, h5, merged = upload(dispatch, "outage", damaged, region="dobrogea")
    check("a copy stored in the database is merged with", h5.get("x-filegrid-deduplicated") == "true"
          and merged["id"] == stored_db["id"], f"storage {merged['storage']}")
    audit_check.psql(f"update stored_blobs set data = set_byte(data, 100, get_byte(data, 100) # 1) where file_id = '{stored_db['id']}'")
    s6, h6, fresh = upload(dispatch, "outage", damaged, region="dobrogea")
    check("with that copy damaged, the new upload is kept as its own file",
          s6 == 201 and "x-filegrid-deduplicated" not in h6 and fresh["id"] != stored_db["id"])
    status, _, body = call("GET", f"/api/v1/files/{fresh['id']}/content", dispatch)
    check("and it downloads, identical", status == 200 and body == damaged)
    check("two rows now: the damaged one and the good one", rows(dsha) == 2, str(rows(dsha)))
finally:
    for fid in made:
        call("DELETE", f"/api/v1/files/{fid}", admin)

print()
print("RESULT: " + ("OK" if not failures else "FAILED: " + "; ".join(failures)))
sys.exit(1 if failures else 0)
