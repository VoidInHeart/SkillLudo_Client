import { _decorator, Component, js, sys } from 'cc';
import { BoardController } from './BoardController';
import { NetworkManager } from '../network/NetworkManager';
import type { BoardCalibrationData, BoardCalibrationOpen, ChatEntry, ErrorPayload, GameSnapshot, MoveResult, ServerMessage } from '../protocol/GameProtocol';
import { GameUI, type AccountActionData } from '../ui/GameUI';

const { ccclass, property } = _decorator;
const SESSION_KEY = 'skillLudo.sessionId';
const PLAYER_KEY = 'skillLudo.playerId';
const GUEST_KEY = 'skillLudo.guestId';
const ROOM_KEY = 'skillLudo.roomId';
const AUTO_LOGIN_COOKIE = 'skillLudo.autoLoginSession';
const AUTO_LOGIN_STORAGE_KEY = 'skillLudo.autoLoginSessionFallback';
const AUTO_LOGIN_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

/** Connect this component to the Canvas. Button click events call its public onClick* methods. */
@ccclass('GameController')
export class GameController extends Component {
  @property({ tooltip: '本地预览使用 ws://127.0.0.1:3000；发布微信小游戏前改为 wss:// 域名。' })
  public serverUrl = 'ws://127.0.0.1:3000';
  @property(BoardController) public boardController: BoardController | null = null;
  @property(GameUI) public gameUI: GameUI | null = null;

  private readonly network = new NetworkManager();
  private playerId = '';
  private playerNickname = '';
  private sessionId = '';
  private snapshot: GameSnapshot | null = null;
  private pendingAccountAuthentication = false;
  private pendingRememberLogin = false;
  private autoLoginRequested = false;

  public onLoad(): void {
    this.playerId = sys.localStorage.getItem(PLAYER_KEY) ?? '';
    this.sessionId = this.readAutoLoginSession();
    this.autoLoginRequested = !!this.sessionId;
    // Earlier builds persisted every session. Use the explicit opt-in cookie policy from now on.
    sys.localStorage.removeItem(SESSION_KEY);
    this.boardController?.node.on('piece-selected', this.onClickPiece, this);
    this.gameUI?.node.on('ui-action', this.handleUiAction, this);
    this.gameUI?.node.on('join-room', this.onClickJoinRoom, this);
    this.gameUI?.node.on('account-action', this.handleAccountAction, this);
    this.gameUI?.node.on('chat-send', this.handleChatSend, this);
    this.gameUI?.node.on('debug-roll', this.handleDebugRoll, this);
    this.boardController?.node.on('calibration-save', this.handleCalibrationSave, this);
    this.bindNetworkEvents();
  }

  public start(): void {
    this.boardController?.setBoardVisible(false);
    this.gameUI?.showAuthPage();
    this.gameUI?.showStatus('正在连接 0 号服务器…');
    this.network.connect(this.serverUrl).catch((error) => this.gameUI?.showError(error.message));
  }

  public onDestroy(): void {
    this.boardController?.node.off('piece-selected', this.onClickPiece, this);
    this.gameUI?.node.off('ui-action', this.handleUiAction, this);
    this.gameUI?.node.off('join-room', this.onClickJoinRoom, this);
    this.gameUI?.node.off('account-action', this.handleAccountAction, this);
    this.gameUI?.node.off('chat-send', this.handleChatSend, this);
    this.gameUI?.node.off('debug-roll', this.handleDebugRoll, this);
    this.boardController?.node.off('calibration-save', this.handleCalibrationSave, this);
    this.network.disconnect();
  }

  public onClickCreateRoom(): void { this.send('CREATE_ROOM', {}); }
  public onClickJoinRoom(roomId = ''): void {
    if (!/^\d{6}$/.test(roomId)) return this.gameUI?.showError('请输入六位数字房间号');
    this.send('JOIN_ROOM', { roomId });
  }
  public onClickLeaveRoom(): void {
    const roomId = this.roomId;
    if (!roomId) return;
    this.send('LEAVE_ROOM', { roomId });
    // LEAVE_ROOM deliberately has no snapshot for the leaver. Return this client
    // to the lobby immediately while the remaining members receive the update.
    this.snapshot = null;
    sys.localStorage.removeItem(ROOM_KEY);
    this.boardController?.setBoardVisible(false);
    this.gameUI?.showHome();
  }
  public onClickReady(): void { if (this.roomId) this.send('READY', { roomId: this.roomId }); }
  public onClickCancelReady(): void { if (this.roomId) this.send('CANCEL_READY', { roomId: this.roomId }); }
  public onClickStartGame(): void {
    if (!this.roomId) return;
    if (this.snapshot?.ownerId !== this.playerId) {
      this.gameUI?.showError('非房主无法开始对局');
      return;
    }
    this.send('START_GAME', { roomId: this.roomId });
  }
  public onClickRollDice(debugDice?: number): void {
    if (!this.roomId) return;
    if (debugDice !== undefined && (!Number.isInteger(debugDice) || debugDice < 1 || debugDice > 6)) return;
    this.gameUI?.setDiceRequestPending();
    this.send('ROLL_DICE', { roomId: this.roomId, ...(debugDice === undefined ? {} : { debugDice }) });
  }
  /** Supports both generated-node events (piece id first) and Cocos Button custom data. */
  public onClickPiece(pieceOrEvent: unknown, customPieceId = ''): void {
    const pieceId = typeof pieceOrEvent === 'string' ? pieceOrEvent : customPieceId;
    const snapshot = this.snapshot;
    if (!snapshot || snapshot.currentPlayerId !== this.playerId || snapshot.phase !== 'WAIT_SELECT_PIECE' || snapshot.movablePieceIds.indexOf(pieceId) < 0 || snapshot.dice === null) return;
    const preview = this.boardController?.showMovePreview(pieceId, snapshot.dice);
    if (!preview) return;
    const confirm = () => {
      const latest = this.snapshot;
      if (!latest || latest.currentPlayerId !== this.playerId || latest.phase !== 'WAIT_SELECT_PIECE' || latest.movablePieceIds.indexOf(pieceId) < 0) {
        this.boardController?.clearMovePreview();
        return;
      }
      this.boardController?.clearMovePreview();
      this.send('SELECT_PIECE', { roomId: this.roomId, pieceId });
    };
    const cancel = () => this.boardController?.clearMovePreview();
    if (this.gameUI) this.gameUI.showMoveConfirmation(preview, confirm, cancel);
    else confirm();
  }

  private handleUiAction(action: string): void {
    switch (action) {
      case 'CREATE_ROOM': this.onClickCreateRoom(); break;
      case 'JOIN_ROOM': this.gameUI?.showJoinRoomDialog(); break;
      case 'QUICK_MATCH': this.send('QUICK_MATCH', {}); break;
      case 'READY': this.onClickReady(); break;
      case 'START_GAME': this.onClickStartGame(); break;
      case 'CHAT':
      case 'GAME_CHAT': if (this.snapshot) this.gameUI?.showChatDialog(this.snapshot, this.playerId); break;
      case 'LEAVE_ROOM': this.onClickLeaveRoom(); break;
      case 'ROLL_DICE': this.onClickRollDice(); break;
      case 'DEBUG_DICE': this.gameUI?.showDebugDiceDialog(); break;
      case 'CALIBRATE': this.send('CALIBRATION_OPEN', {}); break;
      default: break;
    }
  }

  private bindNetworkEvents(): void {
    this.network.on('OPEN', () => this.authenticate());
    this.network.on('CLOSE', () => this.gameUI?.showStatus('连接已断开，正在重连…'));
    this.network.on('NETWORK_ERROR', (message) => this.showError(message));
    this.network.on('AUTH_OK', (message) => this.handleAuth(message));
    this.network.on('ROOM_CREATED', (message) => this.applySnapshot(message.data as GameSnapshot));
    this.network.on('GAME_START', (message) => this.applySnapshot(message.data as GameSnapshot));
    this.network.on('GAME_STATE', (message) => this.applySnapshot(message.data as GameSnapshot));
    this.network.on('ROOM_STATE', (message) => this.applySnapshot(message.data as GameSnapshot));
    this.network.on('DICE_RESULT', (message) => {
      const data = message.data as { playerId: string; dice: number; skipped?: boolean };
      this.gameUI?.playDiceRoll(data.dice);
      this.gameUI?.showStatus(`${data.playerId === this.playerId ? '你' : '其他玩家'} 掷出了 ${data.dice}${data.skipped ? '，无棋可走' : ''}`);
    });
    this.network.on('MOVE_RESULT', (message) => {
      this.gameUI?.closeMoveConfirmation();
      this.boardController?.clearMovePreview();
      this.boardController?.playMove(message.data as MoveResult);
    });
    this.network.on('GAME_OVER', (message) => this.applySnapshot(message.data as GameSnapshot));
    this.network.on('CHAT_HISTORY', (message) => {
      const data = message.data as { entries?: ChatEntry[] };
      this.gameUI?.setChatEntries(data.entries ?? []);
    });
    this.network.on('CHAT_MESSAGE', (message) => this.gameUI?.appendChatEntry(message.data as ChatEntry));
    this.network.on('SYSTEM_MESSAGE', (message) => this.gameUI?.appendChatEntry(message.data as ChatEntry));
    this.network.on('BOARD_CALIBRATION_DATA', (message) => {
      this.boardController?.applyCalibrationData(message.data as BoardCalibrationData);
      if (this.snapshot) this.boardController?.applySnapshot(this.snapshot);
    });
    this.network.on('BOARD_CALIBRATION_OPEN', (message) => {
      const target = message.data as BoardCalibrationOpen;
      this.gameUI?.closeChatDialog();
      this.gameUI?.showCalibrationStatus(target);
      this.boardController?.startCalibration(target);
    });
    this.network.on('BOARD_CALIBRATION_SAVED', (message) => {
      const data = message.data as { next?: BoardCalibrationOpen; complete?: boolean };
      if (data.next) {
        this.gameUI?.showCalibrationStatus(data.next);
        this.boardController?.startCalibration(data.next);
      } else {
        this.gameUI?.showCalibrationStatus(null);
        this.boardController?.stopCalibration();
        this.gameUI?.showStatus('棋盘节点校准已保存');
      }
    });
    this.network.on('ERROR', (message) => this.showError(message));
  }

  private handleAccountAction(type: 'LOGIN' | 'REGISTER', data: AccountActionData): void {
    if (!data.username || !data.password) {
      this.gameUI?.showError('请输入账号和密码');
      return;
    }
    // An account login switches identity, so do not reconnect a guest's previous room.
    this.snapshot = null;
    this.playerId = '';
    this.sessionId = '';
    sys.localStorage.removeItem(ROOM_KEY);
    sys.localStorage.removeItem(PLAYER_KEY);
    sys.localStorage.removeItem(SESSION_KEY);
    this.pendingRememberLogin = data.rememberMe;
    if (!data.rememberMe) this.clearAutoLoginSession();
    this.pendingAccountAuthentication = true;
    this.send(type, { username: data.username, password: data.password, nickname: data.nickname || undefined });
  }

  private handleChatSend(data: { content?: string; recipientId?: string }): void {
    if (!this.roomId || !data.content) return;
    this.send('CHAT_SEND', { roomId: this.roomId, content: data.content, recipientId: data.recipientId });
  }
  private handleDebugRoll(value: unknown): void {
    if (typeof value !== 'number') return;
    const snapshot = this.snapshot;
    if (!snapshot || snapshot.currentPlayerId !== this.playerId || snapshot.phase !== 'WAIT_ROLL') {
      this.gameUI?.showError('仅能在轮到你投骰子时指定点数');
      return;
    }
    this.onClickRollDice(value);
  }
  private handleCalibrationSave(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    this.send('CALIBRATION_SAVE', data as Record<string, unknown>);
  }

  private authenticate(): void {
    const guestId = sys.localStorage.getItem(GUEST_KEY) ?? this.createGuestId();
    sys.localStorage.setItem(GUEST_KEY, guestId);
    this.send('AUTH', { sessionId: this.sessionId || undefined, guestId, nickname: this.gameUI?.getNickname() || undefined });
  }

  private handleAuth(message: ServerMessage): void {
    const data = message.data as { playerId: string; sessionId: string; nickname?: string; isAdmin?: boolean };
    this.playerId = data.playerId;
    this.playerNickname = data.nickname ?? this.playerNickname;
    this.sessionId = data.sessionId;
    this.gameUI?.setAdmin(data.isAdmin === true);
    sys.localStorage.setItem(PLAYER_KEY, data.playerId);
    if (this.pendingAccountAuthentication) {
      this.pendingAccountAuthentication = false;
      if (this.pendingRememberLogin) this.writeAutoLoginSession(data.sessionId);
      else this.clearAutoLoginSession();
      this.pendingRememberLogin = false;
      this.gameUI?.setAccountProfile({ playerId: data.playerId, nickname: this.playerNickname || '玩家' });
      this.gameUI?.showHome();
      this.gameUI?.showStatus('已连接到0号服务器');
    } else if (this.autoLoginRequested) {
      this.autoLoginRequested = false;
      this.gameUI?.setAccountProfile({ playerId: data.playerId, nickname: this.playerNickname || '玩家' });
      this.gameUI?.showHome();
      this.gameUI?.showStatus('已连接到0号服务器');
    } else {
      this.gameUI?.showStatus('0号服务器已连接，请登录或注册');
    }
    const oldRoomId = sys.localStorage.getItem(ROOM_KEY);
    if (oldRoomId) this.send('RECONNECT', { roomId: oldRoomId });
  }

  private applySnapshot(snapshot: GameSnapshot): void {
    if (snapshot.phase !== 'WAIT_SELECT_PIECE' || snapshot.currentPlayerId !== this.playerId) {
      this.gameUI?.closeMoveConfirmation();
      this.boardController?.clearMovePreview();
    }
    this.snapshot = snapshot;
    sys.localStorage.setItem(ROOM_KEY, snapshot.roomId);
    const inGame = snapshot.roomStatus !== 'WAITING';
    this.boardController?.setBoardVisible(inGame);
    this.boardController?.applySnapshot(snapshot);
    this.gameUI?.render(snapshot, this.playerId);
  }

  private send(type: Parameters<NetworkManager['send']>[0], data: Record<string, unknown>): void {
    try { this.network.send(type, data); } catch (error) { this.gameUI?.showError(error instanceof Error ? error.message : '发送失败'); }
  }
  private showError(message: ServerMessage): void {
    const data = message.data as ErrorPayload;
    this.pendingAccountAuthentication = false;
    if (data.code === 'INVALID_SESSION') {
      // Guest sessions are intentionally in-memory. A local server restart should
      // transparently create a fresh guest session instead of leaving the lobby stuck.
      this.playerId = '';
      this.sessionId = '';
      this.autoLoginRequested = false;
      this.clearAutoLoginSession();
      sys.localStorage.removeItem(PLAYER_KEY);
      sys.localStorage.removeItem(SESSION_KEY);
      this.authenticate();
      return;
    }
    if (data.code === 'NOT_IN_ROOM' || data.code === 'ROOM_NOT_FOUND') {
      sys.localStorage.removeItem(ROOM_KEY);
      this.snapshot = null;
      this.boardController?.setBoardVisible(false);
      this.gameUI?.showHome();
    }
    this.gameUI?.showError(data.message || data.code || '服务器错误');
  }
  private get roomId(): string { return this.snapshot?.roomId ?? sys.localStorage.getItem(ROOM_KEY) ?? ''; }
  private createGuestId(): string { return `guest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`; }
  private readAutoLoginSession(): string {
    if (typeof document !== 'undefined') {
      const encoded = document.cookie.split('; ').find((item) => item.startsWith(`${AUTO_LOGIN_COOKIE}=`))?.slice(AUTO_LOGIN_COOKIE.length + 1);
      if (encoded) { try { return decodeURIComponent(encoded); } catch { return ''; } }
      return '';
    }
    return sys.localStorage.getItem(AUTO_LOGIN_STORAGE_KEY) ?? '';
  }
  private writeAutoLoginSession(sessionId: string): void {
    sys.localStorage.setItem(AUTO_LOGIN_STORAGE_KEY, sessionId);
    if (typeof document !== 'undefined') document.cookie = `${AUTO_LOGIN_COOKIE}=${encodeURIComponent(sessionId)}; Max-Age=${AUTO_LOGIN_LIFETIME_SECONDS}; Path=/; SameSite=Lax`;
  }
  private clearAutoLoginSession(): void {
    sys.localStorage.removeItem(AUTO_LOGIN_STORAGE_KEY);
    if (typeof document !== 'undefined') document.cookie = `${AUTO_LOGIN_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
  }
}

// See BoardController: accept the expanded script UUID served by Creator preview.
js.setClassAlias(GameController, '224e4adf-e7ea-407a-b6c3-9d1a90909b42');
