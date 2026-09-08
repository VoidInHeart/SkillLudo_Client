interface Track { elapsed: number; duration: number; sample: (progress: number) => void; resolve: (completed: boolean) => void; }

/** One frame clock for all visual motion. Cancellation settles promises, so a
 * disconnect/hidden page never strands the network presentation queue. */
export class MotionTimeline {
  private tracks = new Set<Track>();
  public animate(duration: number, sample: (progress: number) => void): Promise<boolean> {
    sample(0);
    return new Promise((resolve) => this.tracks.add({ elapsed: 0, duration: Math.max(0.001, duration), sample, resolve }));
  }
  public update(delta: number): void {
    // Creator's loose Babel mode lowers iterable spread to Array.concat.
    // Array.from preserves Set iteration in both preview and release builds.
    for (const track of Array.from(this.tracks)) {
      track.elapsed += Math.max(0, delta);
      const progress = Math.min(1, track.elapsed / track.duration);
      track.sample(progress);
      if (progress === 1) { this.tracks.delete(track); track.resolve(true); }
    }
  }
  public cancel(): void { for (const track of this.tracks) track.resolve(false); this.tracks.clear(); }
}
export const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
export const smooth = (t: number): number => t * t * (3 - 2 * t);
