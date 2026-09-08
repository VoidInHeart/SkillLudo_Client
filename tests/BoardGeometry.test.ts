import assert from 'node:assert/strict';
import test from 'node:test';
import { BOARD_ANCHORS, BOARD_SHAPES, CLOCKWISE_COLORS, DEFAULT_POSITIONS, VIEW_TURNS, rotateBoard, trackKey } from '../assets/scripts/game/BoardGeometry';
import { FINAL_PATH_START, FINISH_PROGRESS, getBoardCell, isSameColorMainCell } from '../assets/scripts/game/PathData';

test('96 unique centres cover every white cell and takeoff arrow', () => {
  assert.equal(BOARD_ANCHORS.length, 96);
  assert.equal(new Set(BOARD_ANCHORS.map((a) => a.key)).size, 96);
  assert.equal(BOARD_ANCHORS.filter((a) => a.kind === 'track').length, 52);
  assert.equal(BOARD_ANCHORS.filter((a) => a.kind === 'airport').length, 16);
  assert.equal(BOARD_ANCHORS.filter((a) => a.kind === 'runway').length, 24);
  for (const anchor of BOARD_ANCHORS.filter((a) => a.kind !== 'takeoff')) {
    assert.ok(BOARD_SHAPES.some((shape) => shape.kind === 'circle' && shape.center[0] === anchor.center[0] && shape.center[1] === anchor.center[1]), anchor.key);
  }
});

test('painted ring matches every authoritative colour test and home turn', () => {
  for (const color of CLOCKWISE_COLORS) {
    for (let progress = 1; progress < FINAL_PATH_START; progress += 1) {
      const key = trackKey(Number(getBoardCell(color, progress)!.slice(1)));
      const anchor = BOARD_ANCHORS.find((a) => a.key === key)!;
      assert.equal(anchor.color === color, isSameColorMainCell(color, progress), `${color} ${progress}`);
    }
    const at = (p: number) => DEFAULT_POSITIONS[trackKey(Number(getBoardCell(color, p)!.slice(1)))];
    const entry = at(50);
    const runway = DEFAULT_POSITIONS[`${color.toLowerCase()}-landing-1`];
    assert.ok(Math.hypot(entry.x - runway.x, entry.y - runway.y) < 60);
    assert.equal(getBoardCell(color, FINISH_PROGRESS), `F-${color}-5`);
    const flightKey = trackKey(Number(getBoardCell(color, 18)!.slice(1)));
    assert.equal(BOARD_ANCHORS.find((a) => a.key === flightKey)?.color, color);
  }
});

test('all personal views place the local airport lower-left and round-trip calibration coordinates', () => {
  for (const color of CLOCKWISE_COLORS) {
    const turns = VIEW_TURNS[color];
    const point = DEFAULT_POSITIONS[`${color.toLowerCase()}-airport-1`];
    const local = rotateBoard(point, turns);
    assert.ok(local.x < 0 && local.y < 0, color);
    assert.deepEqual(rotateBoard(local, -turns), point);
  }
});
