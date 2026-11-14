#!/usr/bin/env python3
"""The acceptance check "retries never duplicate meter readings", on the running stack:

  A. 300 unique readings from 20 meters, each sent THREE times with the same Idempotency-Key and body, all 900 requests at
     once from 32 threads (so the retries of one reading race each other). Expected: 300 x 201 and 600 x 200;
     `filegrid_meter_readings_total` rises by 300 accepted and 600 duplicate; exactly 300 rows in meter_readings and 300 in
     meter_intervals; 300 distinct keys.
  B. (SIM=1, the default) the real meter simulator, started for the check against the real API (not what .env points at):
     for ~20 s at 20 readings/s, then paused and drained. Expected: its sent equals its acked accepted equals the API's accepted
     equals the new rows in meter_readings, and its duplicates equal the API's duplicates.

What it makes is removed at the end. Run from the repo root with the stack up: `make a-meter-once-check`.
"""
import concurrent.futures, http.client, json, os, random, re, ssl, subprocess, sys, time

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


TOKEN = env_value("METER_DEVICE_TOKEN")


def post(key, body):
    for attempt in range(5):
        try:
            c = http.client.HTTPSConnection("localhost", 443, context=ctx, timeout=60)
            c.request("POST", "/api/v1/meter-readings", json.dumps(body),
                      {"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "Idempotency-Key": key})
            r = c.getresponse()
            r.read()
            c.close()
            return r.status
        except OSError:
            time.sleep(0.2)
    return None


def compose(*args, **kw):
    return subprocess.run(["docker", "compose", *args], capture_output=True, text=True, **kw)


def api_counters():
    out = compose("exec", "-T", "filegrid-api", "wget", "-qO-", "http://127.0.0.1:8080/actuator/prometheus").stdout
    found = {"accepted": 0.0, "duplicate": 0.0, "rejected": 0.0}
    for line in out.splitlines():
        m = re.match(r'filegrid_meter_readings_total\{result="(\w+)"\}\s+([0-9.e+]+)', line)
        if m:
            found[m.group(1)] = float(m.group(2))
    return found


def sql(q):
    return audit_check.psql(q)


# ----------------------------------------------------------------------------------------------------- A
PREFIX = f"RO-CHK-{int(time.time()) % 100000:05d}-"
print("A. 300 readings, each sent three times, all at once")
readings = []
for m in range(20):
    meter = f"{PREFIX}{m:02d}"
    for i in range(15):
        ts = f"2026-10-01T{(i * 15) // 60:02d}:{(i * 15) % 60:02d}:00Z"
        readings.append((f"{meter}:{ts}:{i + 1}", {
            "meterId": meter, "region": "banat", "county": "Timis", "lat": 45.75, "lon": 21.23, "periodStart": ts,
            "seq": i + 1, "firmware": "3.2.1",
            "intervals": [{"ts": ts, "kwh": round(0.1 + 0.01 * i, 3), "voltage": 230.0}]}))
requests = [r for r in readings for _ in range(3)]
random.Random(5).shuffle(requests)

before = api_counters()
try:
    with concurrent.futures.ThreadPoolExecutor(max_workers=32) as pool:
        statuses = list(pool.map(lambda r: post(*r), requests))
    check("every request was answered", None not in statuses)
    check("300 x 201 (accepted)", statuses.count(201) == 300, str(statuses.count(201)))
    check("600 x 200 (duplicate)", statuses.count(200) == 600, str(statuses.count(200)))
    after = api_counters()
    check("filegrid_meter_readings_total: +300 accepted", after["accepted"] - before["accepted"] == 300,
          str(after["accepted"] - before["accepted"]))
    check("filegrid_meter_readings_total: +600 duplicate", after["duplicate"] - before["duplicate"] == 600,
          str(after["duplicate"] - before["duplicate"]))
    like = f"meter_id like '{PREFIX}%'"
    check("300 rows in meter_readings", sql(f"select count(*) from meter_readings where {like}") == "300")
    check("300 distinct keys", sql(f"select count(distinct idempotency_key) from meter_readings where {like}") == "300")
    check("300 rows in meter_intervals", sql(f"select count(*) from meter_intervals where {like}") == "300")
finally:
    sql(f"delete from meter_intervals where meter_id like '{PREFIX}%'")
    sql(f"delete from meter_readings where meter_id like '{PREFIX}%'")

# ----------------------------------------------------------------------------------------------------- B
if os.environ.get("SIM", "1") != "0":
    print("B. The real simulator against the real API")
    name = f"sim-check-{int(time.time())}"
    pattern = "^RO-(MT|BN|DB)-[0-9]{6}$"
    started_at = sql("select now()")
    before = api_counters()
    env = {**os.environ, "METER_DEVICE_TOKEN": TOKEN}
    run = subprocess.run(["docker", "run", "-d", "--name", name, "--network", "filegrid_app",
                          "-e", "METER_TARGET_URL=http://caddy:8088/api/v1/meter-readings", "-e", "METER_DEVICE_TOKEN",
                          "-e", "METER_COUNT=40", "-e", "READINGS_PER_SEC=20", "filegrid-meter-simulator"],
                         capture_output=True, text=True, env=env)
    if run.returncode != 0:
        check("the simulator container started", False, run.stderr.strip()[:200])
    else:
        def sim(path, post_body=None):
            cmd = ["docker", "exec", name, "wget", "-qO-"]
            if post_body is not None:
                cmd += ["--header=Content-Type: application/json", f"--post-data={post_body}"]
            return subprocess.run(cmd + [f"http://127.0.0.1:9100{path}"], capture_output=True, text=True).stdout

        try:
            for _ in range(30):
                if '"status":"up"' in sim("/health"):
                    break
                time.sleep(1)
            time.sleep(20)
            sim("/rate", json.dumps({"readingsPerSec": 0}))  # stop making new readings
            for _ in range(60):
                if json.loads(sim("/health") or "{}").get("pending", 1) == 0:
                    break
                time.sleep(1)

            def total(metric, label=""):
                return sum(float(l.rsplit(" ", 1)[1]) for l in sim("/metrics").splitlines()
                           if l.startswith(metric + "{") and label in l)

            sent = total("meter_sim_sent_total")
            acked = total("meter_sim_acked_total", 'result="accepted"')
            dups = total("meter_sim_acked_total", 'result="duplicate"')
            retries = total("meter_sim_retries_total")
            print(f"  simulator: sent {sent:.0f}, acked accepted {acked:.0f}, duplicate {dups:.0f}, retries {retries:.0f}")
            after = api_counters()
            rows = int(sql(f"select count(*) from meter_readings where meter_id ~ '{pattern}' and received_at >= '{started_at}'"))
            check("it sent readings", sent > 100, f"{sent:.0f}")
            check("sent equals acked accepted", sent == acked + 0, f"{sent:.0f} vs {acked:.0f}")
            check("the API's accepted rose by the same", after["accepted"] - before["accepted"] == sent,
                  f"{after['accepted'] - before['accepted']:.0f}")
            check("the new rows in meter_readings are the same", rows == sent, str(rows))
            check("duplicates are counted on both sides", after["duplicate"] - before["duplicate"] == dups,
                  f"API {after['duplicate'] - before['duplicate']:.0f}, simulator {dups:.0f}")
            distinct = sql(f"select count(distinct idempotency_key) from meter_readings where meter_id ~ '{pattern}' "
                           f"and received_at >= '{started_at}'")
            check("every row has its own key", int(distinct) == rows)
            intervals = int(sql(
                f"select count(*) from meter_intervals i where i.meter_id ~ '{pattern}' and exists "
                f"(select 1 from meter_readings r where r.meter_id = i.meter_id and r.received_at >= '{started_at}')"))
            check("one interval per reading, none of them overlapping (the simulator advances the time)",
                  intervals == rows, f"{intervals} intervals for {rows} readings")
        finally:
            subprocess.run(["docker", "rm", "-f", name], capture_output=True)
            sql(f"delete from meter_intervals where meter_id ~ '{pattern}' and ts >= '2000-01-01' and meter_id in "
                f"(select meter_id from meter_readings where meter_id ~ '{pattern}' and received_at >= '{started_at}')")
            sql(f"delete from meter_readings where meter_id ~ '{pattern}' and received_at >= '{started_at}'")

print()
print("RESULT: " + ("OK" if not failures else "FAILED: " + "; ".join(failures)))
sys.exit(1 if failures else 0)
