import { _decorator, Component, Game, game, js, sys } from 'cc';
import { PROTOCOL_VERSION, type DiceResult, type DieSelected, type PlayerColor } from '../protocol/GameProtocol';
import { PresentationQueue } from './PresentationQueue';
import { ResponsiveCanvas } from './ResponsiveCanvas';
import { BoardController } from './BoardController';
import { NetworkManager } from '../network/NetworkManager';
import { resolveServerUrl } from '../network/ServerEndpoint';
import { ActionSelection } from './ActionSelection';
import { getPieceCell } from './PathData';
import { FACTION_NAMES } from './SkillCatalog';
import type { SkillInput } from '../ui/SkillDialogs';
import type { LifecycleInput } from '../ui/MatchOverlays';
import type { ActiveGameSummary, BoardCalibrationData, BoardCalibrationOpen, ChatEntry, ErrorPayload, GameSnapshot, MoveResult, ServerMessage, SkillEffect } from '../protocol/GameProtocol';
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
  @property({ tooltip: '留空自动连接：公网网页使用本站，Creator 本地预览使用 81.70.145.148。可填写 ws://127.0.0.1:3000 调试本机；微信发布需填写合法 WSS 域名。' })
  public serverUrl = '';
  @property(BoardController) public boardController: BoardController | null = null;
  @property(GameUI) public gameUI: GameUI | null = null;

  private presentationBusy = false;
  private readonly selection = new ActionSelection();
  private commandPending = false;
  private skillTarget: { skillId: 'uk-sun' | 'us-bomb'; pieceIds: string[] } | null = null;
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
    this.gameUI?.setServerClock(() => this.network.serverNow());
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
    this.gameUI?.node.on('submission-send', this.handleSubmission, this);
    this.gameUI?.node.on('debug-roll', this.handleDebugRoll, this);
    this.boardController?.node.on('calibration-save', this.handleCalibrationSave, this);
    this.gameUI?.node.on('rejoin-game', this.handleRejoinGame, this);
    this.boardController?.node.on('die-selected', this.onClickDie, this);
    this.gameUI?.node.on('color-preference', this.onColorPreference, this);
    this.gameUI?.node.on('skill-input', this.handleSkillInput, this);
    this.gameUI?.node.on('lifecycle-input', this.handleLifecycleInput, this);
    this.boardController?.node.on('skill-cell-selected', this.onSkillCell, this);
    game.on(Game.EVENT_HIDE, this.onAppHide, this);
    game.on(Game.EVENT_SHOW, this.onAppShow, this);
    this.bindNetworkEvents();
  }

  public start(): void {
    this.serverUrl = resolveServerUrl(this.serverUrl, sys.isBrowser && typeof window !== 'undefined' ? window.location : undefined);
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
    this.gameUI?.node.off('submission-send', this.handleSubmission, this);
    this.gameUI?.node.off('debug-roll', this.handleDebugRoll, this);
    this.boardController?.node.off('calibration-save', this.handleCalibrationSave, this);
    this.gameUI?.node.off('rejoin-game', this.handleRejoinGame, this);
    this.boardController?.node.off('die-selected', this.onClickDie, this);
    this.gameUI?.node.off('color-preference', this.onColorPreference, this);
    this.gameUI?.node.off('skill-input', this.handleSkillInput, this);
    this.gameUI?.node.off('lifecycle-input', this.handleLifecycleInput, this);
    this.boardController?.node.off('skill-cell-selected', this.onSkillCell, this);
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
    if (!this.roomId || this.presentationBusy || this.commandPending || this.snapshot?.lifecycle?.pause || this.snapshot?.currentPlayerId !== this.playerId || this.snapshot.phase !== 'WAIT_ROLL') return;
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
    if (!snapshot || snapshot.lifecycle?.pause || this.presentationBusy || this.commandPending || localPlayer?.aiControlled || snapshot.currentPlayerId !== this.playerId) return;
    if (this.skillTarget) { this.onSkillPiece(pieceId); return; }
    if (snapshot.phase === 'WAIT_SELECT_DIE') { this.commitSelection(pieceId); return; }
    // A trustee may have reached the legacy piece phase before manual control resumed.
    if (snapshot.phase !== 'WAIT_SELECT_PIECE' || !snapshot.movablePieceIds.includes(pieceId)) return;
    this.commandPending = true;
    this.gameUI?.setDiceRequestPending();
    this.send('SELECT_PIECE', { roomId: this.roomId, pieceId, rollId: snapshot.rollId });
  }

  private commitSelection(pieceId?: string): void {
    const state = this.snapshot;
    if (!state || state.lifecycle?.pause || this.commandPending || this.presentationBusy) return;
    const option = this.selection.current(state, this.playerId);
    if (!option || (pieceId ? !option.movablePieceIds.includes(pieceId) : option.movablePieceIds.length > 0)) return;
    this.commandPending = true;
    this.gameUI?.setDiceRequestPending();
    this.send('COMMIT_MOVE', { roomId: state.roomId, rollId: state.rollId, optionId: option.id, ...(pieceId ? { pieceId } : {}) });
    this.refreshMovable();
  }

  private handleUiAction(action: string): void {
    switch (action) {
      case 'CREATE_ROOM': this.onClickCreateRoom(); break;
      case 'JOIN_ROOM': this.gameUI?.showJoinRoomDialog(); break;
      case 'QUICK_MATCH': this.gameUI?.showStatus('快速匹配暂未开放'); break;
      case 'READY': this.onClickReady(); break;
      case 'START_GAME': this.onClickStartGame(); break;
      case 'SKILLS': if (this.skillTarget) this.cancelSkillTarget(); else this.gameUI?.showSkills(true); break;
      case 'CHAT':
      case 'GAME_CHAT': if (this.snapshot) this.gameUI?.showChatDialog(this.snapshot, this.playerId); break;
      case 'LEAVE_ROOM': this.onClickLeaveRoom(); break;
      case 'SELECT_DIE_0': this.onClickDie(0); break;
      case 'SELECT_DIE_1': this.onClickDie(1); break;
      case 'ROLL_DICE': if (this.snapshot?.phase === 'WAIT_SELECT_DIE') this.commitSelection(); else this.onClickRollDice(); break;
      case 'DEBUG_DICE': this.gameUI?.showDebugDiceDialog(); break;
      case 'CALIBRATE': this.send('CALIBRATION_OPEN', {}); break;
      case 'AI_TAKEOVER': {
        const player = this.snapshot?.players.find((candidate) => candidate.id === this.playerId);
        if (player && this.roomId) this.send('SET_AI_TAKEOVER', { roomId: this.roomId, enabled: !player.aiControlled });
        break;
      }
      case 'EXIT_GAME': if (this.roomId) this.send('EXIT_GAME', { roomId: this.roomId }); break;
      case 'TECH_PAUSE': if (this.roomId) this.send('REQUEST_PAUSE', { roomId: this.roomId }); break;
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
    this.network.on('SKILL_EFFECT', (message) => {
      const effect = message.data as SkillEffect;
      this.presentation.enqueue(async () => {
        this.cancelSkillTarget();
        this.gameUI?.showStatus(effect.message);
        if (!this.appHidden && this.snapshot?.roomId !== this.exitedGameRoomId) await this.boardController?.playSkill(effect);
      });
    });
    this.network.on('GAME_OVER', (message) => this.queueSnapshot(message.data as GameSnapshot));
    this.network.on('SKILL_READY', (message) => {
      if ((message.data as { playerId: string }).playerId === this.playerId) this.gameUI?.flashSkills();
    });
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
      this.gameUI?.showStatus('已离开对局，可从未结束对局入口返回');
    });
    this.network.on('ACTIVE_GAMES', (message) => {
      const data = message.data as { games?: ActiveGameSummary[] };
      this.gameUI?.setActiveGames(data.games ?? []);
    });
    this.network.on('ERROR', (message) => this.showError(message));
    this.network.on('SUBMISSION_RESULT', (message) => {
      if (message.requestId === this.submissionRequest) {
        this.gameUI?.showSubmissionResult(message.data as { id?: string; status?: string; message: string });
      }
    });
  }

  private submissionRequest = '';
  private handleSubmission(data: Record<string, unknown>): void {
    try { this.submissionRequest = this.network.send('SUBMIT_CREATION', data); }
    catch { this.gameUI?.showSubmissionResult({ status: 'ERROR', message: '网络未连接，草稿已保留，请重连后重试' }); }
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
    this.cancelSkillTarget();
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
    this.refreshMovable();
  }
  private applySnapshotUnlessExited(snapshot: GameSnapshot): void {
    if (snapshot.roomId === this.exitedGameRoomId) {
      const local = snapshot.players.find((player) => player.id === this.playerId);
      const spectator = snapshot.spectators?.some((player) => player.id === this.playerId);
      this.gameUI?.setActiveGames(snapshot.roomStatus === 'PLAYING' && (local || spectator) ? [{ roomId: snapshot.roomId, color: local?.color, spectating: spectator, turnNumber: snapshot.turnNumber, playerCount: snapshot.players.length + (snapshot.spectators?.length ?? 0), status: snapshot.roomStatus }] : []);
      return;
    }
    this.applySnapshot(snapshot);
  }

  private queueSnapshot(snapshot: GameSnapshot): void {
    this.presentation.enqueue(() => this.applySnapshotUnlessExited(snapshot));
  }
  public onClickDie(index: number): void {
    const state = this.snapshot;
    if (!state || state.lifecycle?.pause || this.skillTarget || this.commandPending || this.presentationBusy || state.currentPlayerId !== this.playerId || state.phase !== 'WAIT_SELECT_DIE'
      || state.players.find((p) => p.id === this.playerId)?.aiControlled || (index !== 0 && index !== 1)) return;
    const option = state.actionOptions?.find((option) => option.dieIndex === index);
    if (option) this.selectOption(option.id);
  }
  public selectOption(optionId: string): void {
    if (!this.snapshot || this.snapshot.lifecycle?.pause || this.commandPending || this.presentationBusy) return;
    if (this.selection.choose(this.snapshot, this.playerId, optionId)) this.refreshMovable();
  }
  private onColorPreference(color: PlayerColor | 'SPECTATOR' | null): void {
    if (this.snapshot?.roomStatus === 'WAITING') this.send('SET_COLOR_PREFERENCE', { roomId: this.roomId, color });
  }
  private handleSkillInput(input: SkillInput): void {
    const state = this.snapshot, local = state?.players.find((p) => p.id === this.playerId);
    if (!state || state.lifecycle?.pause || !local || local.aiControlled || this.commandPending || this.presentationBusy) return;
    if (input.type === 'option') { this.selectOption(input.optionId); return; }
    if (input.type === 'target') {
      if (!state.skills.some((s) => s.playerId === this.playerId && s.skillId === input.skillId && s.available)) return;
      this.skillTarget = { skillId: input.skillId, pieceIds: [] };
      if (input.skillId === 'us-bomb') this.boardController?.showSkillCells();
      this.refreshMovable(); return;
    }
    const { type: _type, ...command } = input;
    this.cancelSkillTarget(); this.commandPending = true; this.gameUI?.setDiceRequestPending();
    this.send('USE_SKILL', { roomId: state.roomId, rollId: state.rollId, ...command });
    this.refreshMovable();
  }
  private onSkillPiece(pieceId: string): void {
    const target = this.skillTarget, state = this.snapshot;
    if (!target || target.skillId !== 'uk-sun' || !state || !this.swapTargets().includes(pieceId)) return;
    if (target.pieceIds.includes(pieceId)) target.pieceIds = target.pieceIds.filter((id) => id !== pieceId);
    else target.pieceIds.push(pieceId);
    this.refreshMovable();
    if (target.pieceIds.length !== 2) return;
    const names = target.pieceIds.map((id) => {
      const piece = state.pieces.find((p) => p.id === id)!;
      return `${FACTION_NAMES[piece.color]} ${id.split('-').pop()} 号飞机（${getPieceCell(piece)}）`;
    });
    this.gameUI?.confirmSkillTarget(`日不落帝国\n交换 ${names.join(' 与 ')}\n本局仅可发动一次`,
      { type: 'cast', skillId: 'uk-sun', targetPieceIds: [...target.pieceIds] }, () => this.cancelSkillTarget());
  }
  private onSkillCell(cell: string): void {
    if (this.skillTarget?.skillId !== 'us-bomb' || this.commandPending || this.presentationBusy) return;
    this.boardController?.showSkillCells(cell);
    this.gameUI?.confirmSkillTarget(`核弹轰炸 · 中心 ${cell}\n击落高亮的连续 5 格内所有飞机，包含己方与锁定飞机。\n本局仅可发动一次`,
      { type: 'cast', skillId: 'us-bomb', targetCell: cell }, () => this.cancelSkillTarget());
  }
  private swapTargets(): string[] { return this.snapshot?.pieces.filter((p) => !p.locked && getPieceCell(p)?.startsWith('M')).map((p) => p.id) ?? []; }
  private cancelSkillTarget(): void { this.skillTarget = null; this.boardController?.clearSkillCells(); this.gameUI?.setSkillTarget(''); this.refreshMovable(); }
  private refreshMovable(): void {
    const state = this.snapshot;
    const option = state ? this.selection.current(state, this.playerId) : null;
    const allowed = !this.presentationBusy && !this.commandPending && !state?.lifecycle?.pause && state?.currentPlayerId === this.playerId
      && !state.players.find((p) => p.id === this.playerId)?.aiControlled;
    const ids = option?.movablePieceIds ?? (state?.phase === 'WAIT_SELECT_PIECE' ? state.movablePieceIds : []);
    this.boardController?.setActionPreview(option?.movePreviews ?? state?.movePreviews ?? {});
    this.boardController?.setMovablePieces(allowed ? this.skillTarget?.skillId === 'uk-sun' ? this.swapTargets() : this.skillTarget ? [] : ids : []);
    this.gameUI?.setSelectedOption(option);
    if (this.skillTarget) this.gameUI?.setSkillTarget(this.skillTarget.skillId === 'uk-sun'
      ? `日不落帝国 · 已选择 ${this.skillTarget.pieceIds.length}/2 架\n点击公共航线上任意两架未锁定飞机` : '核弹轰炸 · 点击公共航线的一格\n可用“取消目标选择”返回');
  }
  private resetPresentation(): void {
    this.selection.clear();
    this.cancelSkillTarget();
    this.gameUI?.closeSkills();
    this.boardController?.cancelAnimations();
    this.presentation.reset();
    this.commandPending = false;
  }
  private onAppHide(): void { this.appHidden = true; this.resetPresentation(); }
  private onAppShow(): void { this.appHidden = false; this.resetPresentation(); if (this.roomId) this.send('RECONNECT', { roomId: this.roomId }); }

  private handleLifecycleInput(input: LifecycleInput): void {
    if (input.type === 'EXIT_GAME' || input.type === 'GAME_CHAT') { this.handleUiAction(input.type); return; }
    if (this.roomId && 'voteId' in input) this.send(input.type, { roomId: this.roomId, voteId: input.voteId, agree: input.agree });
  }

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
