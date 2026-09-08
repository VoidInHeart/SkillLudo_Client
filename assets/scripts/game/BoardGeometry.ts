import type { BoardPosition, PlayerColor } from '../protocol/GameProtocol';

export const BOARD_SIZE = 720;
export const ART_SIZE = 1254;
export const BOARD_ART_VERSION = 'classic-traced-v2';
export const BOARD_COLORS: Record<PlayerColor, string> = { RED: '#e72837', YELLOW: '#ffe126', BLUE: '#087fca', GREEN: '#4ca541' };
export const CLOCKWISE_COLORS: PlayerColor[] = ['YELLOW', 'BLUE', 'RED', 'GREEN'];
export type Point = [number, number];
export type BoardShape =
  | { kind: 'polygon'; points: Point[]; fill: string; stroke?: string; width?: number }
  | { kind: 'circle'; center: Point; radius: number; fill: string; stroke?: string; width?: number }
  | { kind: 'text'; center: Point; value: string; size: number; fill: string; rotation?: number };
export interface BoardAnchor { key: string; kind: 'track' | 'airport' | 'takeoff' | 'runway'; center: Point; color: PlayerColor; }

/** Measured from ludo-classic-board-cropped.png (1254 × 1254). Quarter-turn
 * symmetry removes scan noise; artwork and hit centres share these points. */
const SECTOR_CENTERS: Point[] = [
  [132, 414], [206, 382], [276, 382], [350, 414], [412, 350], [380, 276], [380, 204],
  [412, 130], [487, 104], [557, 104], [627, 104], [697, 104], [767, 104]
];
const SECTOR_POLYGONS: Point[][] = [
  [[36, 452], [172, 310], [172, 452]],
  [[172, 310], [242, 310], [242, 452], [172, 452]],
  [[242, 310], [310, 310], [310, 452], [242, 452]],
  [[310, 310], [452, 452], [310, 452]],
  [[310, 310], [452, 310], [452, 452]],
  [[310, 240], [452, 240], [452, 310], [310, 310]],
  [[310, 172], [452, 172], [452, 240], [310, 240]],
  [[310, 172], [452, 36], [452, 172]],
  [[452, 36], [522, 36], [522, 172], [452, 172]],
  [[522, 36], [592, 36], [592, 172], [522, 172]],
  [[592, 36], [662, 36], [662, 172], [592, 172]],
  [[662, 36], [732, 36], [732, 172], [662, 172]],
  [[732, 36], [802, 36], [802, 172], [732, 172]]
];
const BORDER = '#202929';
const PAPER = '#fffef8';
const sectorColors: PlayerColor[] = ['GREEN', 'YELLOW', 'BLUE', 'RED'];

export function rotateArt([x, y]: Point, turns: number): Point {
  for (let step = 0; step < ((turns % 4) + 4) % 4; step += 1) [x, y] = [ART_SIZE - y, x];
  return [x, y];
}
function rotateColor(color: PlayerColor, turns: number): PlayerColor { return CLOCKWISE_COLORS[(CLOCKWISE_COLORS.indexOf(color) + turns) % 4]; }
export function artToBoard([x, y]: Point): BoardPosition { return { x: (x - ART_SIZE / 2) * BOARD_SIZE / ART_SIZE, y: (ART_SIZE / 2 - y) * BOARD_SIZE / ART_SIZE }; }
export function trackKey(index: number): string { return String(index + 1).padStart(2, '0'); }

export const BOARD_ANCHORS: BoardAnchor[] = [];
export const BOARD_SHAPES: BoardShape[] = [];
const polygon = (points: Point[], fill: string, turns = 0, stroke = BORDER, width = 5): void => { BOARD_SHAPES.push({ kind: 'polygon', points: points.map((p) => rotateArt(p, turns)), fill, stroke, width }); };
const circle = (center: Point, radius: number, fill: string, turns = 0, width = 2.5): void => { BOARD_SHAPES.push({ kind: 'circle', center: rotateArt(center, turns), radius, fill, stroke: BORDER, width }); };
const text = (center: Point, value: string, size: number, fill: string, turns = 0): void => { BOARD_SHAPES.push({ kind: 'text', center: rotateArt(center, turns), value, size, fill, rotation: turns * 90 }); };

polygon([[0, 0], [1254, 0], [1254, 1254], [0, 1254]], PAPER, 0, PAPER, 0);
for (let quarter = 0; quarter < 4; quarter += 1) {
  const color = CLOCKWISE_COLORS[quarter];
  const fill = BOARD_COLORS[color];
  SECTOR_CENTERS.forEach((point, index) => {
    const cellColor = rotateColor(sectorColors[index % 4], quarter);
    polygon(SECTOR_POLYGONS[index], BOARD_COLORS[cellColor], quarter);
    circle(point, 23, PAPER, quarter);
    BOARD_ANCHORS.push({ key: trackKey(quarter * 13 + index), kind: 'track', center: rotateArt(point, quarter), color: cellColor });
  });
  polygon([[16, 16], [306, 16], [306, 306], [16, 306]], fill, quarter, BORDER, 8);
  ([[108, 218], [218, 218], [108, 108], [218, 108]] as Point[]).forEach((point, index) => {
    circle(point, 41, PAPER, quarter);
    BOARD_ANCHORS.push({ key: `${color.toLowerCase()}-airport-${index + 1}`, kind: 'airport', center: rotateArt(point, quarter), color });
  });
  circle([36, 360], 46, fill, quarter, 4);
  text([36, 360], '起点', 27, BORDER, quarter);
  polygon([[82, 318], [113, 318], [113, 310], [136, 326], [113, 342], [113, 334], [82, 334], [89, 326]], fill, quarter, BORDER, 3);
  BOARD_ANCHORS.push({ key: `${color.toLowerCase()}-takeoff`, kind: 'takeoff', center: rotateArt([108, 326], quarter), color });
  for (let step = 0; step < 5; step += 1) {
    const x = 172 + step * 70;
    polygon([[x, 592], [x + 70, 592], [x + 70, 662], [x, 662]], fill, quarter);
    circle([x + 35, 627], 23, PAPER, quarter);
    BOARD_ANCHORS.push({ key: `${color.toLowerCase()}-landing-${step + 1}`, kind: 'runway', center: rotateArt([x + 35, 627], quarter), color });
  }
  polygon([[522, 522], [627, 627], [522, 732]], fill, quarter);
  circle([565, 627], 23, PAPER, quarter);
  BOARD_ANCHORS.push({ key: `${color.toLowerCase()}-landing-6`, kind: 'runway', center: rotateArt([565, 627], quarter), color });
  const turnColor = BOARD_COLORS[rotateColor('BLUE', quarter)];
  polygon([[614, 92], [632, 92], [632, 105], [640, 105], [628, 118], [616, 105], [623, 105], [623, 100], [614, 100]], turnColor, quarter, BORDER, 2);
  const flightColor = BOARD_COLORS[rotateColor('RED', quarter)];
  polygon([[342, 429], [358, 429], [358, 411], [369, 411], [350, 394], [331, 411], [342, 411]], flightColor, quarter, BORDER, 2);
  for (const top of [454, 663]) {
    polygon([[323, top], [377, top], [377, top + 135], [323, top + 135]], PAPER, quarter, BORDER, 3);
    for (let stripe = 0; stripe < 3; stripe += 1) {
      const y = top + 26 + stripe * 28;
      polygon([[329, y + 11], [350, y - 6], [371, y + 11], [371, y + 23], [350, y + 7], [329, y + 23]], flightColor, quarter, flightColor, 0);
    }
  }
}
polygon([[602, 602], [652, 602], [652, 652], [602, 652]], '#0a87b5', 0, BORDER, 3);
text([627, 627], '终点', 20, '#ffffff');

export const DEFAULT_POSITIONS: Record<string, BoardPosition> = Object.fromEntries(BOARD_ANCHORS.map((anchor) => [anchor.key, artToBoard(anchor.center)]));
/** Positive Cocos rotation is counterclockwise. Every local airport ends at SW. */
export const VIEW_TURNS: Record<PlayerColor, number> = { GREEN: 0, YELLOW: 1, BLUE: 2, RED: 3 };
export function rotateBoard(point: BoardPosition, turns: number): BoardPosition {
  let { x, y } = point;
  for (let step = 0; step < ((turns % 4) + 4) % 4; step += 1) [x, y] = [-y, x];
  return { x, y };
}
