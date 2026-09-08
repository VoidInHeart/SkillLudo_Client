/** FIFO preserves dice → choice → move → snapshot order even under fast AI.
 * A reset invalidates queued work; consumers separately cancel active animations. */
export class PresentationQueue {
  private tasks: Array<() => Promise<void> | void> = [];
  private epoch = 0;
  private running = false;
  public constructor(private readonly onBusy: (busy: boolean) => void, private readonly onError: (error: unknown) => void) {}
  public enqueue(task: () => Promise<void> | void): void {
    this.tasks.push(task);
    if (!this.running) void this.drain();
  }
  public reset(): void { this.epoch += 1; this.tasks = []; this.running = false; this.onBusy(false); }
  private async drain(): Promise<void> {
    this.running = true;
    const epoch = this.epoch;
    this.onBusy(true);
    while (epoch === this.epoch && this.tasks.length) {
      try { await this.tasks.shift()!(); } catch (error) { this.onError(error); }
    }
    if (epoch !== this.epoch) return;
    this.running = false;
    this.onBusy(false);
  }
}
