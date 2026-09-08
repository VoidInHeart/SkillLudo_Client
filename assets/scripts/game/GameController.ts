import { _decorator, Component, Game, game, js, sys } from 'cc';
import { PROTOCOL_VERSION, type DiceResult, type DieSelected, type PlayerColor } from '../protocol/GameProtocol';
import { PresentationQueue } from './PresentationQueue';
import { ResponsiveCanvas } from './ResponsiveCanvas';
import { BoardController } from './BoardController';
import { NetworkManager } from '../network/NetworkManager';
import type { ActiveGameSummary, BoardCalibrationData, BoardCalibrationOpen, ChatEntry, ErrorPayload, GameSnapshot, MoveResult, ServerMessage } from '../protocol/GameProtocol';
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

  private presentationBusy = false;
  private commandPending = false;
  private appHidden = false;
  private responsiveCanvas: ResponsiveCanvas | null = null;
  private readonly presentation = new PresentationQueue((busy) => {
    this.presentationBusy = busy;
    this.gameUI?.setPresentationBusy(busy);
    this.refreshMovable();
  }, (error) => {
    console.error('Presentation failed', error);
    this.boardController?.cancelAnimations();
    this.gameUI?.showError('画面已重新同步');
    if (this.roomId) this.send('RECONNECT', { roomId: this.roomId });
  });
  private readonly network = new NetworkManager();
  private playerId = '';
  private playerNickname = '';
  private sessionId = '';
  private snapshot: GameSnapshot | null = null;
  private pendingAccountAuthentication = false;
  private pendingRememberLogin = false;
  private autoLoginRequested = false;
  private exitedGameRoomId = '';

  public onLoad(): void {
    this.responsiveCanvas = new ResponsiveCanvas();
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
    this.gameUI?.node.on('rejoin-game', this.handleRejoinGame, this);
    this.boardController?.node.on('die-selected', this.onClickDie, this);
    this.gameUI?.node.on('color-preference', this.onColorPreference, this);
    game.on(Game.EVENT_HIDE, this.onAppHide, this);
    game.on(Game.EVENT_SHOW, this.onAppShow, this);
    this.bindNetworkEvents();
  }

  public start(): void {
    this.boardController?.setBoardVisible(false);
    this.gameUI?.showAuthPage();
    this.gameUI?.showStatus('正在连接 0 号服务器…');
    this.network.connect(this.serverUrl).catch((error) => this.gameUI?.showError(error.message));
  }

  public onDestroy(): void {
    this.responsiveCanvas?.destroy();
    this.boardController?.node.off('piece-selected', this.onClickPiece, this);
    this.gameUI?.node.off('ui-action', this.handleUiAction, this);
    this.gameUI?.node.off('join-room', this.onClickJoinRoom, this);
    this.gameUI?.node.off('account-action', this.handleAccountAction, this);
    this.gameUI?.node.off('chat-send', this.handleChatSend, this);
    this.gameUI?.node.off('debug-roll', this.handleDebugRoll, this);
    this.boardController?.node.off('calibration-save', this.handleCalibrationSave, this);
    this.gameUI?.node.off('rejoin-game', this.handleRejoinGame, this);
    this.boardController?.node.off('die-selected', this.onClickDie, this);
    this.gameUI?.node.off('color-preference', this.onColorPreference, this);
    game.off(Game.EVENT_HIDE, this.onAppHide, this);
    game.off(Game.EVENT_SHOW, this.onAppShow, this);
    this.resetPresentation();
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
    this.resetPresentation();
    this.snapshot = null;
    sys.localStorage.removeItem(ROOM_KEY);
    this.boardController?.setBoardVisible(false);
    this.gameUI?.showHome();
  }
  public onClickReady(): void { if (this.roomId) this.send(this.snapshot?.players.find((p) => p.id === this.playerId)?.ready ? 'CANCEL_READY' : 'READY', { roomId: this.roomId }); }
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
    if (!this.roomId || this.presentationBusy || this.commandPending || this.snapshot?.currentPlayerId !== this.playerId || this.snapshot.phase !== 'WAIT_ROLL') return;
    if (this.snapshot?.players.find((player) => player.id === this.playerId)?.aiControlled) return;
    if (debugDice !== undefined && (!Number.isInteger(debugDice) || debugDice < 1 || debugDice > 6)) return;
    this.commandPending = true;
    this.gameUI?.setDiceRequestPending();
    this.send('ROLL_DICE', { roomId: this.roomId, ...(debugDice === undefined ? {} : { debugDice }) });
  }
  /** Supports both generated-node events (piece id first) and Cocos Button custom data. */
  public onClickPiece(pieceOrEvent: unknown, customPieceId = ''): void {
    const pieceId = typeof pieceOrEvent === 'string' ? pieceOrEvent : customPieceId;
    const snapshot = this.snapshot;
    const localPlayer = snapshot?.players.find((player) => player.id === this.playerId);
    if (!snapshot || this.presentationBusy || this.commandPending || localPlayer?.aiControlled || snapshot.currentPlayerId !== this.playerId || snapshot.phase !== 'WAIT_SELECT_PIECE' || snapshot.movablePieceIds.indexOf(pieceId) < 0 || snapshot.dice === null) return;
    const preview = this.boardController?.showMovePreview(pieceId, snapshot.dice);
    if (!preview) return;
    const confirm = () => {
      const latest = this.snapshot;
      if (!latest || this.commandPending || this.presentationBusy || latest.rollId !== snapshot.rollId || latest.roomId !== snapshot.roomId || latest.players.find((player) => player.id === this.playerId)?.aiControlled || latest.currentPlayerId !== this.playerId || latest.phase !== 'WAIT_SELECT_PIECE' || latest.movablePieceIds.indexOf(pieceId) < 0) {
        this.boardController?.clearMovePreview();
        return;
      }
      this.boardController?.clearMovePreview();
      this.commandPending = true;
      this.gameUI?.setDiceRequestPending();
      this.send('SELECT_PIECE', { roomId: this.roomId, pieceId, rollId: latest.rollId });
    };
    const cancel = () => this.boardController?.clearMovePreview();
    if (this.gameUI) this.gameUI.showMoveConfirmation(preview, confirm, cancel);
    else confirm();
  }

  private handleUiAction(action: string): void {
    switch (action) {
      case 'CREATE_ROOM': this.onClickCreateRoom(); break;
      case 'JOIN_ROOM': this.gameUI?.showJoinRoomDialog(); break;
      case 'QUICK_MATCH': this.gameUI?.showStatus('快速匹配暂未开放'); break;
      case 'READY': this.onClickReady(); break;
      case 'START_GAME': this.onClickStartGame(); break;
      case 'CHAT':
      case 'GAME_CHAT': if (this.snapshot) this.gameUI?.showChatDialog(this.snapshot, this.playerId); break;
      case 'LEAVE_ROOM': this.onClickLeaveRoom(); break;
      case 'SELECT_DIE_0': this.onClickDie(0); break;
      case 'SELECT_DIE_1': this.onClickDie(1); break;
      case 'ROLL_DICE': this.onClickRollDice(); break;
      case 'DEBUG_DICE': this.gameUI?.showDebugDiceDialog(); break;
      case 'CALIBRATE': this.send('CALIBRATION_OPEN', {}); break;
      case 'AI_TAKEOVER': {
        const player = this.snapshot?.players.find((candidate) => candidate.id === this.playerId);
        if (player && this.roomId) this.send('SET_AI_TAKEOVER', { roomId: this.roomId, enabled: !player.aiControlled });
        break;
      }
      case 'EXIT_GAME': if (this.roomId) this.send('EXIT_GAME', { roomId: this.roomId }); break;
      default: break;
    }
  }

  private bindNetworkEvents(): void {
    this.network.on('OPEN', () => this.authenticate());
    this.network.on('CLOSE', () => { this.resetPresentation(); this.gameUI?.showStatus('连接已断开，正在重连…'); });
    this.network.on('NETWORK_ERROR', (message) => this.showError(message));
    this.network.on('AUTH_OK', (message) => this.handleAuth(message));
    this.network.on('ROOM_CREATED', (message) => { this.resetPresentation(); this.exitedGameRoomId = ''; this.queueSnapshot(message.data as GameSnapshot); });
    this.network.on('GAME_START', (message) => { this.resetPresentation(); this.exitedGameRoomId = ''; this.queueSnapshot(message.data as GameSnapshot); });
    this.network.on('GAME_STATE', (message) => this.queueSnapshot(message.data as GameSnapshot));
    this.network.on('ROOM_STATE', (message) => this.queueSnapshot(message.data as GameSnapshot));
    this.network.on('DICE_RESULT', (message) => {
      const data = message.data as DiceResult;
      this.presentation.enqueue(async () => {
        if (!this.appHidden && this.snapshot?.roomId !== this.exitedGameRoomId) await this.boardController?.playDiceRoll(data.diceChoices, data.rollId);
      });
    });
    this.network.on('DIE_SELECTED', (message) => {
      const data = message.data as DieSelected;
      this.presentation.enqueue(() => this.gameUI?.showStatus(`本回合选择 ${data.dice}${data.skipped ? '，无棋可走' : ''}`));
    });
    this.network.on('MOVE_RESULT', (message) => {
      this.presentation.enqueue(async () => {
        this.gameUI?.closeMoveConfirmation();
        this.boardController?.clearMovePreview();
        if (!this.appHidden && this.snapshot?.roomId !== this.exitedGameRoomId) await this.boardController?.playMove(message.data as MoveResult);
      });
    });
    this.network.on('GAME_OVER', (message) => this.queueSnapshot(message.data as GameSnapshot));
    this.network.on('CHAT_HISTORY', (message) => {
      const data = message.data as { entries?: ChatEntry[] };
      this.gameUI?.setChatEntries(data.entries ?? []);
    });
    this.network.on('CHAT_MESSAGE', (message) => this.gameUI?.appendChatEntry(message.data as ChatEntry));
    this.network.on('SYSTEM_MESSAGE', (message) => this.gameUI?.appendChatEntry(message.data as ChatEntry));
    this.network.on('BOARD_CALIBRATION_DATA', (message) => {
      this.boardController?.applyCalibrationData(message.data as BoardCalibrationData);
      this.presentation.enqueue(() => { if (this.snapshot) this.boardController?.applySnapshot(this.snapshot); });
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
    this.network.on('GAME_EXITED', (message) => {
      const data = message.data as { roomId?: string };
      this.exitedGameRoomId = data.roomId ?? this.roomId;
      this.resetPresentation();
      this.snapshot = null;
      sys.localStorage.removeItem(ROOM_KEY);
      this.boardController?.stopCalibration();
      this.boardController?.setBoardVisible(false);
      this.gameUI?.showCalibrationStatus(null);
      this.gameUI?.showHome();
      this.gameUI?.showStatus('已退出对局，AI正在托管');
    });
    this.network.on('ACTIVE_GAMES', (message) => {
      const data = message.data as { games?: ActiveGameSummary[] };
      this.gameUI?.setActiveGames(data.games ?? []);
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
    if (!snapshot || snapshot.players.find((player) => player.id === this.playerId)?.aiControlled || snapshot.currentPlayerId !== this.playerId || snapshot.phase !== 'WAIT_ROLL') {
      this.gameUI?.showError('仅能在轮到你投骰子时指定点数');
      return;
    }
    this.onClickRollDice(value);
  }
  private handleCalibrationSave(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    this.send('CALIBRATION_SAVE', data as Record<string, unknown>);
  }
  private handleRejoinGame(roomId: unknown): void {
    if (typeof roomId !== 'string' || !/^\d{6}$/.test(roomId)) return;
    this.exitedGameRoomId = '';
    sys.localStorage.setItem(ROOM_KEY, roomId);
    this.send('REJOIN_GAME', { roomId });
  }

  private authenticate(): void {
    const guestId = sys.localStorage.getItem(GUEST_KEY) ?? this.createGuestId();
    sys.localStorage.setItem(GUEST_KEY, guestId);
    this.send('AUTH', { sessionId: this.sessionId || undefined, guestId, nickname: this.gameUI?.getNickname() || undefined });
  }

  private handleAuth(message: ServerMessage): void {
    const data = message.data as { playerId: string; sessionId: string; nickname?: string; isAdmin?: boolean; activeGames?: ActiveGameSummary[] };
    this.playerId = data.playerId;
    this.playerNickname = data.nickname ?? this.playerNickname;
    this.sessionId = data.sessionId;
    this.gameUI?.setAdmin(data.isAdmin === true);
    this.gameUI?.setActiveGames(data.activeGames ?? []);
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
    if (snapshot.protocolVersion !== PROTOCOL_VERSION) { this.gameUI?.showError('前后端版本不一致，请更新后再进入游戏'); return; }
    this.commandPending = false;
    if (snapshot.phase !== 'WAIT_SELECT_PIECE' || snapshot.currentPlayerId !== this.playerId) {
      this.gameUI?.closeMoveConfirmation();
      this.boardController?.clearMovePreview();
    }
    this.snapshot = snapshot;
    sys.localStorage.setItem(ROOM_KEY, snapshot.roomId);
    const inGame = snapshot.roomStatus !== 'WAITING';
    this.boardController?.setBoardVisible(inGame);
    this.boardController?.setLocalColor(inGame ? snapshot.players.find((p) => p.id === this.playerId)?.color : undefined);
    this.boardController?.applySnapshot(snapshot);
    this.gameUI?.render(snapshot, this.playerId);
  }
  private applySnapshotUnlessExited(snapshot: GameSnapshot): void {
    if (snapshot.roomId === this.exitedGameRoomId) {
      const local = snapshot.players.find((player) => player.id === this.playerId);
      this.gameUI?.setActiveGames(snapshot.roomStatus === 'PLAYING' && local ? [{ roomId: snapshot.roomId, color: local.color, turnNumber: snapshot.turnNumber, playerCount: snapshot.players.length, status: snapshot.roomStatus }] : []);
      return;
    }
    this.applySnapshot(snapshot);
  }

  private queueSnapshot(snapshot: GameSnapshot): void {
    this.presentation.enqueue(() => this.applySnapshotUnlessExited(snapshot));
  }
  public onClickDie(index: number): void {
    const state = this.snapshot;
    if (!state || this.commandPending || this.presentationBusy || state.currentPlayerId !== this.playerId || state.phase !== 'WAIT_SELECT_DIE'
      || state.players.find((p) => p.id === this.playerId)?.aiControlled || (index !== 0 && index !== 1)) return;
    this.commandPending = true;
    this.gameUI?.setDiceRequestPending();
    this.send('SELECT_DIE', { roomId: state.roomId, dieIndex: index, rollId: state.rollId });
  }
  private onColorPreference(color: PlayerColor | null): void {
    if (this.snapshot?.roomStatus === 'WAITING') this.send('SET_COLOR_PREFERENCE', { roomId: this.roomId, color });
  }
  private refreshMovable(): void {
    const state = this.snapshot;
    const allowed = !this.presentationBusy && !this.commandPending && state?.currentPlayerId === this.playerId
      && !state.players.find((p) => p.id === this.playerId)?.aiControlled && state.phase === 'WAIT_SELECT_PIECE';
    this.boardController?.setMovablePieces(allowed ? state!.movablePieceIds : []);
  }
  private resetPresentation(): void {
    this.boardController?.cancelAnimations();
    this.presentation.reset();
    this.commandPending = false;
  }
  private onAppHide(): void { this.appHidden = true; this.resetPresentation(); }
  private onAppShow(): void { this.appHidden = false; this.resetPresentation(); if (this.roomId) this.send('RECONNECT', { roomId: this.roomId }); }

  private send(type: Parameters<NetworkManager['send']>[0], data: Record<string, unknown>): void {
    try { this.network.send(type, data); } catch (error) { this.commandPending = false; this.gameUI?.showError(error instanceof Error ? error.message : '发送失败'); }
  }
  private showError(message: ServerMessage): void {
    const data = message.data as ErrorPayload;
    this.pendingAccountAuthentication = false;
    this.commandPending = false;
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
