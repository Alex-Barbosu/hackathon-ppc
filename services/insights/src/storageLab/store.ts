import type { Pool } from "pg";
import type { Run } from "./types.js";

interface Row {
  id: string; status: Run["status"]; started_at: Date; finished_at: Date | null;
  samples_per_cell: number; cells: Run["cells"]; recommendation: Run["recommendation"]; error: string | null;
}
const toRun = (r: Row): Run => ({
  id: r.id, status: r.status, startedAt: r.started_at.toISOString(),
  ...(r.finished_at ? { finishedAt: r.finished_at.toISOString() } : {}),
  samplesPerCell: r.samples_per_cell, cells: r.cells, recommendation: r.recommendation,
  ...(r.error ? { error: r.error } : {}),
});

export class RunStore {
  constructor(private readonly pool: Pool) {}

  async create(run: Run): Promise<void> {
    await this.pool.query(
      "INSERT INTO insights.storage_lab_runs (id, status, started_at, samples_per_cell, cells) VALUES ($1,$2,$3,$4,$5)",
      [run.id, run.status, run.startedAt, run.samplesPerCell, JSON.stringify(run.cells)],
    );
  }

  async save(run: Run): Promise<void> {
    await this.pool.query(
      "UPDATE insights.storage_lab_runs SET status=$2, finished_at=$3, cells=$4, recommendation=$5, error=$6 WHERE id=$1",
      [run.id, run.status, run.finishedAt ?? null, JSON.stringify(run.cells), JSON.stringify(run.recommendation), run.error ?? null],
    );
  }

  async get(id: string): Promise<Run | null> {
    const r = await this.pool.query<Row>("SELECT * FROM insights.storage_lab_runs WHERE id=$1", [id]);
    return r.rows[0] ? toRun(r.rows[0]) : null;
  }

  async latest(): Promise<Run | null> {
    const r = await this.pool.query<Row>("SELECT * FROM insights.storage_lab_runs ORDER BY started_at DESC LIMIT 1");
    return r.rows[0] ? toRun(r.rows[0]) : null;
  }

  /** A restart kills the background run; leaving it "running" would spin the UI forever. */
  async failStale(): Promise<void> {
    await this.pool.query("UPDATE insights.storage_lab_runs SET status='failed', finished_at=now(), error='insights restarted during the run' WHERE status='running'");
  }
}
