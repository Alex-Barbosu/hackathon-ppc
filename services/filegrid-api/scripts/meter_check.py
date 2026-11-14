#!/usr/bin/env python3
"""Proves, on the running stack, that a meter reading is analysable and a retry never duplicates it:

  1. POST /meter-readings with an Idempotency-Key: 201 the first time; the same key again: 200, nothing written.
     Exactly one row in meter_readings and one row per interval in meter_intervals, however often it is sent.
  2. region, county, lat and lon are stored from the reading; the intervals keep kwh, voltage and flags.
  3. Another key for the same reading (same meter, period, seq): still nothing added.
  4. A new reading that overlaps an interval already stored does not duplicate or change it.
  5. A reading with a value the table cannot hold (a huge kwh) is still accepted and stored whole.
  6. Every interval in the raw readings already stored (the V104 backfill) is in meter_intervals.
  7. An outage file keeps the region it was uploaded with (POST /files and tus), which the hotspot view groups by.

The rows it makes are removed at the end. Run from the repo root with the stack up: `make a-meter-check`.
"""
import http.client, json, os, ssl, sys, time

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


def post(key, body):
    c = http.client.HTTPSConnection("localhost", 443, context=ctx, timeout=60)
    c.request("POST", "/api/v1/meter-readings", json.dumps(body), {
        "Authorization": "Bearer " + env_value("METER_DEVICE_TOKEN"),
        "Content-Type": "application/json", "Idempotency-Key": key})
    r = c.getresponse()
    r.read()
    c.close()
    return r.status


def sql(q):
    return audit_check.psql(q)


meter = f"RO-MT-CHECK-{int(time.time())}"
period = "2026-11-14T06:00:00Z"


def reading(seq, intervals, period_start=period):
    return {"meterId": meter, "region": "banat", "county": "Timis", "lat": 45.75, "lon": 21.23,
            "periodStart": period_start, "seq": seq, "firmware": "3.2.1", "intervals": intervals}


def ts(minutes):
    return f"2026-11-14T{6 + minutes // 60:02d}:{minutes % 60:02d}:00Z"


try:
    print("1. The same reading, sent three times")
    body = reading(1, [{"ts": ts(0), "kwh": 0.21, "voltage": 229.4},
                       {"ts": ts(15), "kwh": 0.25, "voltage": 231.0, "flags": ["tamper"]},
                       {"ts": ts(30), "kwh": 0.19},
                       {"ts": ts(45), "kwh": 12.3456, "voltage": 238.2, "flags": ["power_loss", "clock_drift"]}])
    key = f"{meter}:{period}:1"
    check("first time: 201", post(key, body) == 201)
    check("same key again: 200", post(key, body) == 200)
    check("and again: 200", post(key, body) == 200)
    check("one row in meter_readings", sql(f"select count(*) from meter_readings where meter_id = '{meter}'") == "1")
    check("one row per interval in meter_intervals", sql(f"select count(*) from meter_intervals where meter_id = '{meter}'") == "4")

    print("2. What is stored")
    row = sql(f"select region, county, lat, lon from meter_readings where meter_id = '{meter}'")
    check("region, county, lat and lon come from the reading", row == "banat|Timis|45.75|21.23", row)
    rows = sql(f"select kwh, coalesce(voltage::text, '-'), flags::text from meter_intervals where meter_id = '{meter}' order by ts").splitlines()
    check("kwh, voltage and flags are kept", rows == ["0.2100|229.40|{}", "0.2500|231.00|{tamper}", "0.1900|-|{}",
                                                     "12.3456|238.20|{power_loss,clock_drift}"], " / ".join(rows))

    print("3. Another key for the same reading")
    check("200, nothing written", post(key + ":again", body) == 200)
    check("still one reading and four intervals", sql(
        f"select (select count(*) from meter_readings where meter_id = '{meter}') || ',' || "
        f"(select count(*) from meter_intervals where meter_id = '{meter}')") == "1,4")

    print("4. A new reading that overlaps an interval")
    overlap = reading(2, [{"ts": ts(15), "kwh": 99.0}, {"ts": ts(60), "kwh": 0.3}])
    check("accepted (201)", post(f"{meter}:{period}:2", overlap) == 201)
    check("five intervals, not six", sql(f"select count(*) from meter_intervals where meter_id = '{meter}'") == "5")
    check("the stored value is not overwritten", sql(
        f"select kwh from meter_intervals where meter_id = '{meter}' and ts = '{ts(15)}'") == "0.2500")

    print("5. A value the table cannot hold")
    huge = reading(3, [{"ts": ts(75), "kwh": 0.4, "voltage": 123456.0}, {"ts": ts(90), "kwh": 5000000.0}])
    check("still accepted (201)", post(f"{meter}:{period}:3", huge) == 201)
    check("the reading is stored whole", sql(
        f"select jsonb_array_length(raw -> 'intervals') from meter_readings where meter_id = '{meter}' and seq = 3") == "2")
    check("the interval that fits is stored, the voltage that does not is null", sql(
        f"select coalesce(voltage::text, '-') from meter_intervals where meter_id = '{meter}' and ts = '{ts(75)}'") == "-")

    print("6. The backfill: every interval in the stored readings is in meter_intervals")
    missing = sql(
        "select count(*) from (select r.meter_id, (i ->> 'ts')::timestamptz as ts from meter_readings r, "
        "jsonb_array_elements(r.raw -> 'intervals') i where jsonb_typeof(i -> 'kwh') = 'number' "
        "and abs((i ->> 'kwh')::numeric) < 999999.99995 and jsonb_typeof(i -> 'ts') = 'string' "
        "and r.received_at < now() - interval '5 seconds' group by 1, 2) s "
        "where not exists (select 1 from meter_intervals m where m.meter_id = s.meter_id and m.ts = s.ts)")
    total = sql("select count(*) from meter_intervals")
    check("none missing", missing == "0", f"{missing} missing, {total} intervals in all")

    print("7. files.region of an outage upload")
    c = http.client.HTTPSConnection("localhost", 443, context=ctx, timeout=60)
    c.request("POST", "/api/v1/auth/login", json.dumps({"username": "field", "password": env_value("DEMO_PASSWORD")}),
              {"Content-Type": "application/json"})
    auth = {"Authorization": "Bearer " + json.loads(c.getresponse().read())["token"]}
    c.close()
    boundary = "----fg" + os.urandom(6).hex()
    form = (f'--{boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\noutage\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="region"\r\n\r\ndobrogea\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="fault.cfg"\r\n'
            f'Content-Type: application/octet-stream\r\n\r\n').encode() + os.urandom(2000) + f"\r\n--{boundary}--\r\n".encode()
    c = http.client.HTTPSConnection("localhost", 443, context=ctx, timeout=60)
    c.request("POST", "/api/v1/files", form, {**auth, "Content-Type": f"multipart/form-data; boundary={boundary}"})
    r = c.getresponse()
    receipt = json.loads(r.read())
    c.close()
    check("POST /files outage with region=dobrogea is stored with it", r.status == 201 and sql(
        f"select region from files where id = '{receipt['id']}'") == "dobrogea")
    import base64
    meta = ",".join(f"{k} {base64.b64encode(v.encode()).decode()}" for k, v in
                    {"category": "outage", "filename": "fault.dat", "region": "banat"}.items())
    tus = {**auth, "Tus-Resumable": "1.0.0"}
    c = http.client.HTTPSConnection("localhost", 443, context=ctx, timeout=60)
    c.request("POST", "/api/v1/files/tus", headers={**tus, "Upload-Length": "1000", "Upload-Metadata": meta})
    r = c.getresponse()
    r.read()
    location = r.getheader("Location")
    c.close()
    check("tus create with a region accepted", r.status == 201, str(r.status))
    c = http.client.HTTPSConnection("localhost", 443, context=ctx, timeout=60)
    c.request("PATCH", location, os.urandom(1000), {**tus, "Content-Type": "application/offset+octet-stream",
                                                     "Upload-Offset": "0"})
    r = c.getresponse()
    r.read()
    tus_id = r.getheader("X-FileGrid-File-Id")
    c.close()
    check("tus outage keeps its region", r.status == 204 and tus_id and sql(
        f"select region from files where id = '{tus_id}'") == "banat", str(r.status))
finally:
    sql(f"delete from meter_intervals where meter_id = '{meter}'")
    sql(f"delete from meter_readings where meter_id = '{meter}'")

print()
print("RESULT: " + ("OK" if not failures else "FAILED: " + "; ".join(failures)))
sys.exit(1 if failures else 0)
