import { round } from "./stats.js";
import { BENCH_CATEGORIES, STORAGES, type Category, type Cell, type Evidence, type Recommendation, type Storage } from "./types.js";

// Facts no benchmark can show: what each storage guarantees. A fit adds a fixed bonus, so a
// storage that is somewhat slower can still win, and the reason says by how much it lost.
const FIT: Partial<Record<Category, { storage: Storage; why: string }>> = {
  document: { storage: "ftp", why: "FTPS keeps the encrypted-document audit trail on a separate service" },
  video: { storage: "s3", why: "S3 multipart upload is what makes large transfers resumable" },
  meter: { storage: "db", why: "the database gives transactional de-duplication: a unique constraint makes a retry harmless" },
};
const FIT_BONUS = 0.25;
const W = { write: 0.4, read: 0.2, throughput: 0.4 } as const;

const viable = (c: Cell) => c.status === "done" && c.errors === 0 && c.integrityOk === true && c.write !== undefined && c.read !== undefined;
const ms = (n: number) => `${round(n, n < 10 ? 1 : 0)} ms`;
const label = (s: Storage) => ({ db: "PostgreSQL", s3: "S3", ftp: "FTPS" })[s];

function score(c: Cell, best: { w: number; r: number; t: number }): number {
  return (
    W.write * (best.w / Math.max(c.write!.p95Ms, 0.001)) +
    W.read * (best.r / Math.max(c.read!.p95Ms, 0.001)) +
    W.throughput * ((c.throughputMBps ?? 0) / Math.max(best.t, 0.001))
  );
}

function chips(c: Cell): Evidence[] {
  return [
    { label: "write p95", value: ms(c.write!.p95Ms) },
    { label: "read p95", value: ms(c.read!.p95Ms) },
    { label: "write", value: `${round(c.throughputMBps ?? 0)} MB/s` },
    { label: "errors", value: `${c.errors} of ${c.completed}` },
    { label: "SHA-256", value: "verified" },
  ];
}

interface Ranked { c: Cell; perf: number; total: number }
/** A category's recommendation plus what the coverage pass needs to re-pin it. */
interface Pick { rec: Recommendation; ranked: Ranked[]; ruledOut: string[] }

function pickCategory(category: Category, cells: Cell[]): Pick {
  const mine = cells.filter((c) => c.category === category);
  const ok = mine.filter(viable);
  const fit = FIT[category];
  const reasons: string[] = [];
  for (const c of mine.filter((m) => m.status === "done" && !viable(m))) {
    const why = c.errorSamples[0] ?? (c.integrityOk === false ? "integrity check failed" : "no successful sample");
    reasons.push(`${label(c.storage)} was ruled out: ${c.errors} of ${c.completed} samples failed (${why}).`);
  }
  if (ok.length === 0) {
    const storage = fit?.storage ?? "s3";
    const rec: Recommendation = { category, storage, benchmarked: false, evidence: [], reasons: [...reasons, "No storage completed every sample, so the fixed fit decides."], reason: `No storage passed the benchmark. ${fit ? `Keeping ${label(storage)}: ${fit.why}.` : ""}`.trim() };
    return { rec, ranked: [], ruledOut: reasons };
  }
  const best = { w: Math.min(...ok.map((c) => c.write!.p95Ms)), r: Math.min(...ok.map((c) => c.read!.p95Ms)), t: Math.max(...ok.map((c) => c.throughputMBps ?? 0)) };
  const ruledOut = [...reasons];
  const ranked: Ranked[] = ok
    .map((c) => ({ c, perf: score(c, best), total: score(c, best) + (fit?.storage === c.storage ? FIT_BONUS : 0) }))
    .sort((a, b) => b.total - a.total);
  const top = ranked[0]!;
  const fastest = [...ranked].sort((a, b) => b.perf - a.perf)[0]!;
  const w = top.c.write!;
  reasons.unshift(`${label(top.c.storage)}: write p95 ${ms(w.p95Ms)}, read p95 ${ms(top.c.read!.p95Ms)}, ${round(top.c.throughputMBps ?? 0)} MB/s, 0 errors, SHA-256 verified on every download.`);
  if (ok.length > 1) {
    const next = ranked[1]!.c;
    reasons.push(`Next best, ${label(next.storage)}: write p95 ${ms(next.write!.p95Ms)}, read p95 ${ms(next.read!.p95Ms)}, ${round(next.throughputMBps ?? 0)} MB/s.`);
  } else {
    reasons.push(`${label(top.c.storage)} is the only storage that completed every ${round(top.c.sizeBytes / 1048576, 0)} MB sample.`);
  }
  if (fit?.storage === top.c.storage) {
    const beat = fastest.c.storage !== top.c.storage;
    reasons.push(`${fit.why}${beat ? `; ${label(fastest.c.storage)} was faster on raw numbers (write p95 ${ms(fastest.c.write!.p95Ms)}), so this choice rests on that guarantee` : ""}.`);
  } else if (fit) {
    const lost = ranked.find((r) => r.c.storage === fit.storage);
    if (lost) {
      reasons.push(`${label(lost.c.storage)} has the guarantee (${fit.why}) but measured write p95 ${ms(lost.c.write!.p95Ms)} and ${round(lost.c.throughputMBps ?? 0)} MB/s against ${ms(w.p95Ms)} and ${round(top.c.throughputMBps ?? 0)} MB/s, which outweighs that guarantee.`);
    } else {
      reasons.push(`${label(fit.storage)} has the guarantee (${fit.why}) but did not complete the benchmark.`);
    }
  } else {
    reasons.push("No storage guarantee applies to this category, so latency and throughput decide.");
  }
  return { rec: { category, storage: top.c.storage, benchmarked: true, evidence: chips(top.c), reasons, reason: reasons.slice(0, 2).join(" ") }, ranked, ruledOut };
}

const SUBJECT: Partial<Record<Category, { noun: string; verb: string }>> = {
  document: { noun: "documents", verb: "stay" },
  outage: { noun: "outage records", verb: "stay" },
  video: { noun: "drone video", verb: "stays" },
};

/** "FTPS keeps the audit trail" reads as "it keeps the audit trail" right after naming FTPS. */
const asClause = (why: string) => why.replace(/^(PostgreSQL|S3|FTPS) keeps /, "it keeps ");

/**
 * Brief gating 2: FTP, S3 and the database must each be really used. If the per-category winners
 * leave a storage with no category, the category that loses least by moving there takes it, and
 * the reason names both the faster storage and the rule, so the constraint is a stated judgement.
 */
function enforceCoverage(meter: Recommendation, picks: Pick[]): void {
  for (const s of STORAGES) {
    if ([meter, ...picks.map((p) => p.rec)].some((r) => r.storage === s)) continue;
    const options = picks.flatMap((p) => {
      const to = p.ranked.find((r) => r.c.storage === s);
      const from = p.ranked.find((r) => r.c.storage === p.rec.storage);
      // Moving must not strand the storage this category currently holds.
      const others = [meter, ...picks.filter((q) => q !== p).map((q) => q.rec)];
      return to && from && others.some((r) => r.storage === p.rec.storage) ? [{ p, to, from, loss: from.total - to.total }] : [];
    });
    const best = options.sort((a, b) => a.loss - b.loss)[0];
    if (best) repin(best.p, best.to, best.from);
  }
}

function repin(p: Pick, to: Ranked, from: Ranked): void {
  const cat = p.rec.category;
  const subject = SUBJECT[cat]!;
  const fit = FIT[cat];
  const kept = label(to.c.storage);
  const faster = to.c.write!.p95Ms > from.c.write!.p95Ms;
  const reason =
    `${label(from.c.storage)} ${faster ? "was faster" : "ranked higher"} for ${subject.noun} (write p95 ${ms(from.c.write!.p95Ms)} vs ${ms(to.c.write!.p95Ms)} on ${kept}), ` +
    `but ${subject.noun} ${subject.verb} on ${kept}: ${fit?.storage === to.c.storage ? `${asClause(fit.why)}, and ` : ""}the brief requires every storage to be in use.`;
  const head = `${kept}: write p95 ${ms(to.c.write!.p95Ms)}, read p95 ${ms(to.c.read!.p95Ms)}, ${round(to.c.throughputMBps ?? 0)} MB/s, 0 errors, SHA-256 verified on every download.`;
  p.rec.storage = to.c.storage;
  p.rec.reasons = [head, reason, ...p.ruledOut];
  p.rec.reason = [head, reason].join(" ");
  p.rec.evidence = [...chips(to.c), { label: `${label(from.c.storage)} write p95`, value: ms(from.c.write!.p95Ms) }];
}

export function recommend(cells: Cell[]): Recommendation[] {
  const meter: Recommendation = {
    category: "meter",
    storage: "db",
    benchmarked: false,
    evidence: [],
    reasons: [`Meters are not benchmarked here; the simulator drives them. PostgreSQL stays: ${FIT.meter!.why}.`],
    reason: `PostgreSQL: ${FIT.meter!.why}. Not benchmarked here.`,
  };
  const picks = BENCH_CATEGORIES.map((c) => pickCategory(c, cells));
  enforceCoverage(meter, picks);
  return [meter, ...picks.map((p) => p.rec)];
}
