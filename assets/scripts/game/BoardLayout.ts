import { Vec3 } from 'cc';
import type { BoardCalibrationData, PlayerColor } from '../protocol/GameProtocol';
import { DEFAULT_POSITIONS, trackKey } from './BoardGeometry';
import { FINAL_PATH_START, getBoardCell } from './PathData';

/** Coordinates and overrides always use canonical, unrotated 720 px board space. */
export class BoardLayout {
  private static overrides: Record<string, { x: number; y: number }> = {};
  public static setCalibrationData(data: BoardCalibrationData): void {
    this.overrides = Object.fromEntries(Object.entries(data.positions ?? {}).filter(([key, point]) => !!DEFAULT_POSITIONS[key] && Number.isFinite(point.x) && Number.isFinite(point.y)));
  }
  public static namedPosition(key: string): Vec3 | null {
    const point = this.overrides[key.toLowerCase()] ?? DEFAULT_POSITIONS[key.toLowerCase()];
    return point ? new Vec3(point.x, point.y, 0) : null;
  }
  public static calibrationPosition(key: string): Vec3 { return this.namedPosition(key) ?? Vec3.ZERO.clone(); }
  public static mainPathPosition(color: PlayerColor, progress: number, detour = false): Vec3 {
    const cell = getBoardCell(color, progress, detour);
    if (!cell || cell.startsWith('T-')) return this.takeoffPosition(color);
    if (cell.startsWith('F-')) return this.finalPathPosition(color, progress - FINAL_PATH_START);
    return this.calibrationPosition(trackKey(Number(cell.slice(1))));
  }
  public static piecePosition(color: PlayerColor, progress: number, state: string, airportIndex = 0, detour = false): Vec3 {
    if (state === 'AIRPORT' || state === 'FINISHED') return this.airportPosition(color, airportIndex);
    // Stacks grow vertically in 3D; footprints always stay at the cell centre.
    return this.mainPathPosition(color, progress, detour);
  }
  public static airportPosition(color: PlayerColor, index: number): Vec3 { return this.calibrationPosition(`${color.toLowerCase()}-airport-${Math.max(0, Math.min(3, index)) + 1}`); }
  public static takeoffPosition(color: PlayerColor): Vec3 { return this.calibrationPosition(`${color.toLowerCase()}-takeoff`); }
  public static finalPathPosition(color: PlayerColor, index: number): Vec3 { return this.calibrationPosition(`${color.toLowerCase()}-landing-${Math.max(0, Math.min(5, index)) + 1}`); }
}
