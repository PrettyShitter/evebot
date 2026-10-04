export interface Job {
  key: string;
  priority: number;
  due: number;
  run: () => Promise<number>;
  attempts: number;
}
export class Scheduler {
  private jobs = new Map<string, Job>();
  private running = new Set<string>();
  private suspended = false;
  constructor(
    private clock: () => number = Date.now,
    private random: () => number = Math.random,
    readonly concurrency = 2,
  ) {}
  schedule(key: string, priority: number, due: number, run: Job["run"]) {
    const prior = this.jobs.get(key);
    if (prior) {
      if (due < prior.due) {
        prior.due = due;
        prior.priority = Math.min(prior.priority, priority);
        prior.run = run;
      }
      return;
    }
    if (this.running.has(key)) return;
    this.jobs.set(key, { key, priority, due, run, attempts: 0 });
  }
  suspend() {
    this.suspended = true;
  }
  resume() {
    this.suspended = false;
    let offset = 0;
    for (const job of this.jobs.values()) {
      job.due = Math.max(job.due, this.clock() + offset);
      offset += 1000;
    }
  }
  async tick() {
    if (this.suspended) return;
    const ready = [...this.jobs.values()]
      .filter((j) => j.due <= this.clock() && !this.running.has(j.key))
      .sort((a, b) => a.priority - b.priority || a.due - b.due)
      .slice(0, Math.max(0, this.concurrency - this.running.size));
    await Promise.all(
      ready.map(async (j) => {
        this.running.add(j.key);
        try {
          const next = await j.run();
          j.attempts = 0;
          j.due = Math.max(this.clock() + 1000, next);
        } catch (e) {
          const status = (e as { status?: number }).status;
          if (status !== 429 && status !== 420) j.attempts++;
          const retry = (e as { retryAt?: number }).retryAt ?? 0;
          j.due = Math.max(
            retry,
            this.clock() +
              Math.min(300000, 1000 * 2 ** j.attempts) *
                (1 + this.random() * 0.2),
          );
          if (j.attempts >= 5) this.jobs.delete(j.key);
        } finally {
          this.running.delete(j.key);
        }
      }),
    );
  }
  get status() {
    return [...this.jobs.values()].map(({ key, due, attempts }) => ({
      key,
      due,
      attempts,
    }));
  }
  hasDuePrefix(prefix: string) {
    return [...this.jobs.values()].some(
      (job) => job.key.startsWith(prefix) && job.due <= this.clock(),
    );
  }
}
