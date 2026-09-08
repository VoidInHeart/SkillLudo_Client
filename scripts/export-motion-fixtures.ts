/** Presentation fixtures calculated by the real server rules; never shipped. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { GameRules } from '../../SkillLudo_Server/src/game/GameRules.js';
import { getBoardCell } from '../../SkillLudo_Server/src/game/PathData.js';
import type { GameState, Piece, PlayerColor } from '../../SkillLudo_Server/src/protocol.js';

const rules = new GameRules();
const plane = (color: PlayerColor, progress: number): Piece => ({ id: `${color}-1`, playerId: color, color, progress, state: 'MAIN_PATH' });
function opponent(color: PlayerColor, greenProgress: number): Piece {
  const progress = Array.from({ length: 50 }, (_, i) => i + 1).find((p) => getBoardCell(color, p) === getBoardCell('GREEN', greenProgress));
  if (progress === undefined) throw new Error('No matching shared cell');
  return plane(color, progress);
}
const scenarios = [
  { name: 'capture', dice: 1, pieces: [plane('GREEN', 2), opponent('BLUE', 3)] },
  { name: 'wormhole', dice: 2, pieces: [plane('GREEN', 12), opponent('BLUE', 27), opponent('RED', 30)] },
  { name: 'finish', dice: 1, pieces: [plane('GREEN', 55)] },
  { name: 'rebound', dice: 4, pieces: [plane('GREEN', 55)] }
].map((scenario) => ({ ...scenario, result: rules.calculateMove({ pieces: scenario.pieces } as GameState, 'GREEN', 'GREEN-1', scenario.dice) }));
mkdirSync('docs/verification', { recursive: true });
writeFileSync('docs/verification/motion-fixtures.json', JSON.stringify(scenarios, null, 2) + '\n');
console.log(`Exported ${scenarios.length} authority-calculated presentation fixtures.`);
