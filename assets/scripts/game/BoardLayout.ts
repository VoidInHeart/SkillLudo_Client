import { Vec3 } from 'cc';
import type { PlayerColor } from '../protocol/GameProtocol';

const COLOR_OFFSET: Record<PlayerColor, number> = { RED: 0, YELLOW: 13, BLUE: 26, GREEN: 39 };
const FINAL_START = 52;

// The 52 shared cells on the conventional 15 × 15 cross-shaped Ludo board.
// Row 0 is the visual top; each grid point is converted into Cocos coordinates below.
const MAIN_TRACK: Array<[number, number]> = [
  [13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 8], [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14], [7, 14],
  [6, 14], [6, 13], [6, 12], [6, 11], [6, 10], [6, 9], [6, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  [0, 7], [0, 6], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  [7, 0], [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6]
];
const GRID_SIZE = 40;

/** Converts server logic progress into display coordinates; it is never used by game rules. */
export class BoardLayout {
  public static mainPathPosition(color: PlayerColor, progress: number): Vec3 {
    const index = (COLOR_OFFSET[color] + progress) % 52;
    const point = MAIN_TRACK[index];
    return new Vec3((point[1] - 7) * GRID_SIZE, (7 - point[0]) * GRID_SIZE, 0);
  }

  public static piecePosition(color: PlayerColor, progress: number, state: string, stackIndex = 0): Vec3 {
    let base: Vec3;
    // Completed planes return to their own airport, where the renderer swaps
    // their normal plane silhouette for a coloured completion mark.
    if (state === 'AIRPORT' || state === 'FINISHED') base = this.airportPosition(color, stackIndex);
    else if (progress >= FINAL_START) base = this.finalPathPosition(color, progress - FINAL_START);
    else base = this.mainPathPosition(color, progress);
    if (state !== 'AIRPORT' && state !== 'FINISHED') base.add(new Vec3((stackIndex % 2) * 12 - 6, Math.floor(stackIndex / 2) * 12 - 6, 0));
    return base;
  }

  public static airportPosition(color: PlayerColor, index: number): Vec3 {
    const origin: Record<PlayerColor, Vec3> = {
      // Matches the four coloured airports in ludo-classic-board-cropped.png.
      RED: new Vec3(270, -270), YELLOW: new Vec3(-270, 270),
      BLUE: new Vec3(270, 270), GREEN: new Vec3(-270, -270)
    };
    // The texture's airport circles are a 60 × 60 grid. The previous 34 px
    // spacing placed all four planes between circles instead of inside them.
    const offset = new Vec3((index % 2) * 60 - 30, Math.floor(index / 2) * 60 - 30, 0);
    return origin[color].clone().add(offset);
  }

  public static finalPathPosition(color: PlayerColor, finalIndex: number): Vec3 {
    const angle: Record<PlayerColor, number> = {
      RED: 0, YELLOW: Math.PI,
      BLUE: Math.PI / 2, GREEN: -Math.PI / 2
    };
    const radius = 205 - finalIndex * 30;
    return new Vec3(Math.cos(angle[color]) * radius, Math.sin(angle[color]) * radius, 0);
  }
}
