import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { BOARD_ANCHORS, BOARD_SHAPES, DEFAULT_POSITIONS, ART_SIZE } from '../assets/scripts/game/BoardGeometry';

const elements = BOARD_SHAPES.map((shape) => {
  const attrs = `fill="${shape.fill}"`;
  if (shape.kind === 'text') return `<text x="${shape.center[0]}" y="${shape.center[1]}" ${attrs} text-anchor="middle" dominant-baseline="central" font-size="${shape.size}" font-family="Microsoft YaHei, sans-serif" font-weight="700" transform="rotate(${shape.rotation ?? 0} ${shape.center.join(' ')})">${shape.value}</text>`;
  const style = `${attrs} stroke="${shape.stroke ?? 'none'}" stroke-width="${shape.width ?? 0}" stroke-linejoin="round"`;
  return shape.kind === 'circle' ? `<circle cx="${shape.center[0]}" cy="${shape.center[1]}" r="${shape.radius}" ${style}/>` : `<polygon points="${shape.points.map((p) => p.join(',')).join(' ')}" ${style}/>`;
});
const svg = (items: string[]) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ART_SIZE} ${ART_SIZE}" width="${ART_SIZE}" height="${ART_SIZE}">${items.join('\n')}</svg>\n`;
const output = resolve('docs/board');
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'classic-board-v2.svg'), svg(elements));
const overlays = BOARD_ANCHORS.flatMap((a) => [
  `<path d="M${a.center[0] - 8} ${a.center[1]}h16 M${a.center[0]} ${a.center[1] - 8}v16" stroke="#ec008c" stroke-width="2"/>`,
  `<text x="${a.center[0]}" y="${a.center[1] - 12}" text-anchor="middle" font-family="sans-serif" font-size="${a.kind === 'track' ? 16 : 10}" fill="#111">${a.key}</text>`
]);
writeFileSync(resolve(output, 'anchors-review.svg'), svg([...elements, ...overlays]));
writeFileSync(resolve(output, 'default-positions.json'), JSON.stringify({ artwork: 'classic-traced-v2', coordinateSystem: '720 px centre origin; x right, y up; unrotated', positions: DEFAULT_POSITIONS }, null, 2) + '\n');
console.log(`Exported board and ${BOARD_ANCHORS.length} exact anchors to docs/board`);
