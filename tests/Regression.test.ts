import assert from 'node:assert/strict';
import test from 'node:test';
import { MotionTimeline } from '../assets/scripts/game/MotionTimeline';
import { PresentationQueue } from '../assets/scripts/game/PresentationQueue';
import { gameViewport } from '../assets/scripts/game/GameViewport';
import { DEFAULT_POSITIONS, VIEW_TURNS, rotateBoard } from '../assets/scripts/game/BoardGeometry';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test('C01: a late pre-reconnect animation cannot unlock or consume the new queue', { timeout: 2000 }, async () => {
  const old = deferred(), current = deferred(), events: string[] = [], locks: boolean[] = [];
  const queue = new PresentationQueue((busy) => locks.push(busy), (error) => assert.fail(String(error)));
  queue.enqueue(() => old.promise);
  queue.enqueue(() => { events.push('obsolete snapshot'); });
  queue.reset();
  queue.enqueue(() => current.promise);
  queue.enqueue(() => { events.push('fresh snapshot'); });
  old.resolve(); await flush();
  assert.deepEqual(events, []);
  assert.deepEqual(locks, [true, false, true]);
  current.resolve(); await flush();
  assert.deepEqual(events, ['fresh snapshot']);
  assert.deepEqual(locks, [true, false, true, false]);
});

test('C02: a failed presentation reports once and still applies the following snapshot', { timeout: 2000 }, async () => {
  const start = deferred(), errors: unknown[] = [], events: string[] = [], locks: boolean[] = [];
  const failure = new Error('simulated presentation failure');
  const queue = new PresentationQueue((busy) => locks.push(busy), (error) => errors.push(error));
  queue.enqueue(async () => { await start.promise; throw failure; });
  queue.enqueue(() => { events.push('resync'); });
  start.resolve(); await flush();
  assert.deepEqual(errors, [failure]);
  assert.deepEqual(events, ['resync']);
  assert.deepEqual(locks, [true, false]);
});

test('C03: simultaneous dice finish independently and dropped frames sample the exact endpoint once', { timeout: 2000 }, async () => {
  const timeline = new MotionTimeline(), first: number[] = [], second: number[] = [];
  const a = timeline.animate(0.5, (t) => first.push(t));
  const b = timeline.animate(1, (t) => second.push(t));
  timeline.update(-1); timeline.update(0.5);
  assert.equal(await a, true);
  assert.equal(first.at(-1), 1);
  assert.equal(second.at(-1), 0.5);
  timeline.update(10); timeline.update(10);
  assert.equal(await b, true);
  assert.equal(first.filter((t) => t === 1).length, 1);
  assert.equal(second.filter((t) => t === 1).length, 1);
  assert.ok([...first, ...second].every((t) => t >= 0 && t <= 1));
});

test('C04: cancel settles every active motion and a subsequent turn can animate normally', { timeout: 2000 }, async () => {
  const timeline = new MotionTimeline(), samples: number[] = [];
  const dice = timeline.animate(1, (t) => samples.push(t));
  const victim = timeline.animate(2, (t) => samples.push(t));
  timeline.update(0.2); timeline.cancel(); timeline.cancel();
  const count = samples.length;
  timeline.update(20);
  assert.deepEqual(await Promise.all([dice, victim]), [false, false]);
  assert.equal(samples.length, count);
  const next = timeline.animate(0.1, (t) => samples.push(t));
  timeline.update(0.1);
  assert.equal(await next, true);
  assert.equal(samples.at(-1), 1);
});

test('C05: a capture animation created during a frame does not inherit that frame delta', { timeout: 2000 }, async () => {
  const timeline = new MotionTimeline(), childSamples: number[] = [];
  let child: Promise<boolean> | undefined;
  const parent = timeline.animate(0.5, (t) => {
    if (t === 1) child = timeline.animate(1, (progress) => childSamples.push(progress));
  });
  timeline.update(0.5);
  assert.equal(await parent, true);
  assert.deepEqual(childSamples, [0]);
  timeline.update(0.5);
  assert.deepEqual(childSamples, [0, 0.5]);
  timeline.update(0.5);
  assert.equal(await child, true);
});

test('C06: supported Canvas aspect ratios keep the complete square board and HUD apart', () => {
  // These are Canvas units after ResponsiveCanvas scales the device dimensions.
  for (const [width, height] of [[1280, 720], [1152, 720], [960, 720], [1560, 720], [720, 720], [720, 960], [720, 1280], [720, 1558]]) {
    const layout = gameViewport(width, height);
    const { boardX: x, boardY: y, boardSize: size, hudX, hudY, hudWidth, hudHeight } = layout;
    const label = `${width}x${height}`;
    assert.ok(size > 0 && Math.abs(x) + size / 2 <= width / 2, `board horizontal bounds ${label}`);
    assert.ok(Math.abs(y) + size / 2 <= height / 2, `board vertical bounds ${label}`);
    assert.ok(Math.abs(hudX) + hudWidth / 2 <= width / 2, `HUD horizontal bounds ${label}`);
    assert.ok(Math.abs(hudY) + hudHeight / 2 <= height / 2, `HUD vertical bounds ${label}`);
    assert.ok(layout.portrait ? hudY + hudHeight / 2 < y - size / 2 : x + size / 2 < hudX - hudWidth / 2, `overlap ${label}`);
  }
});

test('C07: all 96 calibration anchors round-trip through every player view without merging', () => {
  for (const turns of Object.values(VIEW_TURNS)) {
    const points = Object.entries(DEFAULT_POSITIONS).map(([key, point]) => {
      const rotated = rotateBoard(point, turns), restored = rotateBoard(rotated, -turns);
      assert.ok(Math.hypot(restored.x - point.x, restored.y - point.y) < 1e-9, key);
      assert.ok(Math.abs(Math.hypot(rotated.x, rotated.y) - Math.hypot(point.x, point.y)) < 1e-9, key);
      return `${rotated.x},${rotated.y}`;
    });
    assert.equal(new Set(points).size, 96);
  }
});
