import assert from 'node:assert/strict';
import test from 'node:test';
import { MotionTimeline } from '../assets/scripts/game/MotionTimeline';
import { PresentationQueue } from '../assets/scripts/game/PresentationQueue';
import { DIE_FACE_EULER, throwHeight } from '../assets/scripts/game/DiceMotion';

test('fast events wait for the current animation and cancellation settles the queue', async () => {
  const timeline = new MotionTimeline(), events: string[] = [], locks: boolean[] = [];
  const queue = new PresentationQueue((busy) => locks.push(busy), (error) => { throw error; });
  queue.enqueue(async () => { events.push('dice'); await timeline.animate(1, () => undefined); events.push('land'); });
  queue.enqueue(() => { events.push('snapshot'); });
  assert.deepEqual(events, ['dice']);
  timeline.update(0.5); await Promise.resolve();
  assert.deepEqual(events, ['dice']);
  timeline.update(0.5); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, ['dice', 'land', 'snapshot']);
  assert.deepEqual(locks, [true, false]);
  queue.enqueue(async () => { await timeline.animate(2, () => undefined); });
  queue.enqueue(() => { events.push('stale'); });
  timeline.cancel(); queue.reset();
  queue.enqueue(() => { events.push('reconnect'); });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(events.includes('stale'), false);
  assert.equal(events.at(-1), 'reconnect');
});

test('all modeled die faces rotate toward the camera, and rebounds settle at zero', () => {
  const normals: Record<number, number[]> = { 1: [0, 0, 1], 2: [0, 1, 0], 3: [1, 0, 0], 4: [-1, 0, 0], 5: [0, -1, 0], 6: [0, 0, -1] };
  for (let face = 1; face <= 6; face += 1) {
    const [x, y] = DIE_FACE_EULER[face].map((v) => v * Math.PI / 180);
    const [nx, ny, nz] = normals[face];
    const z = -nx * Math.sin(y) + (ny * Math.sin(x) + nz * Math.cos(x)) * Math.cos(y);
    assert.ok(Math.abs(z - 1) < 1e-6, String(face));
  }
  assert.ok(throwHeight(0) > 100);
  for (const t of [0.56, 0.8, 1]) assert.ok(Math.abs(throwHeight(t)) < 1e-9);
  for (let i = 0; i <= 100; i += 1) assert.ok(throwHeight(i / 100) >= -1e-9);
});
