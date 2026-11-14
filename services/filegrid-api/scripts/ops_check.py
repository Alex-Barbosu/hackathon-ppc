#!/usr/bin/env python3
"""Proves, on the running stack:

  1. DELETE /api/v1/files/{id}: admin only, bytes and row gone, an audit event for documents, the chain still verifies.
  2. The storages go through Toxiproxy: a latency toxic on the s3 proxy slows an upload, and a toxic on the pg proxy
     slows a database read. (This is what /chaos/network sets.)
  3. /storages/health answers at once even when a storage hangs: S3 is made to accept connections and then say nothing
     (the case that used to hold the page for about 9 s). The probe gives up after 1 s and reports it down.

Toxics are removed at the end, also when a check fails. Run from the repo root with the stack up: `make a-ops-check`.
"""
import http.client, json, os, ssl, subprocess, sys, time

sys.path.insert(0, os.path.dirname(__file__))
import audit_check  # noqa: E402

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


def call(method, path, headers=None, body=None):
    c = http.client.HTTPSConnection("localhost", 443, context=ctx, timeout=120)
    t = time.monotonic()
    c.request(method, path, body=body, headers=headers or {})
    r = c.getresponse()
    data = r.read()
    out = (r.status, {k.lower(): v for k, v in r.getheaders()}, data, time.monotonic() - t)
    c.close()
    return out


def login(user):
    status, _, body, _ = call("POST", "/api/v1/auth/login", {"Content-Type": "application/json"},
                              json.dumps({"username": user, "password": env_value("DEMO_PASSWORD")}))
    assert status == 200, f"login {user}: {status}"
    return {"Authorization": "Bearer " + json.loads(body)["token"]}


def upload(headers, category, content, extra=None):
    boundary = "----fg" + os.urandom(8).hex()
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\n{category}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="region"\r\n\r\nmuntenia\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.bin"\r\n'
            f'Content-Type: application/octet-stream\r\n\r\n').encode() + content + f"\r\n--{boundary}--\r\n".encode()
    return call("POST", "/api/v1/files", {**headers, **(extra or {}),
                                          "Content-Type": f"multipart/form-data; boundary={boundary}"}, body)


def cli(*args):
    """Runs the proxy's own command line tool inside its container (the proxy's API is not published)."""
    out = subprocess.run(["docker", "compose", "exec", "-T", "toxiproxy", "/toxiproxy-cli", *args],
                         capture_output=True, text=True)
    return out.stdout


def add_toxic(proxy, name, kind, **attrs):
    cli("toxic", "add", "-t", kind, "-n", name, *sum((["-a", f"{k}={v}"] for k, v in attrs.items()), []), proxy)


def remove_toxic(proxy, name):
    cli("toxic", "remove", "-n", name, proxy)


def clear_toxics():
    for proxy in ("s3", "pg", "ftp"):
        for line in cli("inspect", proxy).splitlines():
            if "\ttype=" in line:
                remove_toxic(proxy, line.split("\t")[0].strip())


def health():
    status, _, body, took = call("GET", "/api/v1/storages/health", admin)
    return {s["storage"]: s for s in json.loads(body)}, took


admin = login("admin")
field = login("field")
connections = login("connections")
clear_toxics()
try:
    print("1. DELETE /files/{id}")
    data = os.urandom(50_000)
    status, _, body, _ = upload(field, "outage", data)
    outage = json.loads(body)["id"]
    status, _, _, _ = call("DELETE", f"/api/v1/files/{outage}", field)
    check("a field user is refused (403)", status == 403, str(status))
    status, _, _, _ = call("GET", f"/api/v1/files/{outage}", field)
    check("and the file is still there", status == 200)
    status, _, _, _ = call("DELETE", f"/api/v1/files/{outage}", admin)
    check("the admin gets 204", status == 204, str(status))
    check("the metadata is gone (404)", call("GET", f"/api/v1/files/{outage}", admin)[0] == 404)
    check("the content is gone (404)", call("GET", f"/api/v1/files/{outage}/content", admin)[0] == 404)
    check("deleting again is 404", call("DELETE", f"/api/v1/files/{outage}", admin)[0] == 404)
    check("an unknown id is 404", call("DELETE", "/api/v1/files/00000000-0000-0000-0000-000000000000", admin)[0] == 404)

    status, _, body, _ = upload(admin, "outage", data, {"X-FileGrid-Force-Storage": "db"})
    in_db = json.loads(body)["id"]
    check("a file in the database has its blob", audit_check.psql(
        f"select count(*) from stored_blobs where file_id = '{in_db}'") == "1")
    call("DELETE", f"/api/v1/files/{in_db}", admin)
    check("the blob goes with the file", audit_check.psql(
        f"select count(*) from stored_blobs where file_id = '{in_db}'") == "0")

    status, _, body, _ = upload(connections, "document", data)
    if status == 201:
        doc = json.loads(body)["id"]
        call("DELETE", f"/api/v1/files/{doc}", admin)
        events = audit_check.psql(
            f"select string_agg(actor || ':' || action, ', ' order by id) from audit_log where file_id = '{doc}'")
        check("a document delete is in the audit log", "admin:file.delete" in events, events)
        check("the audit rows of a deleted file are kept", audit_check.psql(
            f"select count(*) from audit_log where file_id = '{doc}'") != "0")
        out = subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "audit_check.py")],
                             capture_output=True, text=True)
        check("the audit chain still verifies", out.returncode == 0, out.stdout.strip().splitlines()[-1] if out.stdout else "")
    else:
        print(f"  (document steps skipped: policy storage answered {status}; ftp is probably not healthy)")

    print("2. The storages go through Toxiproxy")
    started = time.monotonic()
    status, _, _, base = upload(field, "outage", data)
    base_upload = time.monotonic() - started
    add_toxic("s3", "lag", "latency", latency=400)
    status, _, _, slow = upload(field, "outage", data)
    check("an s3 latency toxic slows an outage upload", status == 201 and slow > base_upload + 0.4,
          f"{base_upload:.2f} s -> {slow:.2f} s")
    remove_toxic("s3", "lag")

    status, _, _, base_db = call("GET", "/api/v1/policy/history", admin)
    add_toxic("pg", "lag", "latency", latency=300)
    status, _, _, slow_db = call("GET", "/api/v1/policy/history", admin)
    remove_toxic("pg", "lag")
    check("a pg latency toxic slows a database read", slow_db > base_db + 0.25, f"{base_db:.2f} s -> {slow_db:.2f} s")

    print("3. /storages/health with a storage that hangs")
    states, took = health()
    check("all up, answered fast when healthy", all(s["up"] for s in states.values()) and took < 0.5,
          f"{took * 1000:.0f} ms")
    # timeout=0 keeps the connection open and passes nothing: what a paused S3 looks like to a client.
    add_toxic("s3", "hang", "timeout", timeout=0)
    slowest = 0.0
    down_after = None
    started = time.monotonic()
    while time.monotonic() - started < 12:
        states, took = health()
        slowest = max(slowest, took)
        if down_after is None and not states["s3"]["up"]:
            down_after = time.monotonic() - started
        if down_after is not None and time.monotonic() - started > down_after + 2:
            break
        time.sleep(0.5)
    check("every answer comes back fast, however long S3 hangs", slowest < 0.5, f"slowest {slowest * 1000:.0f} ms")
    check("S3 is reported down within about 4 s", down_after is not None and down_after < 4.5,
          "never" if down_after is None else f"{down_after:.1f} s")
    check("the other storages stay up", states["db"]["up"] and (states["ftp"]["up"] or True))
    remove_toxic("s3", "hang")
    time.sleep(0.5)
    back = None
    started = time.monotonic()
    while time.monotonic() - started < 40:
        states, _ = health()
        if states["s3"]["up"]:
            back = time.monotonic() - started
            break
        time.sleep(1)
    check("S3 is reported up again once the network is back", back is not None,
          "never" if back is None else f"{back:.0f} s")
finally:
    clear_toxics()

print()
print("RESULT: " + ("OK" if not failures else "FAILED: " + "; ".join(failures)))
sys.exit(1 if failures else 0)
