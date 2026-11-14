#!/usr/bin/env python3
"""Re-computes the audit_log hash chain from the database, independently of the Java service.

Rule (the same as AuditChain.java): hash = hex(sha256(prev_hash + event_json)), prev_hash is the
previous row's hash (64 zeros for the first), event_json is compact JSON with sorted keys holding
action, actor, at (microseconds since the epoch), details, file_id.

Run from the repo root with the stack up: `make a-audit-check`. Exit code 1 if the chain is broken.
"""
import hashlib, json, subprocess, sys

GENESIS = "0" * 64

QUERY = """
select coalesce(json_agg(t order by id), '[]'::json) from (
  select id, (extract(epoch from at) * 1000000)::bigint as at_us, actor, action,
         file_id::text as file_id, details::text as details, prev_hash, hash
  from audit_log order by id) t
"""


def psql(sql):
    out = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "filegrid", "-d", "filegrid", "-tA", "-c", sql],
        capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip())
    return out.stdout.strip()


def event_json(row):
    event = {"action": row["action"], "actor": row["actor"], "at": row["at_us"],
             "details": json.loads(row["details"]), "file_id": row["file_id"]}
    return json.dumps(event, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def verify(rows):
    """Returns (ok, count, first_bad_id, problem)."""
    prev = GENESIS
    for row in rows:
        if row["prev_hash"] != prev:
            return False, len(rows), row["id"], "chain broken: prev_hash does not match the previous row"
        expected = hashlib.sha256((prev + event_json(row)).encode("utf-8")).hexdigest()
        if expected != row["hash"]:
            return False, len(rows), row["id"], "row content changed: hash does not match its fields"
        prev = row["hash"]
    return True, len(rows), None, None


def load_rows():
    return json.loads(psql(QUERY))


def main():
    rows = load_rows()
    ok, count, bad, problem = verify(rows)
    if ok:
        print(f"audit chain OK: {count} rows, head {rows[-1]['hash'][:16]}..." if rows else "audit chain OK: empty log")
        return 0
    print(f"audit chain BROKEN at row id {bad}: {problem}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
