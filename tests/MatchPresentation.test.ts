import assert from 'node:assert/strict';
import test from 'node:test';
import { inactivitySeconds, secondsRemaining, skillFlashOrange } from '../assets/scripts/ui/MatchPresentation';
import { ActionSelection } from '../assets/scripts/game/ActionSelection';
import type { GameSnapshot } from '../assets/scripts/protocol/GameProtocol';

test('C15: inactivity warning starts after 20 seconds, counts down to zero and excludes observers and paused games', () => {
  const snapshot = { roomStatus: 'PLAYING', players: [{ id: 'p1' }], lifecycle: { activity: { playerId: 'p1', key: '', deadline: 30000 } } } as GameSnapshot;
  assert.equal(inactivitySeconds(snapshot, 'p1', 19999), null);
  assert.equal(inactivitySeconds(snapshot, 'p1', 20000), 10);
  assert.equal(inactivitySeconds(snapshot, 'p1', 29100), 1);
  assert.equal(inactivitySeconds(snapshot, 'p1', 30100), 0);
  assert.equal(inactivitySeconds(snapshot, 'observer', 21000), null);
  snapshot.lifecycle!.pause = { startedAt: 22000, endsAt: 142000 };
  assert.equal(inactivitySeconds(snapshot, 'p1', 29000), null);
});

test('C16: each skill notice gives exactly three orange pulses, then stops', () => {
  assert.deepEqual([0, 300, 600, 900, 1200, 1500, 1800, 2100].map(skillFlashOrange), [true, false, true, false, true, false, false, false]);
  assert.equal(secondsRemaining(120000, 61000), 59); assert.equal(secondsRemaining(120000, 120001), 0);
});

test('C17: a technical pause invalidates local dice previews and prevents new choices until resumed', () => {
  const snapshot = { roomId: '123456', rollId: 1, currentPlayerId: 'p1', phase: 'WAIT_SELECT_DIE', players: [{ id: 'p1' }],
    actionOptions: [{ id: 'die-0' }] } as GameSnapshot;
  const selection = new ActionSelection(); assert.equal(selection.choose(snapshot, 'p1', 'die-0'), true);
  snapshot.lifecycle = { pause: { startedAt: 1, endsAt: 120001 } };
  assert.equal(selection.current(snapshot, 'p1'), null); assert.equal(selection.choose(snapshot, 'p1', 'die-0'), false);
  snapshot.lifecycle.pause = undefined;
  assert.equal(selection.choose(snapshot, 'p1', 'die-0'), true);
});
