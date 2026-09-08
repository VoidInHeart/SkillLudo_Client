/** All six cube faces are modeled. Opposite faces sum to seven. Rotation aligns
 * the server-selected face with +Z before the resting presentation tilt. */
export const DIE_FACE_EULER: Record<number, [number, number, number]> = {
  1: [0, 0, 0], 2: [90, 0, 0], 3: [0, -90, 0], 4: [0, 90, 0], 5: [-90, 0, 0], 6: [0, 180, 0]
};
export const DIE_PIPS: Record<number, Array<[number, number]>> = {
  1: [[0, 0]], 2: [[-1, 1], [1, -1]], 3: [[-1, 1], [0, 0], [1, -1]],
  4: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  5: [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]]
};
/** Two visible rebounds, damped continuously into the final resting pose. */
export function throwHeight(t: number): number {
  if (t < 0.56) { const u = t / 0.56; return 150 * (1 - u * u); }
  if (t < 0.8) return 34 * Math.sin(Math.PI * (t - 0.56) / 0.24);
  return 10 * Math.sin(Math.PI * (t - 0.8) / 0.2);
}
