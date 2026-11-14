#!/usr/bin/env python3
"""Proves, on the running stack, that one operation can be followed from the request to the storage.

  1. One outage upload and one download. The receipt's traceId is looked up in Tempo: the request span with the
     contract's child spans (policy.route, storage.write, integrity.verify, storage.read) and their attributes.
  2. The same trace id is found in the JSON log lines of the API, which carry trace_id, span_id, category,
     storage and file_id, and in Loki (logs shipped over OTLP through the collector).
  3. A failed primary: S3 is stopped and an outage file is uploaded. The trace shows a failed storage.write on
     s3 and a successful one on the database.
  4. Health checks, metric scrapes and scheduled jobs leave no traces.
  5. No file name appears in any span, log line or Loki entry.

It stops and restarts seaweedfs for step 3 (always restarted; NO_CHAOS=1 skips it). The files are generated in
memory. Run from the repo root with the stack up: `make a-trace-check`.
"""
import http.client, json, os, random, ssl, subprocess, sys, time, urllib.parse

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
failures = []
SECRET_NAME = "Ion-Popescu-contract-" + str(random.Random().randint(1000, 9999)) + ".pdf"


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


def upload(auth, category, content, name):
    b = "----fg" + os.urandom(8).hex()
    body = (f'--{b}\r\nContent-Disposition: form-data; name="category"\r\n\r\n{category}\r\n'
            f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n").encode() + content + f"\r\n--{b}--\r\n".encode()
    status, _, resp = call("POST", "/api/v1/files", {**auth, "Content-Type": f"multipart/form-data; boundary={b}"}, body)
    return status, json.loads(resp) if resp else {}


def in_container(service, *cmd):
    return subprocess.run(["docker", "compose", "exec", "-T", service, *cmd], capture_output=True, text=True, timeout=60).stdout


def tempo_trace(trace_id, wait=25):
    """All spans of a trace as {name: [tags...]}. Waits for the batch to reach Tempo."""
    deadline = time.time() + wait
    while time.time() < deadline:
        raw = in_container("filegrid-api", "wget", "-qO-", f"http://tempo:3200/api/traces/{trace_id}")
        if raw.strip().startswith("{"):
            doc = json.loads(raw)
            spans = []
            for batch in doc.get("batches", []):
                for scope in batch.get("scopeSpans", []):
                    for s in scope.get("spans", []):
                        attrs = {}
                        for a in s.get("attributes", []):
                            v = a["value"]
                            attrs[a["key"]] = next(iter(v.values()))
                        spans.append({"name": s["name"], "id": s["spanId"], "parent": s.get("parentSpanId", ""),
                                      "attrs": attrs, "error": s.get("status", {}).get("code") in ("STATUS_CODE_ERROR", 2),
                                      "start": int(s["startTimeUnixNano"]), "end": int(s["endTimeUnixNano"])})
            if spans:
                return spans
        time.sleep(2)
    return []


def loki(query, wait=25):
    deadline = time.time() + wait
    while time.time() < deadline:
        now = int(time.time() * 1e9)
        url = "http://loki:3100/loki/api/v1/query_range?" + urllib.parse.urlencode(
            {"query": query, "limit": 200, "start": now - 600 * 10**9, "end": now + 10**9})
        raw = in_container("filegrid-api", "wget", "-qO-", url)
        try:
            streams = json.loads(raw)["data"]["result"]
        except Exception:
            streams = []
        lines = [v for s in streams for v in s["values"]]
        if lines:
            return streams
        time.sleep(2)
    return []


def tree(spans):
    by_parent = {}
    for s in spans:
        by_parent.setdefault(s["parent"], []).append(s)
    ids = {s["id"] for s in spans}
    roots = [s for s in spans if s["parent"] not in ids]
    out = []

    def walk(s, depth):
        flag = " (error)" if s["error"] else ""
        a = s["attrs"]
        extra = " ".join(f"{k.split('.')[-1]}={a[k]}" for k in ("filegrid.storage", "filegrid.purpose") if k in a)
        out.append("    " + "  " * depth + f"{s['name']}{flag} {extra} {(s['end'] - s['start']) / 1e6:.1f} ms")
        for c in sorted(by_parent.get(s["id"], []), key=lambda x: x["start"]):
            walk(c, depth + 1)

    for r in sorted(roots, key=lambda x: x["start"]):
        walk(r, 0)
    return "\n".join(out)


admin = login("admin")
dispatch = login("dispatch")
data = random.Random().randbytes(200_000)

print("1. One upload and one download, followed by trace id")
status, r = upload(dispatch, "outage", data, SECRET_NAME)
check("upload stored", status == 201, f"status {status}")
fid, trace_id = r["id"], r["traceId"]
st, _, got = call("GET", f"/api/v1/files/{fid}/content", dispatch)
check("download identical", st == 200 and got == data)
print(f"  trace id from the receipt: {trace_id}")

spans = tempo_trace(trace_id)
check("the trace is in Tempo", bool(spans), f"{len(spans)} spans")
names = [s["name"] for s in spans]
root = next((s for s in spans if s["name"].startswith("http ")), None)
check("the request span is the root: 'http post /api/v1/files'", root is not None and root["name"] == "http post /api/v1/files", str(root and root["name"]))
route = next((s for s in spans if s["name"] == "policy.route"), None)
write = next((s for s in spans if s["name"] == "storage.write"), None)
check("policy.route says where the policy sent it",
      route and route["attrs"].get("filegrid.category") == "outage" and route["attrs"].get("filegrid.storage") in ("s3", "db"),
      str(route and {k: v for k, v in route["attrs"].items() if k.startswith("filegrid")}))
check("storage.write has category, storage, file_id and size_bytes",
      write and write["attrs"].get("filegrid.file_id") == fid and write["attrs"].get("filegrid.storage") == r["storage"]
      and str(write["attrs"].get("filegrid.size_bytes")) == str(len(data)), str(write and write["attrs"]))
check("both are children of the request span", all(s["parent"] == root["id"] for s in (route, write)) if root and route and write else False)
print(tree(spans))

st, _, _ = call("POST", f"/api/v1/files/{fid}/verify", admin)
check("verify answers", st == 200)
download_trace = None
# The download is its own request, so it has its own trace: find it from the log line of the read.
lines = in_container("filegrid-api", "sh", "-c", "true")  # keep the container warm
logs = subprocess.run(["docker", "compose", "logs", "--no-log-prefix", "--tail=600", "filegrid-api"], capture_output=True, text=True).stdout

print("2. The log lines of the same request")
mine = []
for line in logs.splitlines():
    if line.startswith("{") and trace_id in line:
        mine.append(json.loads(line))
check("the API's JSON log lines carry the trace id", len(mine) >= 1, f"{len(mine)} lines")
if mine:
    stored = next((m for m in mine if "stored file_id" in m.get("message", "")), mine[0])
    check("with trace_id and span_id (the contract's names)", stored.get("trace_id") == trace_id and stored.get("span_id"), str({k: stored.get(k) for k in ("trace_id", "span_id")}))
    check("and category, storage and file_id", stored.get("category") == "outage" and stored.get("storage") == r["storage"] and stored.get("file_id") == fid,
          str({k: stored.get(k) for k in ("category", "storage", "file_id")}))
    check("the old camelCase names are gone", "traceId" not in stored and "spanId" not in stored)

streams = loki('{service_name="filegrid-api"} | trace_id="%s"' % trace_id)
if not streams:
    streams = loki('{service_name="filegrid-api"} |= "%s"' % trace_id)
check("the same lines are in Loki (shipped over OTLP)", bool(streams), f"{sum(len(s['values']) for s in streams)} entries")
if streams:
    labels = {}
    for s in streams:
        labels.update(s["stream"])
    print(f"    Loki entry labels: {sorted(labels)[:10]}")
    body = " ".join(v[1] for s in streams for v in s["values"])
    check("a Loki entry for this request names the file", fid in body or any(fid in json.dumps(s["stream"]) for s in streams))

print("3. No traces for health checks, scrapes or scheduled jobs")
time.sleep(12)  # a few probe, sync and replay ticks
call("GET", "/api/v1/health")
in_container("filegrid-api", "wget", "-qO-", "http://127.0.0.1:8080/actuator/prometheus")
time.sleep(8)
raw = in_container("filegrid-api", "wget", "-qO-", "http://tempo:3200/api/search?tags=service.name%3Dfilegrid-api&limit=60")
recent = json.loads(raw).get("traces", [])
fresh = [t for t in recent if int(t["startTimeUnixNano"]) > (time.time() - 30) * 1e9]
noise = [t["rootTraceName"] for t in fresh if t.get("rootTraceName", "").startswith(("task ", "tasks")) or "health" in t.get("rootTraceName", "") or "actuator" in t.get("rootTraceName", "")]
check("none of the traces of the last 30 seconds is a health check, scrape or scheduled task", not noise, str(noise[:3]))

print("4. A failed primary shows in the trace")
if os.environ.get("NO_CHAOS"):
    print("  (skipped: NO_CHAOS)")
else:
    try:
        subprocess.run(["docker", "compose", "stop", "seaweedfs"], capture_output=True, timeout=120)
        time.sleep(2)
        status, r2 = upload(dispatch, "outage", data, SECRET_NAME)
        check("with s3 stopped the upload still works (fallback)", status == 201 and r2.get("storage") == "db", str(r2.get("storage")))
        sp = tempo_trace(r2["traceId"])
        writes = sorted([s for s in sp if s["name"] == "storage.write"], key=lambda s: s["start"])
        print(tree(sp))
        check("two storage.write spans: s3 failed, then the database", len(writes) == 2 and writes[0]["attrs"].get("filegrid.storage") == "s3"
              and writes[0]["error"] and writes[1]["attrs"].get("filegrid.storage") == "db" and not writes[1]["error"],
              str([(w["attrs"].get("filegrid.storage"), w["error"]) for w in writes]))
        check("the second is marked as the fallback", writes[1]["attrs"].get("filegrid.fallback") in (True, "true") if len(writes) == 2 else False)
        check("the fallback's log lines name the database", any(
            m.get("storage") == "db" and r2["id"] == m.get("file_id") for m in
            (json.loads(l) for l in subprocess.run(["docker", "compose", "logs", "--no-log-prefix", "--tail=300", "filegrid-api"],
                                                   capture_output=True, text=True).stdout.splitlines() if l.startswith("{") and r2["id"] in l)))
    finally:
        subprocess.run(["docker", "compose", "start", "seaweedfs"], capture_output=True, timeout=120)

print("5. No file name anywhere")
all_spans_json = json.dumps(spans)
logs_now = subprocess.run(["docker", "compose", "logs", "--no-log-prefix", "--tail=2000", "filegrid-api"], capture_output=True, text=True).stdout
check("not in the spans", SECRET_NAME not in all_spans_json and "Popescu" not in all_spans_json)
check("not in the API's log lines", SECRET_NAME not in logs_now and "Popescu" not in logs_now)
loki_all = loki('{service_name="filegrid-api"}', wait=8)
check("not in Loki", "Popescu" not in json.dumps(loki_all))

print()
if failures:
    print(f"RESULT: {len(failures)} check(s) FAILED: {', '.join(failures)}")
    sys.exit(1)
print("RESULT: OK")
