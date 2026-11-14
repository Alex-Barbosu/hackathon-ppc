#!/usr/bin/env python3
"""Proves, on the running stack, that the policy can be changed while the API runs.

  1. Who may read and who may change it, and what a refused change looks like.
  2. PUT /policy changes where the next upload goes immediately, with no restart; history and the
     audit log record it.
  3. An edit of config/policy.yaml is picked up by itself; a broken edit is ignored.
  4. A policy applied through the API survives a restart of the API.

It briefly edits config/policy.yaml on this machine (step 3) and always puts it back as it was.
The files it uploads are generated in memory. Run from the repo root with the stack up:
`make a-policy-check` (add NO_FILE=1 to skip step 3, NO_RESTART=1 to skip step 4).
"""
import copy, hashlib, http.client, json, os, random, ssl, subprocess, sys, time

sys.path.insert(0, os.path.dirname(__file__))
import audit_check  # noqa: E402

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
POLICY_FILE = "config/policy.yaml"
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


def get_policy(auth):
    status, _, body = call("GET", "/api/v1/policy", auth)
    assert status == 200, f"GET policy: {status}"
    return json.loads(body)


def put_policy(auth, policy):
    body = policy if isinstance(policy, (str, bytes)) else json.dumps(policy)
    return call("PUT", "/api/v1/policy", {**auth, "Content-Type": "application/json"}, body)


def upload_outage(auth, content):
    b = "----fg" + os.urandom(8).hex()
    body = (f'--{b}\r\nContent-Disposition: form-data; name="category"\r\n\r\noutage\r\n'
            f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="o.bin"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n").encode() + content + f"\r\n--{b}--\r\n".encode()
    status, _, resp = call("POST", "/api/v1/files", {**auth, "Content-Type": f"multipart/form-data; boundary={b}"}, body)
    return status, (json.loads(resp) if resp else {})


def wait_for(condition, timeout=30, every=1):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if condition():
                return True
        except Exception:
            pass
        time.sleep(every)
    return False


def with_outage_primary(policy, primary):
    p = copy.deepcopy(policy)
    p["categories"]["outage"]["primary"] = primary
    return p


admin = login("admin")
dispatch = login("dispatch")
data = random.Random(time.time()).randbytes(300_000)
start = get_policy(admin)
original_primary = start["categories"]["outage"]["primary"]
other = "db" if original_primary != "db" else "s3"
print(f"Starting policy: version {start['version']}, outage goes to {original_primary}")

print("1. Who may read and change it")
for who, auth in (("admin", admin), ("dispatch", dispatch)):
    status, _, _ = call("GET", "/api/v1/policy/history", auth)
    check(f"{who} can read the policy and its history", status == 200)
status, _, _ = put_policy(dispatch, start)
check("dispatch cannot change it (403)", status == 403, f"status {status}")
status, _, _ = call("PUT", "/api/v1/policy", {"Content-Type": "application/json"}, json.dumps(start))
check("no token is 401", status == 401)
status, _, body = put_policy(admin, with_outage_primary(start, "minio"))
check("an unknown storage is refused (400) with the reason", status == 400 and "outage" in body.decode(), body.decode()[:110])
bad = copy.deepcopy(start)
bad["categories"]["outage"]["colour"] = "red"
status, _, body = put_policy(admin, bad)
check("an unknown key is refused, not dropped (400)", status == 400)
status, _, _ = put_policy(admin, "{not json")
check("a body that is not JSON is 400, not a server error", status == 400)
spool_primary = copy.deepcopy(start)
spool_primary["categories"]["meter"]["primary"] = "spool"
status, _, _ = put_policy(admin, spool_primary)
check("spool as a primary is refused (400)", status == 400)
check("and the policy in force did not change", get_policy(admin)["version"] == start["version"])

print("2. PUT /policy takes effect at once")
status, r = upload_outage(dispatch, data)
check(f"before: an outage file goes to {original_primary}", status == 201 and r["storage"] == original_primary, r.get("storage"))
status, _, body = put_policy(admin, with_outage_primary(start, other))
applied = json.loads(body) if status == 200 else {}
check("admin applies a change (200)", status == 200, f"status {status}")
check("the server numbered it: next version", applied.get("version") == start["version"] + 1, str(applied.get("version")))
status, r = upload_outage(dispatch, data)
check(f"the very next outage upload goes to {other}, no restart", status == 201 and r["storage"] == other, r.get("storage"))
st, _, got = call("GET", f"/api/v1/files/{r['id']}/content", dispatch)
check("and downloads identical", st == 200 and got == data)
status, _, body = put_policy(admin, with_outage_primary(start, other))
check("applying the same policy again changes nothing", status == 200 and json.loads(body)["version"] == applied["version"])
echo = with_outage_primary(start, original_primary)
echo["version"] = 999
status, _, body = put_policy(admin, echo)
back = json.loads(body)
check("the version the client sends is ignored", back["version"] == applied["version"] + 1, f"sent 999, got {back['version']}")
status, r = upload_outage(dispatch, data)
check(f"and it is back to {original_primary}", status == 201 and r["storage"] == original_primary, r.get("storage"))

status, _, body = call("GET", "/api/v1/policy/history", admin)
history = json.loads(body)
versions = [h["version"] for h in history]
check("history is newest first", versions == sorted(versions, reverse=True) and versions[0] == back["version"], str(versions[:4]))
check("history says who applied each change", history[0]["appliedBy"] == "admin" and history[0]["policy"]["categories"]["outage"]["primary"] == original_primary)

print("3. The audit log")
rows = audit_check.psql("select count(*) from audit_log where action = 'policy.update' and actor = 'admin' and file_id is null")
check("policy changes are in the audit log, with no file id", int(rows) >= 2, f"{rows} events by admin")
changes = audit_check.psql("select details->>'changes' from audit_log where action = 'policy.update' and actor = 'admin' order by id desc limit 2")
check("each says what changed", f"outage.primary {other}->{original_primary}" in changes, changes.replace("\n", " | "))
ok, count, bad_id, problem = audit_check.verify(audit_check.load_rows())
check("the hash chain still verifies (Python)", ok, f"{count} rows")

if os.environ.get("NO_FILE"):
    print("4. (skipped: NO_FILE)")
else:
    print("4. Editing config/policy.yaml while the API runs (restored at the end)")
    original_text = open(POLICY_FILE).read()
    try:
        before = get_policy(admin)
        edited = original_text.replace(f"outage:   {{ primary: {original_primary},", f"outage:   {{ primary: {other},", 1)
        assert edited != original_text, "could not find the outage line in config/policy.yaml"
        open(POLICY_FILE, "w").write(edited)
        picked = wait_for(lambda: get_policy(admin)["categories"]["outage"]["primary"] == other, timeout=30)
        check("a valid edit is applied by itself within seconds", picked)
        now = get_policy(admin)
        check("as a new version, recorded as coming from the file", now["version"] == before["version"] + 1
              and json.loads(call("GET", "/api/v1/policy/history", admin)[2])[0]["appliedBy"] == "file")

        open(POLICY_FILE, "w").write(original_text.replace(f"primary: {original_primary},", "primary: minio,", 1))
        time.sleep(9)
        check("a broken edit is ignored and the working policy stays", get_policy(admin) == now)

        open(POLICY_FILE, "w").write(original_text)
        fixed = wait_for(lambda: get_policy(admin)["categories"]["outage"]["primary"] == original_primary, timeout=30)
        check("putting the file back is applied too", fixed)
    finally:
        open(POLICY_FILE, "w").write(original_text)
    check("config/policy.yaml is back exactly as it was",
          subprocess.run(["git", "diff", "--quiet", "--", POLICY_FILE]).returncode == 0)

if os.environ.get("NO_RESTART"):
    print("5. (skipped: NO_RESTART)")
else:
    print("5. A policy applied through the API survives a restart")
    status, _, body = put_policy(admin, with_outage_primary(get_policy(admin), other))
    version_before = json.loads(body)["version"]
    subprocess.run(["docker", "compose", "restart", "filegrid-api"], capture_output=True, text=True, timeout=180)
    up = wait_for(lambda: call("GET", "/api/v1/health")[0] == 200, timeout=90, every=2)
    check("the API comes back", up)
    admin = login("admin")
    after = get_policy(admin)
    check("it still has the policy applied through the API, not the older file's",
          after["version"] == version_before and after["categories"]["outage"]["primary"] == other,
          f"version {after['version']}, outage {after['categories']['outage']['primary']}")
    status, r = upload_outage(login("dispatch"), data)
    check(f"and uploads follow it ({other})", status == 201 and r["storage"] == other, r.get("storage"))
    put_policy(admin, with_outage_primary(after, original_primary))
    check("put back to the original", get_policy(admin)["categories"]["outage"]["primary"] == original_primary)

print()
if failures:
    print(f"RESULT: {len(failures)} check(s) FAILED: {', '.join(failures)}")
    sys.exit(1)
print("RESULT: OK")
