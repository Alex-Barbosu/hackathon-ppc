#!/usr/bin/env python3
"""Proves, on the running stack, that a storm in one category does not degrade the others.

  1. Meter readings alone: the normal latency.
  2. The same burst of outage uploads, first with the default limits (outage: 8 workers, queue 500),
     then after PUT /policy lowers them to 2 workers and a queue of 4 (no restart).
  3. During the second burst, meter readings and document uploads keep going. Their latency and
     success are measured, and the outage queue depth is sampled from /actuator/prometheus.

It changes the outage limits through PUT /policy and puts them back at the end. The files are
generated in memory. Run from the repo root with the stack up: `make a-bulkhead-check`.
"""
import copy, http.client, json, os, random, ssl, statistics, subprocess, sys, threading, time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(__file__))

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
failures = []
BURST = 80
FILE_BYTES = 512 * 1024


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


def multipart(category, content):
    b = "----fg" + os.urandom(8).hex()
    body = (f'--{b}\r\nContent-Disposition: form-data; name="category"\r\n\r\n{category}\r\n'
            f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="f.bin"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n").encode() + content + f"\r\n--{b}--\r\n".encode()
    return body, f"multipart/form-data; boundary={b}"


def upload(auth, category, content):
    body, ctype = multipart(category, content)
    t = time.time()
    status, headers, resp = call("POST", "/api/v1/files", {**auth, "Content-Type": ctype}, body)
    return status, headers, resp, time.time() - t


RUN = str(int(time.time()))
counter = [0]
counter_lock = threading.Lock()


def send_meter(device):
    with counter_lock:
        counter[0] += 1
        n = counter[0]
    meter = f"RO-MT-7{RUN[-5:]}"
    period = "2026-11-14T18:00:00Z"
    body = json.dumps({"meterId": meter, "region": "banat", "county": "Timis", "periodStart": period, "seq": n,
                       "intervals": [{"ts": period, "kwh": 0.2, "voltage": 230.0}]})
    t = time.time()
    status, _, _ = call("POST", "/api/v1/meter-readings", {**device, "Idempotency-Key": f"{meter}:{period}:{n}"}, body)
    return status, time.time() - t


def queue_depth(category):
    out = subprocess.run(["docker", "compose", "exec", "-T", "filegrid-api", "wget", "-qO-",
                          "http://127.0.0.1:8080/actuator/prometheus"], capture_output=True, text=True).stdout
    for line in out.splitlines():
        if line.startswith("filegrid_queue_depth{") and f'category="{category}"' in line:
            return float(line.rsplit(" ", 1)[1])
    return -1.0


def pct(values, p):
    s = sorted(values)
    return s[min(len(s) - 1, int(len(s) * p))] * 1000 if s else 0.0


def burst(auth, n):
    """n outage uploads at the same moment. Returns (statuses, retry_after_seen, bodies_ok)."""
    start = threading.Barrier(n)
    payload = random.Random(RUN).randbytes(FILE_BYTES)

    def one(_):
        start.wait()
        status, headers, resp, took = upload(auth, "outage", payload)
        return status, headers.get("retry-after"), resp, took

    with ThreadPoolExecutor(max_workers=n) as pool:
        return list(pool.map(one, range(n)))


def put_policy(auth, policy):
    return call("PUT", "/api/v1/policy", {**auth, "Content-Type": "application/json"}, json.dumps(policy))


admin = login("admin")
dispatch = login("dispatch")
connections = login("connections")
device = {"Authorization": "Bearer " + env_value("METER_DEVICE_TOKEN"), "Content-Type": "application/json"}
original = json.loads(call("GET", "/api/v1/policy", admin)[2])
print(f"Policy in force: version {original['version']}, outage {original['categories']['outage']['workers']} workers / queue {original['categories']['outage']['queue']}")

print("1. Meter readings with nothing else going on")
base = [send_meter(device) for _ in range(40)]
base_ms = [t for _, t in base]
check("all accepted", all(s in (200, 201) for s, _ in base))
print(f"  meter latency alone: p50 {pct(base_ms, .5):.0f} ms, p95 {pct(base_ms, .95):.0f} ms")

print(f"2. A burst of {BURST} outage uploads with the default limits (meter readings measured at the same time)")
quiet_meter = []
quiet_stop = threading.Event()


def quiet_meter_loop():
    while not quiet_stop.is_set():
        quiet_meter.append(send_meter(device))


qt = threading.Thread(target=quiet_meter_loop, daemon=True)
qt.start()
res = burst(dispatch, BURST)
quiet_stop.set()
qt.join(timeout=10)
codes = [r[0] for r in res]
print(f"  results: {codes.count(201)} stored, {codes.count(503)} refused, {len([c for c in codes if c not in (201, 503)])} other")
check("with 8 workers and a queue of 500 nothing is refused", codes.count(503) == 0 and codes.count(201) == BURST)
q_ms = [t for _, t in quiet_meter]
print(f"  meter latency during that burst: p50 {pct(q_ms, .5):.0f} ms, p95 {pct(q_ms, .95):.0f} ms, max {max(q_ms or [0]) * 1000:.0f} ms ({len(q_ms)} readings)")

try:
    print("3. PUT /policy: outage gets 2 workers and a queue of 4 (no restart), then the same burst while the others keep working")
    small = copy.deepcopy(original)
    small["categories"]["outage"]["workers"] = 2
    small["categories"]["outage"]["queue"] = 4
    status, _, _ = put_policy(admin, small)
    check("the new limits are applied", status == 200)

    stop = threading.Event()
    meter_results, doc_results, depth = [], [], {"outage": [], "meter": [], "document": []}

    def meter_loop():
        while not stop.is_set():
            meter_results.append(send_meter(device))

    def doc_loop():
        payload = random.Random(RUN + "d").randbytes(60_000)
        while not stop.is_set():
            status, _, _, took = upload(connections, "document", payload)
            doc_results.append((status, took))
            time.sleep(0.2)

    def sampler():
        while not stop.is_set():
            for c in depth:
                depth[c].append(queue_depth(c))

    threads = [threading.Thread(target=f, daemon=True) for f in (meter_loop, doc_loop, sampler)]
    for t in threads:
        t.start()
    time.sleep(1.5)
    waves = []
    for _ in range(4):
        waves.append(burst(dispatch, BURST))
        time.sleep(0.3)
    stop.set()
    for t in threads:
        t.join(timeout=15)

    storm = [r for wave in waves for r in wave]
    codes = [r[0] for r in storm]
    stored, refused = codes.count(201), codes.count(503)
    other = len(codes) - stored - refused
    print(f"  outage during the storm: {stored} stored, {refused} refused (503), {other} other, of {len(codes)}")
    check("outage is refused beyond its limit, only outage", refused > 0 and stored > 0)
    check("nothing else went wrong in outage (only 201 or 503)", other == 0)
    refusals = [r for r in storm if r[0] == 503]
    check("a refusal says 'try again' (Retry-After) and names the category",
          all(r[1] == "2" and b"outage" in r[2] and b"STORAGE_UNAVAILABLE" in r[2] for r in refusals))
    peak = max(depth["outage"]) if depth["outage"] else -1
    check("the outage queue filled but never beyond its limit of 4", 1 <= peak <= 4, f"peak queue depth {peak:.0f} over {len(depth['outage'])} samples")
    check("the meter queue stayed at 0", max(depth["meter"] or [0]) == 0)
    check("the document queue stayed at 0", max(depth["document"] or [0]) == 0)

    m_ms = [t for _, t in meter_results]
    check("meter readings kept being accepted, none lost or refused",
          len(meter_results) > 20 and all(s in (200, 201) for s, _ in meter_results), f"{len(meter_results)} readings")
    print(f"  meter latency during the storm: p50 {pct(m_ms, .5):.0f} ms, p95 {pct(m_ms, .95):.0f} ms, max {max(m_ms or [0]) * 1000:.0f} ms "
          f"(alone: p50 {pct(base_ms, .5):.0f}, p95 {pct(base_ms, .95):.0f})")
    check("meter p95 stays in the same range as when it was alone", pct(m_ms, .95) <= max(pct(base_ms, .95) * 5, pct(base_ms, .95) + 150),
          f"{pct(m_ms, .95):.0f} ms vs {pct(base_ms, .95):.0f} ms")
    d_ms = [t for _, t in doc_results]
    check("document uploads kept working, none refused",
          len(doc_results) >= 3 and all(s == 201 for s, _ in doc_results), f"{len(doc_results)} uploads, p95 {pct(d_ms, .95):.0f} ms")

    ok_files = [json.loads(r[2]) for r in storm if r[0] == 201][:3]
    same = []
    payload = random.Random(RUN).randbytes(FILE_BYTES)
    for f in ok_files:
        st, _, data = call("GET", f"/api/v1/files/{f['id']}/content", dispatch)
        same.append(st == 200 and data == payload)
    check("the files that were stored download identical", bool(same) and all(same))
    time.sleep(1)
    check("when it is over the outage queue is empty again", queue_depth("outage") == 0.0)
finally:
    print("4. Put the limits back")
    original_now = json.loads(call("GET", "/api/v1/policy", admin)[2])
    restore = copy.deepcopy(original)
    status, _, _ = put_policy(admin, restore)
    check("restored", status == 200)

status, _, _, _ = upload(dispatch, "outage", b"x" * 1000)
check("an outage upload works normally again", status == 201)

print()
if failures:
    print(f"RESULT: {len(failures)} check(s) FAILED: {', '.join(failures)}")
    sys.exit(1)
print("RESULT: OK")
