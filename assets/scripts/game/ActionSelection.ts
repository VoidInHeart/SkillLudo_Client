import type { ActionOption, GameSnapshot } from '../protocol/GameProtocol';
type SelectionState = Pick<GameSnapshot, 'roomId' | 'rollId' | 'currentPlayerId' | 'phase' | 'players' | 'actionOptions'>;

/** A reversible local preview. Only COMMIT_MOVE may consume an authority option. */
export class ActionSelection {
  private key = '';
  private optionId = '';
  public clear(): void { this.key = ''; this.optionId = ''; }
  public current(state: SelectionState, playerId: string): ActionOption | null {
    const key = `${state.roomId}:${state.rollId}:${state.currentPlayerId}`;
    if (key !== this.key || state.phase !== 'WAIT_SELECT_DIE' || state.currentPlayerId !== playerId || state.players.find((p) => p.id === playerId)?.aiControlled) {
      this.optionId = ''; this.key = key;
    }
    return state.actionOptions?.find((option) => option.id === this.optionId) ?? null;
  }
  public choose(state: SelectionState, playerId: string, optionId: string): boolean {
    this.current(state, playerId);
    if (state.phase !== 'WAIT_SELECT_DIE' || state.currentPlayerId !== playerId || state.players.find((p) => p.id === playerId)?.aiControlled
      || !state.actionOptions?.some((option) => option.id === optionId)) return false;
    this.optionId = optionId;
    return true;
  }
}
