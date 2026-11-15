#!/usr/bin/env python3
"""Fills the stack with a believable amount of data, through the real API, so the demo looks like a utility in production.

  * METERS smart meters (default 440: at least 40 in each of the eleven counties of the three regions, the rest weighted like the
    real customer base), each sending a reading file every PER_FILE quarter hours (default 4: hourly files) for the last DAYS days
    (default 14): kWh, voltage and flags per quarter hour, from the meter's own coordinates. That is about 148 000 reading files
    and 590 000 intervals by default. Posted with the device token and an Idempotency-Key, so the exactly-once path stores them.
    Why not more meters: Zone C's anomaly view reads every interval of the last 14 days on each request, about 25 microseconds
    each on a laptop (590 000 intervals: 19 s; 2.7 million: 62 s). More readings come from more files, not more intervals.
  * DOCS documents (default 1500): contracts, connection notices, bills, complaints... with Romanian customer names (invented),
    encrypted on the FTP server and audited, like the policy says.
  * the week of COMTRADE outage records from `seed_outages.py` (a storm in Dobrogea, a recurring fault in Timis).

The story in the meter data, for the analyst and the map:
  * a normal Romanian load curve (evening peak 18-21, morning peak 07-09, businesses in working hours, weekends shifted);
  * one cold-snap day (+35 %), so "peak day against a normal day" has a real peak;
  * about 4 % of meters misbehave like the simulator's planted faults (a spike, a one-interval drop, a stuck value, a voltage sag)
    and 12 meters have a sustained theft-like drop (-65 %) from the second half of the period. The ids of those 12 are printed,
    and saved in ~/.cache/filegrid/seed-truth.json, so the detector can be checked against them. They are not in the database.

Meter ids are RO-MT/BN/DB-1xxxxx, apart from the simulator's (RO-xx-000001...), so both can run side by side. The data is
the same on every run (seeded random numbers), so a second run stores nothing twice: the API answers 200 duplicate.
The server stamps `received_at` and `created_at` with the time of upload; so that days look like days, they are moved afterwards
to the time each reading or document would really have arrived (pass --no-backdate to keep the upload time).

Run from the repo root with the stack up: `make a-seed-demo` (METERS=440 DAYS=14 PER_FILE=4 DOCS=1500; `make a-seed-clean` removes it again).
"""
import argparse, concurrent.futures, datetime as dt, hashlib, http.client, json, math, os, random, ssl, subprocess, sys, threading, time
from zoneinfo import ZoneInfo

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
BUCHAREST = ZoneInfo("Europe/Bucharest")
CACHE = os.path.expanduser("~/.cache/filegrid")
TRUTH = os.path.join(CACHE, "seed-truth.json")
MANIFEST = os.path.join(CACHE, "seed-documents.json")

# name, region, centre lat, lon, spread (deg), weight: the same service areas and weights as the meter simulator
COUNTIES = [
    ("București", "muntenia", 44.4268, 26.1025, 0.07, 0.33), ("Ilfov", "muntenia", 44.535, 26.18, 0.18, 0.08),
    ("Giurgiu", "muntenia", 44.08, 25.88, 0.25, 0.04), ("Timiș", "banat", 45.75, 21.3, 0.35, 0.12),
    ("Arad", "banat", 46.25, 21.65, 0.35, 0.08), ("Hunedoara", "banat", 45.8, 22.9, 0.3, 0.07),
    ("Caraș-Severin", "banat", 45.2, 22.0, 0.35, 0.05), ("Constanța", "dobrogea", 44.18, 28.4, 0.3, 0.12),
    ("Tulcea", "dobrogea", 45.05, 28.85, 0.35, 0.03), ("Călărași", "dobrogea", 44.3, 27.0, 0.3, 0.04),
    ("Ialomița", "dobrogea", 44.6, 27.4, 0.3, 0.04),
]
CODE = {"muntenia": "MT", "banat": "BN", "dobrogea": "DB"}
MIN_PER_COUNTY = 40
METER_ID_SQL = "^RO-(MT|BN|DB)-1[0-9]{5}$"


def env_value(key):
    for line in open(".env"):
        if line.startswith(key + "="):
            return line.strip().split("=", 1)[1]
    raise SystemExit(f"{key} missing from .env")


def psql(sql, stdin=None):
    cmd = ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "filegrid", "-d", "filegrid", "-tA", "-v", "ON_ERROR_STOP=1"]
    cmd += ["-f", "-"] if stdin is not None else ["-c", sql]
    out = subprocess.run(cmd, capture_output=True, text=True, input=stdin, timeout=900)
    if out.returncode != 0:
        raise SystemExit("psql failed: " + out.stderr.strip()[-300:])
    return out.stdout.strip()


# ------------------------------------------------------------------------------------------------ HTTP
_local = threading.local()


def request(method, path, headers, body=None):
    """One keep-alive connection per thread; a broken one is replaced and the request tried again (the keys make that safe)."""
    for attempt in range(8):
        try:
            c = getattr(_local, "c", None)
            if c is None:
                c = _local.c = http.client.HTTPSConnection("localhost", 443, context=ctx, timeout=120)
            c.request(method, path, body=body, headers=headers)
            r = c.getresponse()
            data = r.read()
            if r.status in (502, 503, 429):  # a full queue or a restarting replica: wait and try again
                time.sleep(min(2.0, 0.2 * (attempt + 1)))
                continue
            return r.status, data
        except (OSError, http.client.HTTPException):
            _local.c = None
            time.sleep(0.3 * (attempt + 1))
    return None, b""


def login(user):
    status, body = request("POST", "/api/v1/auth/login", {"Content-Type": "application/json"},
                           json.dumps({"username": user, "password": env_value("DEMO_PASSWORD")}))
    if status != 200:
        raise SystemExit(f"login {user}: {status}")
    return {"Authorization": "Bearer " + json.loads(body)["token"]}


def gauss(r):
    return r.gauss(0, 1)


# ------------------------------------------------------------------------------------------------ meters
def curve(kind, weekend):
    """Relative load for each of the 96 local quarter hours, averaging 1."""
    values = []
    for q in range(96):
        h = q / 4
        if kind == "household":
            v = 0.4 + 0.5 * math.exp(-((h - (9.5 if weekend else 8)) ** 2) / 2.2) + 1.5 * math.exp(-((h - 19.5) ** 2) / 4.5)
            v += 0.35 * math.exp(-((h - 13) ** 2) / 8)
        else:
            work = (not weekend) and 7.5 <= h <= 17.5
            v = 1.9 if work else (0.55 if not weekend else 0.4)
            v += 0.15 * math.sin(h / 24 * 2 * math.pi)
        values.append(max(0.2, v))
    mean = sum(values) / 96
    return [v / mean for v in values]


CURVES = {(k, w): curve(k, w) for k in ("household", "business") for w in (False, True)}
FAULT_KINDS = ["spike", "consumption_drop", "stuck_meter", "voltage_sag"]
FAULT_CYCLE = 16


def population(total):
    weights = [c[5] for c in COUNTIES]
    counts = [max(MIN_PER_COUNTY, round(total * w / sum(weights))) for w in weights]
    meters, per_region = [], {"muntenia": 0, "banat": 0, "dobrogea": 0}
    for (name, region, lat, lon, spread, _), n in zip(COUNTIES, counts):
        for _ in range(n):
            per_region[region] += 1
            number = 100000 + per_region[region]
            r = random.Random(f"seed-meter:{region}:{number}")
            kind = "household" if r.random() < 0.88 else "business"
            if kind == "household":
                daily = min(25, max(1.5, 6.5 * math.exp(0.35 * gauss(r))))
            else:
                daily = min(400, max(10, 60 * math.exp(0.5 * gauss(r))))
            m = {"id": f"RO-{CODE[region]}-{number}", "region": region, "county": name, "kind": kind, "daily": daily,
                 "lat": round(lat + spread * 0.5 * gauss(r), 4), "lon": round(lon + spread * 0.5 * gauss(r), 4),
                 "offset": min(6, max(-6, 2 * gauss(r))), "firmware": r.choice(["3.2.1", "3.2.4", "3.3.0"]),
                 "fault": None, "theft_from": None}
            if r.random() < 0.04:
                m["fault"] = (r.choice(FAULT_KINDS), r.randrange(FAULT_CYCLE))
            meters.append(m)
    # A dozen sustained theft-like drops, spread over the counties, from the second half of the period on.
    pick = random.Random("seed-theft")
    for m in pick.sample([m for m in meters if m["kind"] == "household" and not m["fault"]], 12):
        m["theft_from"] = 0.5 + 0.3 * pick.random()
    return meters


def day_files(m, day, days_back, peak_days, per_file):
    """One day of one meter as reading files of `per_file` quarter hours each (4 = hourly): the same bytes every time."""
    r = random.Random(f"{m['id']}:{day.isoformat()}")
    weekend = day.weekday() >= 5
    base = CURVES[(m["kind"], weekend)]
    factor = max(0.8, 1 + 0.06 * gauss(r)) * (1.08 if weekend and m["kind"] == "household" else 1)
    peak = day in peak_days
    if peak:
        factor *= 1.35
    if m["theft_from"] is not None and days_back[day] <= (1 - m["theft_from"]) * max(days_back.values()):
        factor *= 0.35
    start = dt.datetime.combine(day, dt.time(0), tzinfo=dt.timezone.utc)
    steady = m["daily"] / 96
    intervals = []
    for q in range(96):
        # the curves are in local time: shift from UTC (Romania is UTC+2 in winter, +3 in summer)
        local = (start + dt.timedelta(minutes=15 * q)).astimezone(BUCHAREST)
        slot = local.hour * 4 + local.minute // 15
        rel = base[slot] * (1.15 if peak and 17 <= local.hour <= 22 else 1)
        noise = 1 + (0.25 if m["kind"] == "household" else 0.10) * gauss(r)
        kwh = max(0.0, steady * rel * factor * max(0.2, noise))
        volt = 230 + m["offset"] - 0.9 * rel + 1.2 * gauss(r)
        volt = min(253, max(207, volt))
        flags = []
        roll = r.random()
        if roll < 0.0005:
            flags.append("power_loss")
            kwh *= 0.1
            volt = None
        elif roll < 0.0008:
            flags.append("clock_drift")
        if m["fault"]:
            kind, phase = m["fault"]
            step = (int((start.timestamp() + 900 * q) // 900) + phase) % FAULT_CYCLE
            if kind == "spike" and step == FAULT_CYCLE - 1:
                kwh *= 12
            elif kind == "consumption_drop" and step == FAULT_CYCLE - 1:
                kwh *= 0.03
            elif kind == "stuck_meter" and step >= FAULT_CYCLE - 8:
                kwh = steady
            elif kind == "voltage_sag" and step >= FAULT_CYCLE - 4 and volt is not None:
                volt = 194 + step - (FAULT_CYCLE - 4)
        item = {"ts": (start + dt.timedelta(minutes=15 * q)).strftime("%Y-%m-%dT%H:%M:%SZ"), "kwh": round(kwh, 4)}
        if volt is not None:
            item["voltage"] = round(volt, 1)
        if flags:
            item["flags"] = flags
        intervals.append(item)
    files = []
    for q0 in range(0, 96, per_file):
        period = intervals[q0]["ts"]
        seq = (day - dt.date(2020, 1, 1)).days * 96 + q0  # stable, and unique for the meter and period
        body = {"meterId": m["id"], "region": m["region"], "county": m["county"], "lat": m["lat"], "lon": m["lon"],
                "periodStart": period, "seq": seq, "firmware": m["firmware"], "intervals": intervals[q0:q0 + per_file]}
        files.append((f"{m['id']}:{period}:{seq}", body))
    return files


def send_meter(token, key, body):
    status, _ = request("POST", "/api/v1/meter-readings",
                        {"Authorization": "Bearer " + token, "Content-Type": "application/json", "Idempotency-Key": key},
                        json.dumps(body, separators=(",", ":")))
    return status


def seed_meters(args):
    token = env_value("METER_DEVICE_TOKEN")
    meters = population(args.meters)
    today = dt.datetime.now(dt.timezone.utc).date()
    days = [today - dt.timedelta(days=d) for d in range(args.days, 0, -1)]  # whole days up to yesterday
    days_back = {d: (today - d).days for d in days}
    peak_days = {days[-4]} if len(days) >= 6 else set()  # a cold snap four days ago
    per_file = args.per_file
    total = len(meters) * len(days) * (96 // per_file)
    print(f"Meters: {len(meters)} in {len(COUNTIES)} counties, {len(days)} days each, a file every {per_file * 15} minutes "
          f"= {total:,} readings ({len(meters) * len(days) * 96:,} intervals). Cold-snap day: {', '.join(map(str, peak_days)) or 'none'}")
    for name, region, *_ in COUNTIES:
        print(f"   {name:14s} {region:9s} {sum(1 for m in meters if m['county'] == name):5d} meters")
    jobs = [(m, d) for d in days for m in meters]
    random.Random(1).shuffle(jobs)
    counts = {201: 0, 200: 0, "other": 0}
    started = time.time()
    done = 0
    lock = threading.Lock()

    def work(job):
        m, d = job
        return [send_meter(token, key, body) for key, body in day_files(m, d, days_back, peak_days, per_file)]

    step = max(1000, total // 20)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.threads) as pool:
        for statuses in pool.map(work, jobs):
            with lock:
                before = done
                for status in statuses:
                    done += 1
                    counts[status if status in (200, 201) else "other"] += 1
                if done // step != before // step or done == total:
                    rate = done / (time.time() - started)
                    print(f"   {done:,}/{total:,} readings ({rate:.0f}/s): {counts[201]:,} stored, {counts[200]:,} already there, "
                          f"{counts['other']} failed", flush=True)
    truth = {"cold_snap_days": [d.isoformat() for d in peak_days],
             "theft_like_drops": [{"meterId": m["id"], "county": m["county"], "fromDay": round(m["theft_from"], 2)} for m in meters if m["theft_from"]],
             "faulty_meters": [{"meterId": m["id"], "county": m["county"], "kind": m["fault"][0]} for m in meters if m["fault"]]}
    os.makedirs(CACHE, exist_ok=True)
    json.dump(truth, open(TRUTH, "w"), indent=1)
    print(f"   planted: {len(truth['faulty_meters'])} faulty meters, {len(truth['theft_like_drops'])} theft-like drops "
          f"(ids in {TRUTH})")
    if not args.no_backdate:
        # Each reading file arrived just after the period it covers, as a real meter would send it.
        psql(f"UPDATE meter_readings SET received_at = period_start + interval '{per_file * 15} minutes' + (random() * interval '3 minutes') "
             f"WHERE meter_id ~ '{METER_ID_SQL}' AND received_at > now() - interval '1 day' AND period_start < date_trunc('day', now())")
    return counts["other"]


# ------------------------------------------------------------------------------------------------ documents
FIRST = ["Ion", "Maria", "Andrei", "Elena", "Mihai", "Ioana", "Gheorghe", "Ana", "Vasile", "Cristina", "Alexandru", "Daniela",
         "Florin", "Mihaela", "Radu", "Simona", "Dan", "Roxana", "Marius", "Camelia", "Sorin", "Carmen", "Cătălin", "Laura"]
LAST = ["Popescu", "Ionescu", "Popa", "Stan", "Dumitru", "Stoica", "Gheorghe", "Matei", "Constantin", "Marin", "Georgescu", "Diaconu",
        "Tudor", "Dinu", "Munteanu", "Radu", "Lazăr", "Toma", "Neagu", "Barbu", "Moldovan", "Cojocaru", "Pavel", "Ciobanu"]
KINDS = [("Contract de racordare", 3), ("Aviz tehnic de racordare", 2), ("Cerere schimbare titular", 2), ("Factură energie electrică", 4),
         ("Notificare debranșare", 1), ("Proces-verbal recepție contor", 2), ("Convenție de consum", 1), ("Cerere reziliere contract", 1),
         ("Adeverință loc de consum", 1), ("Reclamație calitate energie", 1), ("Cerere montare contor smart", 2), ("Plan de situație", 1)]


def document(i):
    r = random.Random(f"seed-doc:{i}")
    county = r.choices(COUNTIES, weights=[c[5] for c in COUNTIES])[0]
    kind = r.choices([k for k, _ in KINDS], weights=[w for _, w in KINDS])[0]
    person = f"{r.choice(LAST)} {r.choice(FIRST)}"
    name = f"{kind} - {person} - {county[0]} - {r.randint(2025, 2026)}-{r.randint(1000, 9999)}.pdf"
    size = int(min(1_500_000, max(20_000, 90_000 * math.exp(0.9 * gauss(r)))))
    head = (f"%PDF-1.4\n% {kind}\n1 0 obj<</Type/Catalog>>endobj\n"
            f"BT /F1 12 Tf 72 720 Td ({kind}) Tj 0 -18 Td (Client: {person}, jud. {county[0]}) Tj ET\n"
            f"stream\n").encode("utf-8")
    body = head + random.Random(f"seed-doc-bytes:{i}").randbytes(max(0, size - len(head))) + b"\nendstream\n%%EOF\n"
    return name, county, kind, person, body


def upload_document(job):
    i, auth = job
    name, county, kind, person, body = document(i)
    boundary = "----fg" + hashlib.md5(name.encode()).hexdigest()[:12]
    parts = [("category", "document"), ("region", county[1]), ("county", county[0]), ("description", f"{kind}, {person}")]
    form = b"".join(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in parts)
    form += (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
             f'Content-Type: application/pdf\r\n\r\n').encode() + body + f"\r\n--{boundary}--\r\n".encode()
    status, data = request("POST", "/api/v1/files", {**auth, "Content-Type": f"multipart/form-data; boundary={boundary}"}, form)
    return (json.loads(data)["id"] if status == 201 else None), status


def seed_documents(args):
    print(f"\nDocuments: {args.docs} (encrypted on the FTP server, audited)")
    existing = json.load(open(MANIFEST)) if os.path.exists(MANIFEST) else []
    have = len(existing)
    auths = [login("connections"), login("dispatch")]
    jobs = [(i, auths[i % 2]) for i in range(have, args.docs)]
    ids, failed, started = list(existing), 0, time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(args.threads, 12)) as pool:
        for n, (fid, status) in enumerate(pool.map(upload_document, jobs), 1):
            if fid:
                ids.append(fid)
            else:
                failed += 1
            if n % 250 == 0 or n == len(jobs):
                print(f"   {n}/{len(jobs)} documents ({n / (time.time() - started):.0f}/s), {failed} failed", flush=True)
    os.makedirs(CACHE, exist_ok=True)
    json.dump(ids, open(MANIFEST, "w"))
    if not args.no_backdate and len(ids) > have:
        # Spread over the last 120 days, on working days and in office hours, like a real archive.
        r = random.Random("seed-doc-dates")
        now = dt.datetime.now(dt.timezone.utc)
        rows = []
        for fid in ids[have:]:
            while True:
                t = now - dt.timedelta(days=r.random() * 120, minutes=r.random() * 600)
                local = t.astimezone(BUCHAREST)
                if (local.weekday() < 5 and 8 <= local.hour <= 17) or r.random() < 0.03:
                    break
            rows.append(f"('{fid}'::uuid,'{t.strftime('%Y-%m-%d %H:%M:%S')}+00'::timestamptz)")
        for i in range(0, len(rows), 400):
            psql(None, stdin="UPDATE files SET created_at = v.t FROM (VALUES " + ",".join(rows[i:i + 400])
                 + ") AS v(id, t) WHERE files.id = v.id;\n")
    return failed


# ------------------------------------------------------------------------------------------------ clean
def clean():
    print("Removing the seeded meter data ...")
    psql(f"DELETE FROM meter_intervals WHERE meter_id ~ '{METER_ID_SQL}'")
    print("   meter readings removed:", psql(
        f"WITH d AS (DELETE FROM meter_readings WHERE meter_id ~ '{METER_ID_SQL}' RETURNING 1) SELECT count(*) FROM d"))
    psql("VACUUM (ANALYZE) meter_intervals")
    psql("VACUUM (ANALYZE) meter_readings")
    if os.path.exists(MANIFEST):
        admin = login("admin")
        ids = json.load(open(MANIFEST))
        print(f"Removing {len(ids)} seeded documents ...")
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda fid: request("DELETE", f"/api/v1/files/{fid}", admin), ids))
        os.remove(MANIFEST)
    if os.path.exists(TRUTH):
        os.remove(TRUTH)
    print("Done. The outage records stay (make a-seed-outages made them); delete them in the Library if you want them gone.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--meters", type=int, default=int(os.environ.get("METERS", 440)))
    ap.add_argument("--days", type=int, default=int(os.environ.get("DAYS", 14)))
    ap.add_argument("--docs", type=int, default=int(os.environ.get("DOCS", 1500)))
    ap.add_argument("--per-file", type=int, default=int(os.environ.get("PER_FILE", 4)), help="quarter hours in each reading file (4 = hourly)")
    ap.add_argument("--threads", type=int, default=int(os.environ.get("THREADS", 24)))
    ap.add_argument("--no-backdate", action="store_true")
    ap.add_argument("--no-outages", action="store_true")
    ap.add_argument("--clean", action="store_true")
    args = ap.parse_args()
    sys.stdout.reconfigure(line_buffering=True)
    if args.per_file < 1 or 96 % args.per_file:
        raise SystemExit("--per-file must divide 96 (1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48 or 96)")
    if args.clean:
        return clean()
    problems = 0
    if args.meters > 0 and args.days > 0:
        problems += seed_meters(args)
    if args.docs > 0:
        problems += seed_documents(args)
    if not args.no_outages:
        print("\nOutage records (a week of COMTRADE recordings across the counties):")
        out = subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "seed_outages.py")])
        problems += out.returncode
    print("\n" + ("Done." if not problems else f"Done, with {problems} failures: run it again, it only stores what is missing."))
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
