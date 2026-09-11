import type { GameSnapshot } from '../protocol/GameProtocol';

export function inactivitySeconds(snapshot: GameSnapshot | null, playerId: string, now: number): number | null {
  const activity = snapshot?.lifecycle?.activity;
  if (!snapshot || snapshot.roomStatus !== 'PLAYING' || snapshot.lifecycle?.pause || activity?.playerId !== playerId
    || snapshot.players.find((p) => p.id === playerId)?.aiControlled || activity.deadline - now > 10_000) return null;
  return Math.max(0, Math.ceil((activity.deadline - now) / 1000));
}
/** Three orange pulses, separated by the ordinary button colour. */
export function skillFlashOrange(elapsedMs: number): boolean {
  return elapsedMs >= 0 && elapsedMs < 1800 && Math.floor(elapsedMs / 300) % 2 === 0;
}
export function secondsRemaining(deadline: number, now: number): number { return Math.max(0, Math.ceil((deadline - now) / 1000)); }
