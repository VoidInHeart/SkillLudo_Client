/** Shared board/HUD layout: all values are Canvas coordinates. */
export function gameViewport(width: number, height: number) {
  const portrait = height > width;
  const boardSize = portrait ? Math.min(width - 32, height - 410) : Math.min(height - 48, width - 332);
  return {
    portrait,
    boardSize: Math.max(240, boardSize),
    boardX: portrait ? 0 : -146,
    boardY: portrait ? height / 2 - boardSize / 2 - 66 : 0,
    hudX: portrait ? 0 : width / 2 - 155,
    hudY: portrait ? height / 2 - boardSize - 236 : 0,
    hudWidth: portrait ? Math.min(width - 40, 660) : 286,
    hudHeight: portrait ? 310 : Math.min(height - 40, 664)
  };
}
