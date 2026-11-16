/**
 * Actions on the bar grid: every(bars, fn), at(bar, fn), next(fn). They
 * fire a little before their bar, so quantized actions (jumps, starts)
 * land right on it.
 */
export type Job = {
  id: number;
  // the block that made it; running the block again replaces its jobs
  owner: string;
  // cycle (bar) it fires for next
  at: number;
  // repeats every this many bars; once when unset
  every?: number;
  run: () => unknown;
  label: string;
};

// fire this far (in bars) ahead of the boundary
export const Lead = 0.125;

/** First multiple of `bars` strictly after `cycle` (with the lead) */
export const nextBoundary = (cycle: number, bars: number) =>
  (Math.floor((cycle + Lead) / bars) + 1) * bars;

export class Scheduler {
  private jobs = new Map<number, Job>();
  private nextId = 1;

  constructor(private onError: (job: Job, error: Error) => void = () => {}) {}

  list() {
    return [...this.jobs.values()];
  }

  every(owner: string, now: number, bars: number, run: () => unknown) {
    const step = Math.max(0.25, bars);
    return this.add({ owner, at: nextBoundary(now, step), every: step, run, label: `every ${step}` });
  }

  /** Once, on bar `bar` (1 based, as shown); the next one if it passed */
  at(owner: string, now: number, bar: number, run: () => unknown) {
    const cycle = Math.max(0, bar - 1);
    return this.add({ owner, at: cycle <= now + Lead ? nextBoundary(now, 1) : cycle, run, label: `at ${bar}` });
  }

  next(owner: string, now: number, run: () => unknown, bars = 1) {
    return this.add({ owner, at: nextBoundary(now, Math.max(0.25, bars)), run, label: "next" });
  }

  private add(job: Omit<Job, "id">) {
    const id = this.nextId++;
    this.jobs.set(id, { ...job, id });
    return id;
  }

  cancel(id?: number) {
    if (id === undefined) this.jobs.clear();
    else this.jobs.delete(id);
  }

  /** Drops what a block scheduled, before it runs again */
  cancelOwner(owner: string) {
    for (const job of this.jobs.values()) if (job.owner === owner) this.jobs.delete(job.id);
  }

  /** Runs what is due at `cycle`; returns how many fired */
  tick(cycle: number) {
    let fired = 0;
    for (const job of [...this.jobs.values()]) {
      if (cycle + Lead < job.at) continue;
      fired++;
      try {
        job.run();
      } catch (error) {
        this.onError(job, error as Error);
      }
      if (job.every) {
        // skip boundaries missed while the clock was stopped
        job.at = nextBoundary(Math.max(cycle, job.at), job.every);
      } else {
        this.jobs.delete(job.id);
      }
    }
    return fired;
  }
}
