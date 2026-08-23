/**
 * This is the Cocos-side mirror of SkillLudo_Server/src/protocol.ts.
 * It intentionally contains no Node or Cocos dependency so network DTOs remain explicit.
 */
export type PlayerColor = 'RED' | 'YELLOW' | 'BLUE' | 'GREEN';
export type PieceState = 'AIRPORT' | 'MAIN_PATH' | 'FINAL_PATH' | 'FINISHED';
export type RoomStatus = 'WAITING' | 'PLAYING' | 'FINISHED';
export type GamePhase = 'WAIT_ROLL' | 'WAIT_SELECT_PIECE' | 'RESOLVING_MOVE' | 'GAME_OVER';

export type ClientMessageType =
  | 'AUTH' | 'REGISTER' | 'LOGIN' | 'CREATE_ROOM' | 'JOIN_ROOM' | 'LEAVE_ROOM'
  | 'QUICK_MATCH' | 'CHAT_SEND'
  | 'READY' | 'CANCEL_READY' | 'START_GAME'
  | 'ROLL_DICE' | 'SELECT_PIECE' | 'PING' | 'RECONNECT'
  | 'CALIBRATION_OPEN' | 'CALIBRATION_SAVE'
  | 'SET_AI_TAKEOVER' | 'EXIT_GAME' | 'REJOIN_GAME';

export type ServerMessageType =
  | 'AUTH_OK' | 'ROOM_CREATED' | 'ROOM_STATE'
  | 'PLAYER_JOINED' | 'PLAYER_LEFT' | 'PLAYER_READY_CHANGED'
  | 'CHAT_MESSAGE' | 'CHAT_HISTORY' | 'SYSTEM_MESSAGE'
  | 'GAME_START' | 'TURN_START' | 'DICE_RESULT' | 'MOVABLE_PIECES'
  | 'MOVE_RESULT' | 'GAME_STATE' | 'PLAYER_DISCONNECTED'
  | 'PLAYER_RECONNECTED' | 'GAME_OVER' | 'ERROR' | 'PONG'
  | 'BOARD_CALIBRATION_DATA' | 'BOARD_CALIBRATION_OPEN' | 'BOARD_CALIBRATION_SAVED'
  | 'AI_TAKEOVER_CHANGED' | 'GAME_EXITED' | 'ACTIVE_GAMES';

export interface BoardPosition { x: number; y: number; }
export interface BoardCalibrationData {
  version: number;
  positions: Record<string, BoardPosition>;
  completed: string[];
  sequence: string[];
}

export interface BoardCalibrationOpen {
  key: string;
  index: number;
  total: number;
  position?: BoardPosition;
  single: boolean;
}

export interface ActiveGameSummary {
  roomId: string;
  color: PlayerColor;
  turnNumber: number;
  playerCount: number;
  status: RoomStatus;
}

export interface ClientMessage<T = Record<string, unknown>> {
  type: ClientMessageType;
  requestId: string;
  data: T;
}

export interface ServerMessage<T = unknown> {
  type: ServerMessageType;
  requestId?: string;
  data: T;
  serverTime: number;
}

export interface PlayerPublicState {
  id: string;
  nickname: string;
  avatarUrl?: string;
  color: PlayerColor;
  isBot?: boolean;
  aiControlled?: boolean;
  ready: boolean;
  connected: boolean;
}

export interface Piece {
  id: string;
  playerId: string;
  color: PlayerColor;
  state: PieceState;
  progress: number;
}

export interface GameSnapshot {
  roomId: string;
  roomStatus: RoomStatus;
  ownerId: string;
  players: PlayerPublicState[];
  currentPlayerId: string | null;
  phase: GamePhase | null;
  dice: number | null;
  pieces: Piece[];
  movablePieceIds: string[];
  rankings: string[];
  turnNumber: number;
}

export interface MoveResult {
  pieceId: string;
  fromProgress: number;
  toProgress: number;
  path: number[];
  tookOff: boolean;
  jumped: boolean;
  usedFlightPath: boolean;
  killedPieceIds: string[];
  reachedFinish: boolean;
  playerFinished: boolean;
  extraTurn: boolean;
}

export type ChatKind = 'PUBLIC' | 'PRIVATE' | 'SYSTEM';
export interface ChatEntry {
  kind: ChatKind;
  content: string;
  timestamp: number;
  senderId?: string;
  senderNickname?: string;
  recipientId?: string;
  recipientNickname?: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
}
