import { Vec3 } from 'cc';
import type { BoardCalibrationData, PlayerColor } from '../protocol/GameProtocol';

// Node 01 is the first outer circle after yellow's takeoff arrow. Each colour
// joins the same clockwise ring thirteen nodes after the preceding colour.
const CLOCKWISE_NODE_OFFSET: Record<PlayerColor, number> = { YELLOW: 0, BLUE: 13, RED: 26, GREEN: 39 };
const FINAL_START = 52;

// The 52 shared cells on the conventional 15 × 15 cross-shaped Ludo board.
// Row 0 is the visual top; each grid point is converted into Cocos coordinates below.
const MAIN_TRACK: Array<[number, number]> = [
  [14, 8], [13, 8], [12, 8], [11, 8], [10, 8], [9, 8], [8, 8], [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  [7, 14], [6, 14], [6, 13], [6, 12], [6, 11], [6, 10], [6, 9], [6, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8],
  [0, 8], [0, 7], [0, 6], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 6], [6, 5], [6, 4], [6, 3], [6, 2], [6, 1],
  [6, 0], [7, 0], [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 6], [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6]
];
const FINAL_TRACK: Record<PlayerColor, Array<[number, number]>> = {
  // First cell follows the colour's painted turn arrow; the sixth is beside
  // the central destination. Every item is the centre of a white circle.
  RED: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
  YELLOW: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
  BLUE: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
  GREEN: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]]
};
const GRID_SIZE = 40;

/** Converts server logic progress into display coordinates; it is never used by game rules. */
export class BoardLayout {
  private static calibratedPositions: Record<string, { x: number; y: number }> = {};

  public static setCalibrationData(data: BoardCalibrationData): void {
    this.calibratedPositions = { ...(data.positions ?? {}) };
  }

  public static namedPosition(key: string): Vec3 | null {
    const position = this.calibratedPositions[key.toLowerCase()];
    return position ? new Vec3(position.x, position.y, 0) : null;
  }

  public static mainPathPosition(color: PlayerColor, progress: number): Vec3 {
    if (progress <= 0) return this.takeoffPosition(color);
    const index = (CLOCKWISE_NODE_OFFSET[color] + progress - 1) % 52;
    const calibrated = this.namedPosition(String(index + 1).padStart(2, '0'));
    if (calibrated) return calibrated;
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
    const calibrated = this.namedPosition(`${color.toLowerCase()}-airport-${index + 1}`);
    if (calibrated) return calibrated;
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

  public static takeoffPosition(color: PlayerColor): Vec3 {
    const calibrated = this.namedPosition(`${color.toLowerCase()}-takeoff`);
    if (calibrated) return calibrated;
    const fallback: Record<PlayerColor, Vec3> = {
      YELLOW: new Vec3(-300, 160), BLUE: new Vec3(160, 300),
      RED: new Vec3(300, -160), GREEN: new Vec3(-160, -300)
    };
    return fallback[color].clone();
  }

  public static finalPathPosition(color: PlayerColor, finalIndex: number): Vec3 {
    const seq = Math.max(1, Math.min(6, finalIndex + 1));
    const calibrated = this.namedPosition(`${color.toLowerCase()}-landing-${seq}`);
    if (calibrated) return calibrated;
    const point = FINAL_TRACK[color][Math.max(0, Math.min(FINAL_TRACK[color].length - 1, finalIndex))];
    return new Vec3((point[1] - 7) * GRID_SIZE, (7 - point[0]) * GRID_SIZE, 0);
  }
}
