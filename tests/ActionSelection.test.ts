import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionSelection } from '../assets/scripts/game/ActionSelection';
import type { ActionOption, GameSnapshot } from '../assets/scripts/protocol/GameProtocol';
const option = (index: number): ActionOption => ({ id: `die-${index}`, dieIndex: index, dice: index + 3, label: String(index + 3), kind: 'STANDARD', extraTurn: false, movablePieceIds: [`plane-${index}`], movePreviews: {} });
const snapshot = () => ({ roomId: '123456', rollId: 1, currentPlayerId: 'a', phase: 'WAIT_SELECT_DIE' as const,
  players: [{ id: 'a', color: 'RED' as const, nickname: 'A', connected: true, ready: true }], actionOptions: [option(0), option(1)] });

test('C12: selecting and switching a die only changes the local preview', () => {
  const state = snapshot(), before = structuredClone(state), selection = new ActionSelection();
  assert.equal(selection.current(state, 'a'), null);
  assert.equal(selection.choose(state, 'a', 'die-0'), true);
  assert.deepEqual(selection.current(state, 'a')!.movablePieceIds, ['plane-0']);
  assert.equal(selection.choose(state, 'a', 'die-1'), true);
  assert.deepEqual(selection.current(state, 'a')!.movablePieceIds, ['plane-1']);
  assert.deepEqual(state, before);
});

test('C13: new rolls, rooms and trustee mode invalidate an uncommitted selection', () => {
  for (const update of [{ rollId: 2 }, { roomId: '654321' }, { currentPlayerId: 'b' }, { phase: 'WAIT_ROLL' }, { players: [{ ...snapshot().players[0], aiControlled: true }] }]) {
    const selection = new ActionSelection(), state = snapshot();
    selection.choose(state, 'a', 'die-0');
    assert.equal(selection.current({ ...state, ...update } as GameSnapshot, 'a'), null);
  }
});

test('C14: authoritative option refresh replaces highlights without retaining old previews', () => {
  const selection = new ActionSelection(), state = snapshot();
  selection.choose(state, 'a', 'die-0');
  const changed = { ...state, actionOptions: [{ ...option(0), movablePieceIds: [] }] };
  assert.deepEqual(selection.current(changed, 'a')!.movablePieceIds, []);
  assert.equal(selection.choose(changed, 'a', 'forged'), false);
  assert.equal(selection.current({ ...state, actionOptions: [] }, 'a'), null);
});
