#!/usr/bin/env python3
"""Uploads a realistic week of outage records, so the hotspot view and the analyst have real data to read.

Each record is a COMTRADE .cff (configuration, then ASCII samples, ~1-3 MB like a real disturbance recording),
uploaded by `dispatch` through POST /api/v1/files with the county where the fault happened. FileGrid reads the
station and fault time from the file itself; nothing here writes to the database directly.

The story in the data, for the demo: a storm crossed Dobrogea two days ago (Constanța and Tulcea light up, mostly
two stations), Timiș has a recurring fault on one feeder, București and the rest are quiet. Most recorders are 2013
units with time_code +2 (Romanian winter time), so their fault times are converted to UTC; three older 1999 units
have no time_code and show up as "assumed UTC".

Idempotent: a record whose file name is already stored is skipped. Run from the repo root with the stack up:
`make a-seed-outages` (WRITE=dir also writes the .cfg files there, for uploading by hand in the UI).
"""
import datetime as dt
import http.client
import json
import math
import os
import random
import ssl
import sys
import urllib.parse

ctx = ssl.create_default_context()
ctx.check_hostname = False  # the gateway's local CA; same as the other zone A scripts
ctx.verify_mode = ssl.CERT_NONE


def env_value(key):
    for line in open(".env"):
        if line.startswith(key + "="):
            return line.strip().split("=", 1)[1]
    raise SystemExit(f"{key} missing from .env")


def call(method, path, headers=None, body=None):
    c = http.client.HTTPSConnection("localhost", 443, context=ctx, timeout=120)
    c.request(method, path, body=body, headers=headers or {})
    r = c.getresponse()
    out = (r.status, r.read())
    c.close()
    return out


def login(user):
    status, body = call("POST", "/api/v1/auth/login", {"Content-Type": "application/json"},
                        json.dumps({"username": user, "password": env_value("DEMO_PASSWORD")}))
    if status != 200:
        raise SystemExit(f"login {user}: {status}")
    return {"Authorization": "Bearer " + json.loads(body)["token"]}

# (station, recorder, county, revision, faults: list of hours before "now")
STATIONS = [
    ("Statia 110/20kV Constanta Nord", "DFR-CT-02", "Constanța", "2013", [49, 48.5, 47.9, 47.2, 46, 30]),
    ("Statia 110/20kV Mangalia", "DFR-CT-07", "Constanța", "2013", [48.2, 47.6, 47.1]),
    ("Statia 110/20kV Tulcea Vest", "DFR-TL-01", "Tulcea", "1999", [47.8, 47.0, 45.5, 44.9]),
    ("Statia 110/20kV Babadag", "DFR-TL-04", "Tulcea", "2013", [46.3]),
    ("Statia 110/20kV Timisoara Sud", "DFR-TM-03", "Timiș", "2013", [150, 122, 98, 74, 26]),
    ("Statia 110/20kV Lugoj", "DFR-TM-09", "Timiș", "2013", [60]),
    ("Statia 110/20kV Arad Est", "DFR-AR-02", "Arad", "1999", [88, 12]),
    ("Statia 110/10kV Grozavesti", "DFR-B-11", "București", "2013", [70]),
    ("Statia 110/20kV Otopeni", "DFR-IF-05", "Ilfov", "2013", [20]),
    ("Statia 110/20kV Slobozia", "DFR-IL-01", "Ialomița", "1999", [47.4]),
    ("Statia 110/20kV Deva", "DFR-HD-02", "Hunedoara", "2013", [110]),
]


def cfg_text(station, recorder, revision, start, fault_ms, samples, rate=4000):
    """A COMTRADE configuration: 3 voltages, 3 currents, 4 breaker/protection signals."""
    # 2013 recorders run on Romanian winter time (UTC+2) and say so with time_code +2, which FileGrid subtracts.
    # 1999 recorders have no time_code; these are GPS-synced to UTC, so FileGrid's "assumed UTC" is right for them.
    t0 = start if revision == "1999" else start + dt.timedelta(hours=2)
    trig = t0 + dt.timedelta(milliseconds=fault_ms)
    fmt = lambda t: t.strftime("%d/%m/%Y,%H:%M:%S.%f")  # noqa: E731
    lines = [f"{station},{recorder},{revision}", "10,6A,4D"]
    for i, (name, ph, unit, mult) in enumerate([("UL1", "A", "kV", 0.01), ("UL2", "B", "kV", 0.01), ("UL3", "C", "kV", 0.01),
                                                 ("IL1", "A", "A", 0.1), ("IL2", "B", "A", 0.1), ("IL3", "C", "A", 0.1)], 1):
        lines.append(f"{i},{name},{ph},,{unit},{mult},0,0,-32768,32767,{'110000,100' if unit == 'kV' else '600,1'},P")
    for i, name in enumerate(["TRIP_L1", "TRIP_L2", "TRIP_L3", "CB_OPEN"], 1):
        lines.append(f"{i},{name},,,0")
    lines += ["50", "1", f"{rate},{samples}", fmt(t0), fmt(trig), "ASCII", "1.0"]
    if revision == "2013":
        lines += ["+2,+2", "0,0"]
    return "\r\n".join(lines) + "\r\n"


def dat_text(samples, fault_sample, rng, rate=4000):
    """Sampled 50 Hz waveforms with a phase-to-ground fault on L1 after the trigger: current up, voltage sagging."""
    rows = []
    for n in range(1, samples + 1):
        t = (n - 1) / rate
        faulted = n >= fault_sample
        v = [int(9000 * (0.35 if faulted and k == 0 else 1) * math.sin(2 * math.pi * 50 * t - k * 2.094) + rng.randint(-40, 40))
             for k in range(3)]
        i = [int(1200 * (6 if faulted and k == 0 else 1) * math.sin(2 * math.pi * 50 * t - k * 2.094 - 0.5) + rng.randint(-15, 15))
             for k in range(3)]
        trip = 1 if faulted and n >= fault_sample + rate // 20 else 0
        rows.append(f"{n},{int(t * 1e6)}," + ",".join(map(str, v + i)) + f",{trip},0,0,{trip}")
    return "\r\n".join(rows) + "\r\n"


def records(now):
    rng = random.Random(20261114)  # the same week of data on every machine
    for station, recorder, county, revision, faults in STATIONS:
        for hours in faults:
            start = (now - dt.timedelta(hours=hours)).replace(microsecond=0)
            samples = rng.choice([24000, 32000, 40000, 48000])  # 6-12 s at 4 kHz: about 1.2-2.5 MB of ASCII
            fault_ms = rng.choice([100, 150, 200])
            cfg = cfg_text(station, recorder, revision, start, fault_ms, samples)
            name = f"{recorder}_{start.strftime('%Y%m%dT%H%M')}.cff"
            yield name, county, cfg, samples, fault_ms, rng


def upload(auth, name, county, content):
    boundary = "----fg" + os.urandom(6).hex()
    form = (f'--{boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\noutage\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="county"\r\n\r\n{county}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\nDisturbance recording\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
            f'Content-Type: application/octet-stream\r\n\r\n').encode() + content + f"\r\n--{boundary}--\r\n".encode()
    status, body = call("POST", "/api/v1/files", {**auth, "Content-Type": f"multipart/form-data; boundary={boundary}"}, form)
    return status, body


def main():
    write_dir = os.environ.get("WRITE")
    # Rounded to the hour so a re-run within the hour makes the same names and is skipped.
    now = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0, tzinfo=None)
    auth = login("dispatch")
    made = skipped = failed = 0
    for name, county, cfg, samples, fault_ms, rng in records(now):
        if write_dir:
            os.makedirs(write_dir, exist_ok=True)
            with open(os.path.join(write_dir, name.replace(".cff", ".cfg")), "w", newline="") as f:
                f.write(cfg)
        status, body = call("GET", f"/api/v1/files?category=outage&q={urllib.parse.quote(name)}&size=1", auth)
        if status == 200 and json.loads(body)["total"] > 0:
            skipped += 1
            continue
        content = (b"--- file type: CFG ---\r\n" + cfg.encode() + f"--- file type: DAT ASCII: {samples} ---\r\n".encode()
                   + dat_text(samples, fault_ms * 4 + 1, rng).encode())
        status, body = upload(auth, name, county, content)
        if status == 201:
            made += 1
            print(f"  stored {name} ({county}, {len(content) // 1024} KB)")
        else:
            failed += 1
            print(f"  FAILED {name}: {status} {body[:200]!r}")
    print(f"\n{made} stored, {skipped} already there, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
