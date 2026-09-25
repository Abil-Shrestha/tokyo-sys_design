import type { Database } from "./db";

export interface Job {
  id: number;
  type: string;
  itemId: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

export class RetryableError extends Error {}

export type JobHandler = (job: Job) => Promise<void>;

export interface Logger {
  info(msg: string, ...rest: unknown[]): void;
  warn(msg: string, ...rest: unknown[]): void;
  error(msg: string, ...rest: unknown[]): void;
}

export const consoleLogger: Logger = {
  info: (m, ...r) => console.log(`[cabinet] ${m}`, ...r),
  warn: (m, ...r) => console.warn(`[cabinet] ${m}`, ...r),
  error: (m, ...r) => console.error(`[cabinet] ${m}`, ...r),
};

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

/**
 * A small persistent work queue stored in the library database. Jobs survive
 * restarts; failures are retried with backoff when the handler says so.
 */
export class JobRunner {
  private running = 0;
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private idleWaiters: (() => void)[] = [];
  onFailure?: (job: Job, err: unknown, final: boolean) => void;

  constructor(
    private readonly db: Database,
    private readonly handlers: Record<string, JobHandler>,
    private readonly logger: Logger,
    private readonly concurrency = 3,
    private readonly maxAttempts = 3,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.db.run("UPDATE jobs SET locked_at = NULL WHERE locked_at IS NOT NULL");
    this.timer = setInterval(() => this.tick(), 1500);
    this.tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.running > 0) await new Promise((r) => setTimeout(r, 50));
  }

  enqueue(type: string, itemId: string | null, payload: Record<string, unknown> = {}, delayMs = 0): void {
    if (itemId) {
      // Coalesce: one pending job of a given type per item is enough.
      const existing = this.db.get("SELECT id FROM jobs WHERE type = ? AND item_id = ? AND locked_at IS NULL", [type, itemId]);
      if (existing) return;
    }
    this.db.run("INSERT INTO jobs (type, item_id, payload, run_after, created_at) VALUES (?, ?, ?, ?, ?)", [
      type,
      itemId,
      JSON.stringify(payload),
      Date.now() + delayMs,
      Date.now(),
    ]);
    queueMicrotask(() => this.tick());
  }

  pending(): number {
    return Number(this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs")?.n ?? 0);
  }

  /** Resolves once no job is queued or running (used by tests and imports). */
  async idle(timeoutMs = 30_000): Promise<void> {
    const start = Date.now();
    while (this.pending() > 0 || this.running > 0) {
      if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for jobs");
      await new Promise<void>((resolve) => {
        this.idleWaiters.push(resolve);
        setTimeout(resolve, 100);
      });
      this.tick();
    }
  }

  private tick(): void {
    if (this.stopped) return;
    while (this.running < this.concurrency) {
      const row = this.db.get<{ id: number; type: string; item_id: string | null; payload: string; attempts: number }>(
        "SELECT id, type, item_id, payload, attempts FROM jobs WHERE locked_at IS NULL AND run_after <= ? ORDER BY run_after, id LIMIT 1",
        [Date.now()],
      );
      if (!row) break;
      this.db.run("UPDATE jobs SET locked_at = ? WHERE id = ?", [Date.now(), row.id]);
      const job: Job = {
        id: Number(row.id),
        type: row.type,
        itemId: row.item_id,
        payload: JSON.parse(row.payload || "{}"),
        attempts: Number(row.attempts),
      };
      this.running++;
      void this.run(job).finally(() => {
        this.running--;
        const waiters = this.idleWaiters.splice(0);
        for (const w of waiters) w();
        this.tick();
      });
    }
  }

  private async run(job: Job): Promise<void> {
    const handler = this.handlers[job.type];
    if (!handler) {
      this.db.run("DELETE FROM jobs WHERE id = ?", [job.id]);
      return;
    }
    try {
      await handler(job);
      this.safe(() => this.db.run("DELETE FROM jobs WHERE id = ?", [job.id]));
    } catch (err) {
      const attempts = job.attempts + 1;
      const retry = err instanceof RetryableError && attempts < this.maxAttempts;
      const message = err instanceof Error ? err.message : String(err);
      if (retry) {
        const delay = 5_000 * 4 ** (attempts - 1);
        this.safe(() =>
          this.db.run("UPDATE jobs SET attempts = ?, locked_at = NULL, run_after = ?, last_error = ? WHERE id = ?", [
            attempts,
            Date.now() + delay,
            message,
            job.id,
          ]),
        );
        this.logger.warn(`job ${job.type} for ${job.itemId} failed (attempt ${attempts}), retrying: ${message}`);
      } else {
        this.safe(() => this.db.run("DELETE FROM jobs WHERE id = ?", [job.id]));
        this.logger.warn(`job ${job.type} for ${job.itemId} failed: ${message}`);
      }
      try {
        this.onFailure?.(job, err, !retry);
      } catch {
        // ignore
      }
    }
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      // the database may have been closed while the job was in flight
    }
  }
}
