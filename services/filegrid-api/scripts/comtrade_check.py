#!/usr/bin/env python3
"""Proves, on the running stack, that an outage record's COMTRADE configuration is read at upload:

  1. A .cfg uploaded as an outage: `files.metadata` holds the station, recorder, fault time and length of the recording,
     and a view can query it (`metadata ->> 'station'`, `(metadata ->> 'faultTime')::timestamptz`).
  2. The file itself is stored whole: it comes back byte-identical and the receipt hash is of its bytes.
  3. A .dat (the samples), a .cfg that is not a configuration, and a file of another category get no metadata.
  4. A large .cff (5 MiB: the configuration, then data) is read from its start only, and still streams.

The files are generated in memory; the files it makes are deleted at the end (DELETE /files/{id}, as admin). Run from the repo root with the stack up:
`make a-comtrade-check`.
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
    out = (r.status, data)
    c.close()
    return out


def login(user):
    status, body = call("POST", "/api/v1/auth/login", {"Content-Type": "application/json"},
                        json.dumps({"username": user, "password": env_value("DEMO_PASSWORD")}))
    assert status == 200, f"login {user}: {status}"
    return {"Authorization": "Bearer " + json.loads(body)["token"]}


def upload(auth, category, name, content, region="banat"):
    boundary = "----fg" + os.urandom(6).hex()
    form = (f'--{boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\n{category}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="region"\r\n\r\n{region}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
            f'Content-Type: application/octet-stream\r\n\r\n').encode() + content + f"\r\n--{boundary}--\r\n".encode()
    status, body = call("POST", "/api/v1/files", {**auth, "Content-Type": f"multipart/form-data; boundary={boundary}"}, form)
    receipt = json.loads(body)
    if status == 201:
        made.append(receipt["id"])
    return status, receipt


def metadata(fid):
    return json.loads(audit_check.psql(f"select metadata::text from files where id = '{fid}'"))


CFG = "\r\n".join([
    "SUBSTATION PLOIESTI NORD 110kV,DFR-7,1999",
    "5,2A,3D",
    "1,Va,A,,V,0.01,0,0,-32768,32767,110000,110,P",
    "2,Ia,A,,A,0.01,0,0,-32768,32767,1000,1,P",
    "1,TRIP,,,0", "2,CB_OPEN,,,0", "3,PROT,,,0",
    "50", "1", "4000,200",
    "14/11/2026,10:15:30.000000", "14/11/2026,10:15:30.250000",
    "ASCII", "1.0", ""]).encode()

dispatch = login("dispatch")
try:
    print("1. A configuration file uploaded as an outage")
    status, r = upload(dispatch, "outage", "PLO-110-fault.cfg", CFG)
    check("stored (201)", status == 201, str(status))
    m = metadata(r["id"])
    check("station and recorder", m.get("station") == "SUBSTATION PLOIESTI NORD 110kV" and m.get("recorder") == "DFR-7", str(m.get("station")))
    check("fault time is the trigger of the recording", m.get("faultTime") == "2026-11-14T10:15:30.250Z", str(m.get("faultTime")))
    check("length of the recording and its channels", m.get("recordingMs") == 50 and m.get("analogChannels") == 2
          and m.get("digitalChannels") == 3, f"{m.get('recordingMs')} ms")
    view = audit_check.psql(f"select metadata ->> 'station', (metadata ->> 'faultTime')::timestamptz "
                            f"from files where id = '{r['id']}'")
    check("a view can read it", view.startswith("SUBSTATION PLOIESTI NORD 110kV|2026-11-14 10:15:30.25"), view)

    print("2. The file is stored whole")
    status, body = call("GET", f"/api/v1/files/{r['id']}/content", dispatch)
    check("it comes back byte-identical", status == 200 and body == CFG)
    check("the receipt hash is of those bytes", r["sha256"] == hashlib.sha256(CFG).hexdigest())

    print("3. Files that are not a configuration")
    status, dat = upload(dispatch, "outage", "PLO-110-fault.dat", os.urandom(20000))
    check("a .dat gets no metadata", status == 201 and metadata(dat["id"]) == {})
    status, text = upload(dispatch, "outage", "notes.cfg", b"just some notes, not a COMTRADE file\r\nsecond line\r\n")
    check("a .cfg that is not a configuration is stored, with no metadata", status == 201 and metadata(text["id"]) == {})
    status, doc = upload(dispatch, "document", "PLO-110-fault.cfg", CFG)
    check("a document called .cfg gets no metadata", status == 201 and metadata(doc["id"]) == {}, str(status))

    print("4. A 5 MiB .cff: read from its start only")
    cff = b"--- file type: CFG ---\r\n" + CFG + b"--- file type: DAT ASCII: 200 ---\r\n" + os.urandom(5 * 1024 * 1024)
    status, big = upload(dispatch, "outage", "PLO-110-record.cff", cff)
    check("stored (201)", status == 201, str(status))
    check("the metadata is read from the configuration part", metadata(big["id"]).get("faultTime") == "2026-11-14T10:15:30.250Z")
    check("hash and size are of the whole file", big["sha256"] == hashlib.sha256(cff).hexdigest() and big["sizeBytes"] == len(cff))
finally:
    admin = login("admin")
    for fid in made:
        call("DELETE", f"/api/v1/files/{fid}", admin)

print()
print("RESULT: " + ("OK" if not failures else "FAILED: " + "; ".join(failures)))
sys.exit(1 if failures else 0)
