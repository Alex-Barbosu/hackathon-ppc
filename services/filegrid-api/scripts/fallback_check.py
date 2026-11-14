#!/usr/bin/env python3
"""Proves, on the running stack, what happens when a storage dies and comes back.

WARNING: this STOPS and restarts the seaweedfs (S3) container and, unless --skip-db is given, the
postgres container. It always starts them again at the end. Run it on a local stack, not a shared one.

  1. A document is stored (policy: ftp, fallback s3). If ftp is not healthy here, the fallback is what is tested.
  2. S3 is stopped. The circuit opens. An outage file falls back to the database, a video falls back
     to the spool and is readable from there, the circuit and spool gauges show it.
  3. S3 is started. The spool drains to 0, the video is now in s3, its bytes and SHA-256 unchanged.
  4. Postgres is stopped. Meter readings are still accepted (parked on disk), a retry is a duplicate.
     Postgres is started. The readings land in the database exactly once each.

The files are generated in memory, so no file is read or sent. Run from the repo root with the stack up:
`make a-fallback-check` (add SKIP_DB=1 to leave postgres alone).
"""
import hashlib, http.client, json, os, random, ssl, subprocess, sys, time

sys.path.insert(0, os.path.dirname(__file__))
import audit_check  # noqa: E402  (psql helper)

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
SKIP_DB = "--skip-db" in sys.argv
RUN = str(int(time.time()))
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


def multipart(category, content, filename="f.bin"):
    b = "----fg" + os.urandom(8).hex()
    body = (f'--{b}\r\nContent-Disposition: form-data; name="category"\r\n\r\n{category}\r\n'
            f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n").encode() + content + f"\r\n--{b}--\r\n".encode()
    return body, f"multipart/form-data; boundary={b}"


def upload(auth, category, content):
    body, ctype = multipart(category, content)
    status, _, resp = call("POST", "/api/v1/files", {**auth, "Content-Type": ctype}, body)
    return status, (json.loads(resp) if resp else {})


def metrics():
    out = subprocess.run(["docker", "compose", "exec", "-T", "filegrid-api", "wget", "-qO-",
                          "http://127.0.0.1:8080/actuator/prometheus"], capture_output=True, text=True).stdout
    return out.splitlines()


def metric(name, **labels):
    total = 0.0
    for line in metrics():
        if line.startswith(name + "{") and all(f'{k}="{v}"' in line for k, v in labels.items()):
            total += float(line.rsplit(" ", 1)[1])
    return total


def wait_for(label, condition, timeout=90, every=2):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if condition():
                return True
        except Exception:
            pass
        time.sleep(every)
    return False


def health(auth):
    status, _, body = call("GET", "/api/v1/storages/health", auth)
    return {h["storage"]: h for h in json.loads(body)} if status == 200 else {}


def compose(*args):
    subprocess.run(["docker", "compose", *args], capture_output=True, text=True, timeout=180)


def sha(b):
    return hashlib.sha256(b).hexdigest()


def download(auth, fid):
    status, h, data = call("GET", f"/api/v1/files/{fid}/content", auth)
    return status, h, data


def file_row(fid):
    return audit_check.psql(f"select storage || '/' || status from files where id = '{fid}'")


rng = random.Random(RUN)
admin = login("admin")
dispatch = login("dispatch")
connections = login("connections")
field = login("field")

print("0. Starting state")
h = health(admin)
check("db and s3 are up", h.get("db", {}).get("up") and h.get("s3", {}).get("up"), json.dumps({k: v["up"] for k, v in h.items()}))
ftp_up = bool(h.get("ftp", {}).get("up"))
print(f"  ftp is {'up' if ftp_up else 'DOWN (so documents are expected to fall back to s3)'}")

print("1. A document, with every storage as it is")
doc = rng.randbytes(200_000)
status, r = upload(connections, "document", doc)
check("document stored (201)", status == 201, f"status {status}")
if status == 201:
    check("it went where the policy and the storages allow", r["storage"] == ("ftp" if ftp_up else "s3"), r["storage"])
    check("encrypted", r["encrypted"] is True)
    st, _, data = download(connections, r["id"])
    check("downloads identical", st == 200 and data == doc)

try:
    print("2. Stop S3")
    compose("stop", "seaweedfs")
    opened = wait_for("s3 circuit opens", lambda: health(admin).get("s3", {}).get("circuitOpen"), timeout=60)
    check("the s3 circuit opens within a minute, with no user traffic", opened)
    check("s3 is reported down", health(admin).get("s3", {}).get("up") is False)

    outage = rng.randbytes(2 * 1024 * 1024)
    status, r = upload(dispatch, "outage", outage)
    check("outage file still stored (201)", status == 201, f"status {status}")
    check("it fell back to the database", r.get("storage") == "db", r.get("storage"))
    st, _, data = download(dispatch, r["id"])
    check("and downloads identical", st == 200 and data == outage)
    outage_id = r["id"]

    video = rng.randbytes(3 * 1024 * 1024)
    status, r = upload(field, "video", video)
    check("video still accepted (201)", status == 201, f"status {status}")
    check("it was parked in the spool", r.get("storage") == "spool", r.get("storage"))
    vid = r["id"]
    check("its row says spooled", file_row(vid) == "spool/spooled", file_row(vid))
    on_disk = subprocess.run(["docker", "compose", "exec", "-T", "filegrid-api", "ls", f"/var/filegrid/spool/video/{vid}"],
                             capture_output=True, text=True).returncode == 0
    check("and the file is on the spool volume", on_disk)
    st, hdr, data = download(field, vid)
    check("a parked video can be downloaded, identical", st == 200 and data == video and hdr.get("x-content-sha256") == sha(video))

    status, r = upload(connections, "document", rng.randbytes(50_000))
    if ftp_up:
        check("a document still works (ftp is its primary)", status == 201 and r.get("storage") == "ftp")
    else:
        check("with ftp AND s3 down a document is refused cleanly (503), not lost", status == 503, f"status {status}")

    check("filegrid_circuit_open{s3} is 1", metric("filegrid_circuit_open", storage="s3") == 1.0)
    check("filegrid_storage_up{s3} is 0", wait_for("up gauge", lambda: metric("filegrid_storage_up", storage="s3") == 0.0, 20))
    check("filegrid_spool_pending{video} shows the parked video",
          wait_for("pending gauge", lambda: metric("filegrid_spool_pending", category="video") >= 1, 20))
    # The probes opened the circuit before this upload, so s3 was skipped, not tried: no s3 error is expected.
    check("the outage write is counted as a fallback on db",
          metric("filegrid_ops_total", category="outage", storage="db", op="write", outcome="fallback") >= 1)
    check("video writes are counted as fallbacks on the spool",
          metric("filegrid_ops_total", category="video", storage="spool", op="write", outcome="fallback") >= 1)
finally:
    print("3. Start S3")
    compose("start", "seaweedfs")

moved = wait_for("spool drains", lambda: file_row(vid) == "s3/stored", timeout=150, every=3)
check("the parked video is moved to s3 on its own", moved, file_row(vid))
check("the circuit closes", wait_for("closed", lambda: health(admin).get("s3", {}).get("circuitOpen") is False, 60))
check("filegrid_spool_pending{video} is back to 0",
      wait_for("pending 0", lambda: metric("filegrid_spool_pending", category="video") == 0.0, 30))
check("the spool item is gone", audit_check.psql(f"select count(*) from spool_items where file_id = '{vid}'") == "0")
gone = subprocess.run(["docker", "compose", "exec", "-T", "filegrid-api", "ls", f"/var/filegrid/spool/video/{vid}"],
                      capture_output=True, text=True).returncode != 0
check("and the spool file is removed", gone)
st, hdr, data = download(field, vid)
check("the video downloads identical from s3, same SHA-256", st == 200 and data == video and hdr.get("x-content-sha256") == sha(video))
st, _, data = download(dispatch, outage_id)
check("the outage file that fell back to the database is still readable", st == 200 and data == outage)

if SKIP_DB:
    print("4. (skipped: --skip-db)")
else:
    print("4. Stop Postgres: meter readings")
    device = {"Authorization": "Bearer " + env_value("METER_DEVICE_TOKEN"), "Content-Type": "application/json"}
    meters = [f"RO-MT-8{RUN[-5:]}{i}" for i in range(3)]
    period = "2026-11-14T16:00:00Z"

    def reading(meter, seq):
        key = f"{meter}:{period}:{seq}"
        body = json.dumps({"meterId": meter, "region": "dobrogea", "county": "Constanta", "periodStart": period,
                           "seq": seq, "intervals": [{"ts": period, "kwh": 0.2, "voltage": 230.1}]})
        return key, body

    accepted_before = metric("filegrid_meter_readings_total", result="accepted")
    duplicate_before = metric("filegrid_meter_readings_total", result="duplicate")
    try:
        compose("stop", "postgres")
        time.sleep(3)
        results = []
        for i, m in enumerate(meters):
            key, body = reading(m, i + 1)
            st, _, resp = call("POST", "/api/v1/meter-readings", {**device, "Idempotency-Key": key}, body)
            results.append((st, json.loads(resp).get("result")))
        check("every reading is still accepted (201) while the database is down",
              all(s == 201 and r == "accepted" for s, r in results), str(results))
        key, body = reading(meters[0], 1)
        st, _, resp = call("POST", "/api/v1/meter-readings", {**device, "Idempotency-Key": key}, body)
        check("a retry of one is a duplicate (200), not a second copy", st == 200 and json.loads(resp)["result"] == "duplicate")
        check("filegrid_spool_pending{meter} shows the 3 parked readings",
              wait_for("meter pending", lambda: metric("filegrid_spool_pending", category="meter") == 3.0, 20))
        st, _, _ = call("POST", "/api/v1/auth/login", {"Content-Type": "application/json"},
                        json.dumps({"username": "admin", "password": env_value("DEMO_PASSWORD")}))
        check("the API itself stays up and answers (login needs no database)", st == 200)
    finally:
        print("5. Start Postgres")
        compose("start", "postgres")

    drained = wait_for("meter spool drains", lambda: metric("filegrid_spool_pending", category="meter") == 0.0, timeout=150, every=3)
    check("the parked readings are inserted and the spool empties", drained)
    ids = ",".join(f"'{m}'" for m in meters)
    rows = wait_for("rows", lambda: audit_check.psql(f"select count(*) from meter_readings where meter_id in ({ids})") == "3", 60)
    check("exactly 3 rows in meter_readings, one per reading", rows,
          audit_check.psql(f"select count(*) from meter_readings where meter_id in ({ids})"))
    dup = audit_check.psql(f"select count(*) from (select meter_id, seq from meter_readings where meter_id in ({ids}) "
                           f"group by 1, 2 having count(*) > 1) d")
    check("no reading is stored twice", dup == "0")
    check("accepted went up by 3 and duplicate by 1",
          metric("filegrid_meter_readings_total", result="accepted") - accepted_before == 3
          and metric("filegrid_meter_readings_total", result="duplicate") - duplicate_before == 1)
    check("the database circuit is closed again", wait_for("db closed", lambda: health(admin).get("db", {}).get("circuitOpen") is False, 60))

print()
if failures:
    print(f"RESULT: {len(failures)} check(s) FAILED: {', '.join(failures)}")
    sys.exit(1)
print("RESULT: OK")
