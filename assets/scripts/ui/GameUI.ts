import { _decorator, BlockInputEvents, Button, Canvas, Color, Component, EditBox, Graphics, js, Label, Layers, Node, UITransform, Vec3, view } from 'cc';
import type { ActionOption, ChatEntry, GameSnapshot, PlayerColor, PlayerPublicState } from '../protocol/GameProtocol';
import type { ActiveGameSummary, BoardCalibrationOpen } from '../protocol/GameProtocol';

import { MatchHud } from './MatchHud';
import { SkillDialogs, type SkillInput } from './SkillDialogs';
import { FACTION_NAMES } from '../game/SkillCatalog';
import { MatchOverlays } from './MatchOverlays';

const { ccclass, property } = _decorator;
type Screen = 'HOME' | 'AUTH' | 'ROOM' | 'GAME';
const DEBUG_DICE_CODE = 'LUDO-TEST-2026';

export interface MoveConfirmation { color: PlayerColor; dice: number; description: string; }
export interface AccountActionData { username: string; password: string; nickname: string; rememberMe: boolean; }
export interface AccountProfile { playerId: string; nickname: string; }

/** Runtime UI with three deliberately separate surfaces: home, room lobby and game HUD. */
@ccclass('GameUI')
export class GameUI extends Component {
  @property(Label) public statusLabel: Label | null = null;
  @property(Label) public roomLabel: Label | null = null;
  @property(Label) public playersLabel: Label | null = null;
  @property(Label) public diceLabel: Label | null = null;
  @property(Label) public rankingsLabel: Label | null = null;
  @property(EditBox) public nicknameInput: EditBox | null = null;
  @property(Button) public rollButton: Button | null = null;
  @property(Button) public readyButton: Button | null = null;
  @property(Button) public startButton: Button | null = null;

  private matchHud: MatchHud | null = null;
  private skills: SkillDialogs | null = null;
  private overlays: MatchOverlays | null = null;
  private serverNow = () => Date.now();
  private presentationBusy = false;
  private requestPending = false;
  private preferenceLabel: Label | null = null;
  private preferenceMenu: Node | null = null;
  private preferredColor: PlayerColor | 'SPECTATOR' | null = null;
  private runtimeRoot: Node | null = null;
  private homeRoot: Node | null = null;
  private authRoot: Node | null = null;
  private authCard: Node | null = null;
  private authFormRoot: Node | null = null;
  private readonly authForms = new Map<'LOGIN' | 'REGISTER', Node>();
  private authNoticeLabel: Label | null = null;
  private readonly authTabs = new Map<'LOGIN' | 'REGISTER', Node>();
  private authMode: 'LOGIN' | 'REGISTER' = 'LOGIN';
  private rememberLogin = true;
  private homeConnectionLabel: Label | null = null;
  private homeAvatarInitial: Label | null = null;
  private accountDrawer: Node | null = null;
  private accountProfile: AccountProfile | null = null;
  private activeGamesRoot: Node | null = null;
  private activeGames: ActiveGameSummary[] = [];
  private roomRoot: Node | null = null;
  private roomTitleLabel: Label | null = null;
  private roomPlayersLabel: Label | null = null;
  private roomNoticeLabel: Label | null = null;
  private localColorLabel: Label | null = null;
  private calibrationLabel: Label | null = null;
  private isAdmin = false;
  private debugDiceEnabled = false;
  private moveConfirmModal: Node | null = null;
  private joinRoomModal: Node | null = null;
  private joinRoomNoticeLabel: Label | null = null;
  private chatModal: Node | null = null;
  private chatLinesRoot: Node | null = null;
  private chatLineNodes: Node[] = [];
  private readonly actionButtons = new Map<string, Button>();
  private chatEntries: ChatEntry[] = [];
  private currentScreen: Screen = 'HOME';
  private lastSnapshot: GameSnapshot | null = null;
  private lobbySize = { width: 0, height: 0 };
  private roomOwnerId = '';
  private localPlayerId = '';
  private readonly playerColors = new Map<string, PlayerColor>();

  public onLoad(): void {
    this.node.layer = Layers.Enum.UI_2D;
    this.installWebInputStyle();
    if (!this.statusLabel || !this.roomLabel || !this.rollButton || !this.readyButton || !this.startButton) this.buildRuntimeUi();
    this.showAuthPage();
    view.on('canvas-resize', this.scheduleResize, this);
    view.on('design-resolution-changed', this.scheduleResize, this);
    this.scheduleResize();
  }

  public showHome(): void { this.setScreen('HOME'); }
  public setActiveGames(games: ActiveGameSummary[]): void {
    this.activeGames = [...games];
    this.renderActiveGames();
  }
  public setAdmin(isAdmin: boolean): void {
    this.isAdmin = isAdmin;
    this.matchHud?.setAdmin(isAdmin);
  }
  public showCalibrationStatus(target: BoardCalibrationOpen | null): void {
    this.matchHud?.showCalibration(target ? `校准 ${target.index}/${target.total}：${target.key}` : '');
  }
  public onDestroy(): void {
    this.matchHud?.destroy(); this.skills?.destroy(); this.overlays?.destroy();
    view.off('canvas-resize', this.scheduleResize, this); view.off('design-resolution-changed', this.scheduleResize, this);
  }
  private scheduleResize(): void {
    // Wait until both the screen adapter and ResponsiveCanvas have settled.
    this.unschedule(this.resizeLobby);
    this.scheduleOnce(this.resizeLobby, 0);
  }
  private resizeLobby(): void {
    const size = view.getVisibleSize();
    if (!this.runtimeRoot || (Math.abs(size.width - this.lobbySize.width) < 0.1 && Math.abs(size.height - this.lobbySize.height) < 0.1)) return;
    const focused = this.authFormRoot?.getComponentsInChildren(EditBox).find((input) => input.isFocused())?.node.name;
    const authNotice = this.authNoticeLabel?.string ?? '';
    const connection = this.homeConnectionLabel?.string ?? '';
    this.closeAccountDrawer();
    this.preferenceMenu?.destroy(); this.preferenceMenu = null;
    // Preserve EditBox instances: Android's delayed keyboard scroll callback
    // can still run after a rotation, and must not target a destroyed input.
    for (const form of this.authForms.values()) form.removeFromParent();
    for (const root of [this.homeRoot, this.authRoot, this.roomRoot]) {
      root?.removeFromParent(); root?.destroy();
    }
    this.authTabs.clear();
    for (const action of ['QUICK_MATCH', 'CREATE_ROOM', 'JOIN_ROOM', 'READY', 'START_GAME', 'CHAT', 'LEAVE_ROOM']) {
      const button = this.actionButtons.get(action);
      button?.node.removeFromParent(); button?.node.destroy(); this.actionButtons.delete(action);
    }
    this.runtimeRoot.getComponent(UITransform)!.setContentSize(size);
    this.buildLobbyUi(size);
    this.renderAuthForm(this.authMode);
    for (const input of this.authFormRoot?.getComponentsInChildren(EditBox) ?? []) {
      if (input.node.name === focused) this.scheduleOnce(() => { if (input.isValid && input.node.activeInHierarchy) input.focus(); });
    }
    this.setText(this.authNoticeLabel, authNotice);
    this.setText(this.homeConnectionLabel, connection);
    if (this.currentScreen === 'ROOM' && this.lastSnapshot) this.renderRoom(this.lastSnapshot, this.localPlayerId);
    else this.setScreen(this.currentScreen);
  }
  public update(): void { this.skills?.update(); this.overlays?.update(); this.matchHud?.update(); }
  public setServerClock(now: () => number): void { this.serverNow = now; this.skills?.setClock(now); this.overlays?.setClock(now); }
  public flashSkills(): void { this.matchHud?.flashSkills(); }
  private matchOverlays(): MatchOverlays {
    if (!this.overlays) {
      this.overlays = new MatchOverlays(this.getRuntimeRoot(), (input) => this.node.emit('lifecycle-input', input));
      this.overlays.setClock(() => this.serverNow());
      this.overlays.setVisible(['ROOM', 'GAME'].includes(this.currentScreen));
    }
    return this.overlays;
  }
  public setPresentationBusy(busy: boolean): void { this.presentationBusy = busy; this.matchHud?.setBusy(busy); this.skills?.setBusy(busy || this.requestPending); }
  public setDiceRequestPending(): void { this.requestPending = true; this.matchHud?.requestPending(); this.skills?.setBusy(true); }
  public setSelectedOption(option: ActionOption | null): void { this.matchHud?.setSelectedOption(option); }
  public showSkills(inMatch = false): void { this.skillDialogs().openBook(inMatch); }
  public closeSkills(): void { this.skills?.close(); }
  public setSkillTarget(message: string): void { this.matchHud?.setSkillTarget(message); }
  public confirmSkillTarget(description: string, input: SkillInput, cancel: () => void): void { this.skillDialogs().confirmTarget(description, input, cancel); }
  private skillDialogs(): SkillDialogs {
    if (!this.skills) { this.skills = new SkillDialogs(this.getRuntimeRoot(), (input) => this.node.emit('skill-input', input)); this.skills.setClock(() => this.serverNow()); }
    return this.skills;
  }

  /** Updated after an account session is authenticated. The side drawer is intentionally
   * local-account based for now, leaving a stable place to attach a WeChat avatar later. */
  public setAccountProfile(profile: AccountProfile): void {
    this.accountProfile = profile;
    this.updateHomeAvatar();
  }
  /** Kept for existing scene callers; waiting rooms are rendered by render(). */
  public setGameMode(inGame: boolean): void { this.setScreen(inGame ? 'GAME' : 'HOME'); }

  public render(snapshot: GameSnapshot, localPlayerId: string): void {
    this.lastSnapshot = snapshot;
    this.requestPending = false;
    this.localPlayerId = localPlayerId;
    this.updatePlayerColors(snapshot.players);
    this.matchOverlays().render(snapshot, localPlayerId);
    if (snapshot.roomStatus === 'WAITING') { this.renderRoom(snapshot, localPlayerId); return; }
    this.setScreen('GAME');
    this.matchHud?.render(snapshot, localPlayerId);
    this.skillDialogs().setBusy(this.presentationBusy);
    this.skillDialogs().sync(snapshot, localPlayerId);
    if (snapshot.lifecycle?.pause || snapshot.phase === 'WINNER_VOTE') this.skills?.close();
  }

  public showError(message: string): void {
    this.requestPending = false;
    this.skills?.setBusy(this.presentationBusy);
    this.matchHud?.clearPending();
    if (this.currentScreen === 'ROOM') this.setText(this.roomNoticeLabel, `提示：${message}`);
    else if (this.currentScreen === 'AUTH') this.setText(this.authNoticeLabel, `提示：${message}`);
    else if (this.joinRoomModal?.isValid) this.setText(this.joinRoomNoticeLabel, `提示：${message}`);
    else if (this.currentScreen === 'HOME') this.setText(this.homeConnectionLabel, `提示：${message}`);
    else this.matchHud?.showStatus(`提示：${message}`);
  }
  public showStatus(message: string): void {
    if (this.currentScreen === 'ROOM') this.setText(this.roomNoticeLabel, message);
    else if (this.currentScreen === 'AUTH') this.setText(this.authNoticeLabel, message);
    else if (this.currentScreen === 'HOME') this.setText(this.homeConnectionLabel, message);
    else this.matchHud?.showStatus(message);
  }
  public getNickname(): string { return this.nicknameInput?.string.trim() ?? ''; }

  public setChatEntries(entries: ChatEntry[]): void { this.chatEntries = entries.slice(-80); this.renderChatEntries(); }
  public appendChatEntry(entry: ChatEntry): void {
    const last = this.chatEntries[this.chatEntries.length - 1];
    if (last && last.timestamp === entry.timestamp && last.kind === entry.kind && last.content === entry.content && last.senderId === entry.senderId) return;
    this.chatEntries.push(entry);
    if (this.chatEntries.length > 80) this.chatEntries.shift();
    this.renderChatEntries();
    this.matchOverlays().appendChat(entry);
  }

  /** A full page, not a modal: mirrors the dedicated auth-route treatment in the reference project. */
  public showAuthPage(mode: 'LOGIN' | 'REGISTER' = 'LOGIN'): void {
    this.authMode = mode;
    this.setScreen('AUTH');
    this.setText(this.authNoticeLabel, '账号数据保存在本机游戏服务器中');
    this.updateAuthTabs();
    this.renderAuthForm(mode);
  }

  /** The home page stays uncluttered; entering a friend's code happens in this focused dialog. */
  public showJoinRoomDialog(): void {
    this.closeJoinRoomDialog();
    const modal = this.createModalRoot('JoinRoomModal');
    const card = this.createCard(modal, 'JoinRoomCard', 440, 265, new Color(255, 255, 255), new Color(58, 119, 203));
    this.addLabel(card, 'JoinRoomTitle', '加入好友房间', new Vec3(0, 83, 0), 360, 34, 24, new Color(24, 70, 137));
    this.joinRoomNoticeLabel = this.addLabel(card, 'JoinRoomNotice', '输入 6 位数字房间号', new Vec3(0, 45, 0), 360, 26, 16, new Color(95, 117, 151));
    const input = this.createTextInput(card, 'JoinRoomId', new Vec3(0, -5, 0), 280, '例如：123456'); input.maxLength = 6;
    this.createModalButton(card, '取消', new Vec3(-94, -83, 0), new Color(121, 139, 164), () => this.closeJoinRoomDialog(), 118, 42, 16);
    this.createModalButton(card, '加入房间', new Vec3(94, -83, 0), new Color(38, 117, 214), () => {
      const roomId = input.string.trim();
      if (!/^\d{6}$/.test(roomId)) { this.setText(this.joinRoomNoticeLabel, '请输入 6 位数字房间号'); return; }
      this.closeJoinRoomDialog();
      this.node.emit('join-room', roomId);
    }, 118, 42, 16);
    this.joinRoomModal = modal;
  }

  public closeJoinRoomDialog(): void {
    if (this.joinRoomModal?.isValid) this.joinRoomModal.destroy();
    this.joinRoomModal = null;
    this.joinRoomNoticeLabel = null;
  }

  public showChatDialog(snapshot: GameSnapshot, localPlayerId: string): void {
    this.closeChatDialog();
    const modal = this.createModalRoot('RoomChatModal');
    const card = this.createCard(modal, 'ChatCard', 660, 560, new Color(255, 255, 255), new Color(58, 119, 203));
    this.addLabel(card, 'ChatTitle', '聊天', new Vec3(0, 235, 0), 400, 34, 25, new Color(24, 70, 137));
    const targetLabel = this.addLabel(card, 'ChatTarget', '发送至：房间广播', new Vec3(0, 190, 0), 520, 28, 17, new Color(74, 94, 120));
    let recipientId = '';
    this.createModalButton(card, '广播', new Vec3(-245, 150, 0), new Color(40, 117, 214), () => { recipientId = ''; targetLabel.string = '发送至：房间广播'; }, 92, 36, 14);
    [...snapshot.players, ...(snapshot.spectators ?? [])].filter((player) => player.id !== localPlayerId).forEach((player, index) => {
      const x = -130 + (index % 3) * 130;
      const y = 150 - Math.floor(index / 3) * 42;
      this.createModalButton(card, `私信 ${player.nickname}`, new Vec3(x, y, 0), new Color(120, 91, 177), () => { recipientId = player.id; targetLabel.string = `发送至：私信 ${player.nickname}`; }, 118, 34, 13);
    });
    const lines = new Node('ChatLines'); lines.setParent(card); lines.layer = Layers.Enum.UI_2D; lines.addComponent(UITransform).setContentSize(570, 270); lines.setPosition(0, 5, 0); this.chatLinesRoot = lines;
    const input = this.createTextInput(card, 'ChatInput', new Vec3(-65, -205, 0), 410, '输入 1–200 个字符');
    this.createModalButton(card, '发送', new Vec3(235, -205, 0), new Color(35, 145, 92), () => { const content = input.string.trim(); if (!content) return; input.string = ''; this.node.emit('chat-send', { content, recipientId: recipientId || undefined }); }, 104, 44, 16);
    this.createModalButton(card, '关闭', new Vec3(0, -255, 0), new Color(126, 139, 158), () => this.closeChatDialog(), 110, 34, 14);
    this.chatModal = modal;
    this.renderChatEntries();
  }

  public closeChatDialog(): void {
    if (this.chatModal?.isValid) this.chatModal.destroy();
    this.chatModal = null; this.chatLinesRoot = null; this.chatLineNodes = [];
  }

  /** Local-development helper. The server independently rejects forced dice in production. */
  public showDebugDiceDialog(): void {
    if (!this.debugDiceEnabled) {
      this.showDebugCodeDialog();
      return;
    }
    const modal = this.createModalRoot('DebugDiceModal');
    const card = this.createCard(modal, 'DebugDiceCard', 420, 290, new Color(255, 255, 255), new Color(203, 145, 48));
    this.addLabel(card, 'DebugDiceTitle', '指定投骰点数', new Vec3(0, 102, 0), 340, 34, 24, new Color(121, 78, 19));
    this.addLabel(card, 'DebugDiceHint', '仅用于本机开发调试', new Vec3(0, 64, 0), 340, 26, 15, new Color(122, 104, 73));
    for (let value = 1; value <= 6; value += 1) {
      const index = value - 1;
      const x = -108 + (index % 3) * 108;
      const y = 12 - Math.floor(index / 3) * 64;
      this.createModalButton(card, String(value), new Vec3(x, y, 0), new Color(202, 137, 35), () => {
        modal.destroy();
        this.node.emit('debug-roll', value);
      }, 76, 46, 20);
    }
    this.createModalButton(card, '关闭', new Vec3(0, -112, 0), new Color(126, 139, 158), () => modal.destroy(), 104, 34, 14);
  }

  private showDebugCodeDialog(): void {
    const modal = this.createModalRoot('DebugCodeModal');
    const card = this.createCard(modal, 'DebugCodeCard', 440, 265, new Color(255, 255, 255), new Color(203, 145, 48));
    this.addLabel(card, 'DebugCodeTitle', '输入调试口令', new Vec3(0, 82, 0), 360, 34, 24, new Color(121, 78, 19));
    const notice = this.addLabel(card, 'DebugCodeNotice', '验证后可自定义本次骰子点数', new Vec3(0, 44, 0), 370, 26, 16, new Color(95, 117, 151));
    const input = this.createTextInput(card, 'DebugCodeInput', new Vec3(0, -5, 0), 300, '输入调试口令');
    this.createModalButton(card, '取消', new Vec3(-94, -84, 0), new Color(121, 139, 164), () => modal.destroy(), 118, 42, 16);
    this.createModalButton(card, '验证', new Vec3(94, -84, 0), new Color(202, 137, 35), () => {
      if (input.string.trim().toUpperCase() !== DEBUG_DICE_CODE) {
        notice.string = '口令不正确，请重试';
        return;
      }
      this.debugDiceEnabled = true;
      this.updateDebugDiceButton();
      modal.destroy();
      this.showStatus('已启用指定点数调试');
      this.showDebugDiceDialog();
    }, 118, 42, 16);
  }

  /** Second-step confirmation protects against accidental plane clicks. */
  public showMoveConfirmation(preview: MoveConfirmation, onConfirm: () => void, onCancel: () => void): void {
    this.closeMoveConfirmation();
    const modal = this.createModalRoot('MoveConfirmModal');
    const card = this.createCard(modal, 'ConfirmCard', 420, 250, new Color(255, 255, 255), new Color(47, 108, 196));
    this.addLabel(card, 'ConfirmTitle', '确认移动飞机？', new Vec3(0, 75, 0), 360, 34, 25, new Color(28, 64, 120));
    const colorName = ({ RED: '红色', YELLOW: '黄色', BLUE: '蓝色', GREEN: '绿色' } as Record<PlayerColor, string>)[preview.color];
    this.addLabel(card, 'ConfirmDetail', `${colorName}飞机 · 骰子 ${preview.dice}\n${preview.description}\n已高亮显示目标位置`, new Vec3(0, 15, 0), 360, 100, 19, new Color(43, 57, 79));
    this.createModalButton(card, '取消', new Vec3(-100, -75, 0), new Color(125, 139, 158), () => { this.closeMoveConfirmation(); onCancel(); });
    this.createModalButton(card, '确认移动', new Vec3(100, -75, 0), new Color(36, 130, 80), () => { this.closeMoveConfirmation(); onConfirm(); });
    this.moveConfirmModal = modal;
  }
  public closeMoveConfirmation(): void { if (this.moveConfirmModal?.isValid) this.moveConfirmModal.destroy(); this.moveConfirmModal = null; }

  private renderRoom(snapshot: GameSnapshot, localPlayerId: string): void {
    this.setScreen('ROOM');
    this.updatePlayerColors(snapshot.players);
    this.roomOwnerId = snapshot.ownerId;
    this.setText(this.roomTitleLabel, `房间 ${snapshot.roomId} · ${snapshot.players.length + (snapshot.spectators?.length ?? 0)}/6`);
    const isOwner = snapshot.ownerId === localPlayerId;
    const canStart = isOwner && snapshot.players.length >= 2 && snapshot.players.every((player) => player.ready);
    this.setText(this.roomPlayersLabel, snapshot.players.map((player, index) => `${index + 1}. ${player.nickname}${player.id === snapshot.ownerId ? ' · 房主' : ''}　期望：${player.preferredColor ? this.colorName(player.preferredColor) : '不限'}　${player.ready ? '已准备' : '未准备'}`)
      .concat((snapshot.spectators ?? []).map((p) => `观战 · ${p.nickname}${p.id === snapshot.ownerId ? ' · 房主' : ''}`)).join('\n'));
    this.setText(this.roomNoticeLabel, isOwner ? (canStart ? '全部准备完成，可以开始对局' : '等待至少一位玩家加入并全部准备') : '等待房主开始对局');
    if (this.readyButton) this.readyButton.interactable = !!snapshot.players.find((player) => player.id === localPlayerId);
    if (this.startButton) this.startButton.interactable = canStart;
    this.updateStartButtonAppearance(canStart);
    const local = snapshot.players.find((player) => player.id === localPlayerId);
    this.updateActionButtonTitle('READY', local?.ready ? '取消准备' : '准备');
    this.preferredColor = snapshot.spectators?.some((p) => p.id === localPlayerId) ? 'SPECTATOR' : local?.preferredColor ?? null;
    this.setText(this.preferenceLabel, `期望阵营：${this.preferredColor === 'SPECTATOR' ? '观战' : this.preferredColor ? this.colorName(this.preferredColor) : '不限'}　▾`);
    if (!local) this.setText(this.roomNoticeLabel, '观战席：可聊天，无需准备；房主仍可开始游戏');
  }

  private setScreen(screen: Screen): void {
    if (screen !== this.currentScreen) this.skills?.close();
    if (screen !== 'ROOM') { this.preferenceMenu?.destroy(); this.preferenceMenu = null; }
    this.currentScreen = screen;
    this.overlays?.setVisible(screen === 'ROOM' || screen === 'GAME');
    this.matchHud?.setVisible(screen === 'GAME');
    if (screen !== 'HOME') this.closeAccountDrawer();
    const home = screen === 'HOME'; const auth = screen === 'AUTH'; const room = screen === 'ROOM'; const game = screen === 'GAME';
    if (this.homeRoot) this.homeRoot.active = home;
    if (this.authRoot) this.authRoot.active = auth;
    if (this.roomRoot) this.roomRoot.active = room;
    ['CREATE_ROOM', 'JOIN_ROOM', 'QUICK_MATCH'].forEach((action) => this.setActionVisible(action, home));
    ['READY', 'START_GAME', 'CHAT', 'LEAVE_ROOM'].forEach((action) => this.setActionVisible(action, room));
    this.setActionVisible('GAME_CHAT', game);
    this.setActionVisible('ROLL_DICE', game);
    this.setActionVisible('DEBUG_DICE', game);
    this.setActionVisible('CALIBRATE', game && this.isAdmin);
    this.setActionVisible('AI_TAKEOVER', game);
    this.setActionVisible('EXIT_GAME', game);
    if (this.statusLabel) this.statusLabel.node.active = game;
    if (this.homeConnectionLabel) this.homeConnectionLabel.node.active = home;
    if (this.roomLabel) this.roomLabel.node.active = game;
    if (this.localColorLabel) this.localColorLabel.node.active = game;
    if (this.playersLabel) this.playersLabel.node.active = game;
    if (this.diceLabel) this.diceLabel.node.active = game;
    if (this.rankingsLabel) this.rankingsLabel.node.active = game;
    if (this.calibrationLabel) this.calibrationLabel.node.active = game && !!this.calibrationLabel.string;

  }

  private buildRuntimeUi(): void {
    const size = view.getVisibleSize();
    this.buildLobbyUi(size);
    this.matchHud = new MatchHud(this.getRuntimeRoot(), (action) => this.node.emit('ui-action', action));
    this.showStatus('连接游戏服务器中…');
  }

  private buildLobbyUi(size: { width: number; height: number }): void {
    this.lobbySize = { width: size.width, height: size.height };
    const home = this.getHomeLayout(size);
    const room = this.getRoomLayout(size);
    this.createHomeVisual(size); this.createAuthVisual(size); this.createRoomVisual(size);
    this.createActionButton('匹配未开放', 'QUICK_MATCH', new Vec3(0, home.quickY, 0), false, new Color(132, 144, 159), home.quickWidth, home.buttonHeight, home.buttonFont);
    this.createActionButton('创建房间', 'CREATE_ROOM', new Vec3(-home.columnX, home.actionY, 0), true, new Color(40, 117, 214), home.buttonWidth, home.buttonHeight, home.buttonFont);
    this.createActionButton('加入房间', 'JOIN_ROOM', new Vec3(home.columnX, home.actionY, 0), true, new Color(56, 117, 198), home.buttonWidth, home.buttonHeight, home.buttonFont);
    this.readyButton = this.createActionButton('准备', 'READY', new Vec3(-room.columnX, room.firstRowY, 0), false, new Color(40, 117, 214), room.buttonWidth, room.buttonHeight, room.buttonFont);
    this.startButton = this.createActionButton('开始对局', 'START_GAME', new Vec3(room.columnX, room.firstRowY, 0), false, new Color(35, 145, 92), room.buttonWidth, room.buttonHeight, room.buttonFont);
    // Keep the two room-action rows on the exact same two-column grid.
    this.createActionButton('聊天', 'CHAT', new Vec3(-room.columnX, room.secondRowY, 0), true, new Color(120, 91, 177), room.buttonWidth, room.buttonHeight, room.buttonFont);
    this.createActionButton('离开房间', 'LEAVE_ROOM', new Vec3(room.columnX, room.secondRowY, 0), true, new Color(135, 83, 86), room.buttonWidth, room.buttonHeight, room.buttonFont);
  }

  private createHomeVisual(size: { width: number; height: number }): void {
    const layout = this.getHomeLayout(size);
    const root = new Node('NationalLudoHome'); root.setParent(this.getRuntimeRoot()); root.layer = Layers.Enum.UI_2D; root.addComponent(UITransform).setContentSize(size.width, size.height);
    const graphics = root.addComponent(Graphics);
    graphics.fillColor = new Color(8, 31, 74, 255); graphics.rect(-size.width / 2, -size.height / 2, size.width, size.height); graphics.fill();
    graphics.fillColor = new Color(20, 74, 145, 255); graphics.circle(-size.width * 0.34, size.height * 0.42, size.width * 0.46); graphics.fill();
    graphics.fillColor = new Color(15, 56, 116, 255); graphics.circle(size.width * 0.37, -size.height * 0.35, size.width * 0.52); graphics.fill();
    this.drawCloud(graphics, -size.width * 0.37, size.height * 0.1, layout.portrait ? 1.45 : 1.15); this.drawCloud(graphics, size.width * 0.34, -size.height * 0.07, layout.portrait ? 1.05 : 0.82);
    if (!layout.compact) {
      const colours = [new Color(232, 73, 73), new Color(241, 190, 55), new Color(65, 142, 234), new Color(78, 177, 94)];
      const dotScale = layout.portrait ? 1.25 : 1;
      [[-72, 0], [0, 72], [72, 0], [0, -72]].forEach((point, index) => { graphics.fillColor = colours[index]; graphics.circle(point[0] * dotScale, layout.planeY + point[1] * dotScale, 34 * dotScale); graphics.fill(); });
      graphics.fillColor = Color.WHITE; graphics.circle(0, layout.planeY, 31 * dotScale); graphics.fill(); graphics.fillColor = new Color(16, 70, 142); graphics.moveTo(0, layout.planeY + 26 * dotScale); graphics.lineTo(-15 * dotScale, layout.planeY - 4 * dotScale); graphics.lineTo(0, layout.planeY - 30 * dotScale); graphics.lineTo(15 * dotScale, layout.planeY - 4 * dotScale); graphics.close(); graphics.fill();
    }
    graphics.fillColor = new Color(255, 255, 255, 246); graphics.roundRect(-layout.cardWidth / 2, layout.cardBottom, layout.cardWidth, layout.cardHeight, layout.portrait ? 32 : 26); graphics.fill(); graphics.strokeColor = new Color(142, 194, 244); graphics.lineWidth = layout.portrait ? 3 : 2; graphics.roundRect(-layout.cardWidth / 2, layout.cardBottom, layout.cardWidth, layout.cardHeight, layout.portrait ? 32 : 26); graphics.stroke();
    this.addLabel(root, 'NationalLudoTitle', '国家版飞行棋', new Vec3(0, layout.titleY, 0), 720, 62, layout.portrait ? 52 : 46, Color.WHITE);
    this.addLabel(root, 'NationalLudoSubtitle', '四人联机 · 双骰战术', new Vec3(0, layout.subtitleY, 0), 520, 30, layout.portrait ? 22 : 20, new Color(205, 230, 255));
    this.addLabel(root, 'LobbyHeading', '选择你的航程', new Vec3(0, layout.headingY, 0), 420, 38, layout.portrait ? 29 : 24, new Color(22, 75, 145));
    this.homeConnectionLabel = this.addLabel(root, 'HomeConnection', '连接游戏服务器中…', new Vec3(0, layout.connectionY, 0), 500, 28, layout.portrait ? 18 : 15, new Color(66, 131, 101));
    this.addLabel(root, 'RoomHint', '创建房间，邀请朋友一起起飞', new Vec3(0, layout.hintY, 0), 500, 28, layout.portrait ? 17 : 15, new Color(106, 126, 155));
    this.createHomeAvatar(root, size);
    this.createModalButton(root, '技能图鉴', new Vec3(size.width / 2 - 90, size.height / 2 - 42), new Color('#287bc0'), () => this.showSkills(), 136, 40, 18);
    const activeGames = new Node('ActiveGames'); activeGames.setParent(root); activeGames.layer = Layers.Enum.UI_2D; activeGames.addComponent(UITransform).setContentSize(330, 126);
    activeGames.setPosition(size.width / 2 - 190, size.height / 2 - 145, 0); this.activeGamesRoot = activeGames; this.renderActiveGames();
    root.setSiblingIndex(0); this.homeRoot = root;
  }

  private createAuthVisual(size: { width: number; height: number }): void {
    const compact = size.height < 600;
    const portrait = size.height > size.width;
    const root = new Node('NationalLudoAccountPage'); root.setParent(this.getRuntimeRoot()); root.layer = Layers.Enum.UI_2D; root.addComponent(UITransform).setContentSize(size.width, size.height);
    const graphics = root.addComponent(Graphics);
    graphics.fillColor = new Color(11, 30, 66, 255); graphics.rect(-size.width / 2, -size.height / 2, size.width, size.height); graphics.fill();
    graphics.fillColor = new Color(36, 89, 165, 255); graphics.circle(-size.width * 0.32, size.height * 0.42, size.width * 0.47); graphics.fill();
    graphics.fillColor = new Color(39, 65, 126, 255); graphics.circle(size.width * 0.42, -size.height * 0.28, size.width * 0.5); graphics.fill();
    this.drawCloud(graphics, -size.width * 0.33, -35, 1.2); this.drawCloud(graphics, size.width * 0.27, 125, 0.8);
    const card = this.createCard(root, 'AccountPageCard', portrait ? Math.min(size.width * 0.92, 660) : 560, portrait ? Math.min(size.height * 0.68, 820) : compact ? 416 : 500, new Color(250, 252, 255, 250), new Color(137, 187, 242));
    this.addLabel(card, 'AuthBrand', '国家版飞行棋', new Vec3(0, compact ? 167 : 205, 0), 440, 38, 28, new Color(24, 73, 144));
    this.addLabel(card, 'AuthSubtitle', '账号中心', new Vec3(0, compact ? 132 : 162, 0), 430, 28, 18, new Color(93, 117, 151));
    this.authNoticeLabel = this.addLabel(card, 'AuthNotice', '', new Vec3(0, compact ? 101 : 128, 0), 470, 30, 15, new Color(98, 115, 140));
    this.createAuthTab(card, 'LOGIN', '登录', new Vec3(-58, compact ? 65 : 86, 0));
    this.createAuthTab(card, 'REGISTER', '注册', new Vec3(58, compact ? 65 : 86, 0));
    this.authRoot = root; this.authCard = card;
    for (const form of this.authForms.values()) form.setParent(card);
    this.createModalButton(root, '技能图鉴', new Vec3(size.width / 2 - 90, size.height / 2 - 42), new Color('#287bc0'), () => this.showSkills(), 136, 40, 18);
    this.updateAuthTabs();
    root.setSiblingIndex(0);
  }

  private renderAuthForm(mode: 'LOGIN' | 'REGISTER'): void {
    const card = this.authCard;
    if (!card) return;
    for (const [formMode, form] of this.authForms) {
      if (formMode !== mode) for (const input of form.getComponentsInChildren(EditBox)) if (input.isFocused()) input.blur();
      form.active = formMode === mode;
      form.getChildByName('RememberLoginToggle')?.emit('remember-changed');
    }
    const compact = view.getVisibleSize().height < 600;
    const existing = this.authForms.get(mode);
    if (existing) {
      this.authFormRoot = existing;
      const positions: Record<string, number> = mode === 'LOGIN'
        ? { LoginUsername: compact ? 17 : 28, LoginPassword: compact ? -40 : -32, RememberLoginToggle: compact ? -78 : -74, 登录账号Button: compact ? -132 : -124 }
        : { RegisterUsername: compact ? 17 : 31, RegisterPassword: compact ? -40 : -26, RegisterNickname: compact ? -97 : -83, RememberLoginToggle: compact ? -130 : -125, 创建账号Button: compact ? -168 : -170 };
      for (const [name, y] of Object.entries(positions)) existing.getChildByName(name)?.setPosition(0, y);
      return;
    }
    const form = new Node(`AuthForm${mode}`); form.setParent(card); form.layer = Layers.Enum.UI_2D; form.addComponent(UITransform).setContentSize(500, 260);
    this.authForms.set(mode, form); this.authFormRoot = form;
    const fieldWidth = 370;
    const submit = (type: 'LOGIN' | 'REGISTER', username: EditBox, password: EditBox, nickname?: EditBox): void => {
      const data: AccountActionData = { username: username.string.trim(), password: password.string, nickname: nickname?.string.trim() ?? '', rememberMe: this.rememberLogin };
      this.setText(this.authNoticeLabel, type === 'LOGIN' ? '正在验证账号…' : '正在创建账号…');
      this.node.emit('account-action', type, data);
    };
    if (mode === 'LOGIN') {
      const username = this.createTextInput(form, 'LoginUsername', new Vec3(0, compact ? 17 : 28, 0), fieldWidth, '账号');
      const password = this.createTextInput(form, 'LoginPassword', new Vec3(0, compact ? -40 : -32, 0), fieldWidth, '密码', true);
      this.createRememberToggle(form, new Vec3(0, compact ? -78 : -74, 0));
      this.createModalButton(form, '登录账号', new Vec3(0, compact ? -132 : -124, 0), new Color(27, 103, 193), () => submit('LOGIN', username, password), 220, 48, 18);
      return;
    }
    const username = this.createTextInput(form, 'RegisterUsername', new Vec3(0, compact ? 17 : 31, 0), fieldWidth, '账号：3–32 位字母、数字或下划线');
    const password = this.createTextInput(form, 'RegisterPassword', new Vec3(0, compact ? -40 : -26, 0), fieldWidth, '密码：至少 8 位', true);
    const nickname = this.createTextInput(form, 'RegisterNickname', new Vec3(0, compact ? -97 : -83, 0), fieldWidth, '昵称（可选，最多 20 字）');
    this.createRememberToggle(form, new Vec3(0, compact ? -130 : -125, 0));
    this.createModalButton(form, '创建账号', new Vec3(0, compact ? -168 : -170, 0), new Color(47, 139, 90), () => submit('REGISTER', username, password, nickname), 220, 48, 18);
  }

  private createRoomVisual(size: { width: number; height: number }): void {
    const layout = this.getRoomLayout(size);
    const root = new Node('LudoRoomLobby'); root.setParent(this.getRuntimeRoot()); root.layer = Layers.Enum.UI_2D; root.addComponent(UITransform).setContentSize(size.width, size.height);
    const graphics = root.addComponent(Graphics); graphics.fillColor = new Color(8, 31, 74, 255); graphics.rect(-size.width / 2, -size.height / 2, size.width, size.height); graphics.fill(); graphics.fillColor = new Color(24, 74, 145, 255); graphics.circle(-size.width * 0.4, size.height * 0.4, size.width * 0.45); graphics.fill(); graphics.fillColor = new Color(255, 255, 255, 250); graphics.roundRect(-layout.cardWidth / 2, layout.cardBottom, layout.cardWidth, layout.cardHeight, layout.portrait ? 32 : 28); graphics.fill(); graphics.strokeColor = new Color(126, 187, 245, 255); graphics.lineWidth = 3; graphics.roundRect(-layout.cardWidth / 2, layout.cardBottom, layout.cardWidth, layout.cardHeight, layout.portrait ? 32 : 28); graphics.stroke();
    this.roomTitleLabel = this.addLabel(root, 'RoomTitle', '', new Vec3(0, layout.titleY, 0), 620, 44, layout.portrait ? 34 : 30, new Color(22, 75, 145));
    this.addLabel(root, 'RoomPlayersHeading', '机组成员', new Vec3(0, layout.playersHeadingY, 0), 500, 34, layout.portrait ? 24 : 21, new Color(55, 81, 119));
    this.roomPlayersLabel = this.addLabel(root, 'RoomPlayers', '', new Vec3(0, layout.playersY + 12, 0), 640, layout.portrait ? 154 : 130, layout.portrait ? 18 : 15, new Color(37, 57, 85));
    this.roomPlayersLabel.overflow = Label.Overflow.SHRINK;
    this.roomNoticeLabel = this.addLabel(root, 'RoomNotice', '', new Vec3(0, layout.noticeY, 0), 600, 36, layout.portrait ? 19 : 17, new Color(76, 105, 140));
    const pickerY = layout.portrait ? layout.noticeY + 54 : view.getVisibleSize().height < 600 ? -47 : -44;
    this.createModalButton(root, 'PreferenceDropdown', new Vec3(0, pickerY), new Color('#dfe9f2'), () => this.togglePreferenceMenu(root, pickerY), 260, 38, 15);
    this.preferenceLabel = root.getChildByName('PreferenceDropdownButton')!.getComponentInChildren(Label)!;
    this.preferenceLabel.color = new Color('#354d68');
    this.preferenceLabel.string = '期望阵营：不限　▾';
    this.addLabel(root, 'RoomChatHint', '同色意愿抽签决定；调整意愿后请重新准备', new Vec3(0, layout.hintY, 0), 600, 24, 13, new Color(106, 126, 148));
    root.setSiblingIndex(0); this.roomRoot = root;
  }

  private togglePreferenceMenu(parent: Node, y: number): void {
    if (this.preferenceMenu?.isValid) { this.preferenceMenu.destroy(); this.preferenceMenu = null; return; }
    const overlay = new Node('PreferenceOverlay'); overlay.setParent(this.getRuntimeRoot()); overlay.layer = Layers.Enum.UI_2D;
    overlay.addComponent(UITransform).setContentSize(view.getVisibleSize()); overlay.addComponent(BlockInputEvents);
    overlay.on(Node.EventType.TOUCH_END, () => { this.preferenceMenu?.destroy(); this.preferenceMenu = null; });
    const menu = this.createCard(overlay, 'PreferenceMenu', 260, 244, new Color('#edf4fa'), new Color('#aac6df'));
    menu.setPosition(0, Math.max(-view.getVisibleSize().height / 2 + 130, y - 145));
    this.preferenceMenu = overlay;
    const preferences: Array<PlayerColor | 'SPECTATOR' | null> = [null, 'RED', 'YELLOW', 'BLUE', 'GREEN', 'SPECTATOR'];
    preferences.forEach((color, index) => {
      this.createModalButton(menu, color === 'SPECTATOR' ? '观战（最多 2 人）' : color ? this.colorName(color) : '不限', new Vec3(0, 100 - index * 40),
        new Color(color === this.preferredColor ? '#287bc0' : '#547797'), () => {
          this.preferenceMenu?.destroy(); this.preferenceMenu = null; this.node.emit('color-preference', color);
        }, 246, 36, 16);
    });
  }

  /** Keep the home-card proportions intentional on both the original desktop
   * canvas and a tall phone canvas, instead of shrinking the desktop mockup. */
  private getHomeLayout(size: { width: number; height: number }): {
    compact: boolean; portrait: boolean; cardWidth: number; cardHeight: number; cardBottom: number;
    titleY: number; subtitleY: number; planeY: number; headingY: number; connectionY: number; hintY: number;
    quickY: number; actionY: number; quickWidth: number; buttonWidth: number; buttonHeight: number; buttonFont: number; columnX: number;
  } {
    const portrait = size.height > size.width;
    const compact = !portrait && size.height < 600;
    if (portrait) {
      const cardHeight = Math.min(size.height * 0.6, 760);
      const cardBottom = -size.height / 2 + 28;
      const cardCenter = cardBottom + cardHeight / 2;
      return {
        compact, portrait, cardWidth: Math.min(size.width * 0.92, 660), cardHeight, cardBottom,
        titleY: size.height * 0.35, subtitleY: size.height * 0.295, planeY: size.height * 0.18,
        headingY: cardCenter + cardHeight * 0.32, connectionY: cardCenter + cardHeight * 0.22, hintY: cardCenter + cardHeight * 0.13,
        quickY: cardCenter - cardHeight * 0.04, actionY: cardCenter - cardHeight * 0.17,
        quickWidth: Math.min(size.width * 0.48, 320), buttonWidth: Math.min(size.width * 0.39, 260), buttonHeight: 62, buttonFont: 21, columnX: size.width * 0.22,
      };
    }
    return {
      compact, portrait, cardWidth: 580, cardHeight: compact ? 326 : 340, cardBottom: compact ? -198 : -275,
      titleY: compact ? 180 : 242, subtitleY: compact ? 146 : 195, planeY: 125,
      headingY: compact ? 89 : 48, connectionY: compact ? 57 : 16, hintY: compact ? 30 : -15,
      quickY: compact ? -18 : -86, actionY: compact ? -78 : -146,
      quickWidth: 150, buttonWidth: 150, buttonHeight: compact ? 46 : 46, buttonFont: 16, columnX: 92,
    };
  }

  private getRoomLayout(size: { width: number; height: number }): {
    portrait: boolean; cardWidth: number; cardHeight: number; cardBottom: number;
    titleY: number; playersHeadingY: number; playersY: number; noticeY: number; hintY: number;
    firstRowY: number; secondRowY: number; columnX: number; buttonWidth: number; buttonHeight: number; buttonFont: number;
  } {
    const portrait = size.height > size.width;
    if (portrait) {
      const cardHeight = Math.min(size.height * 0.78, 980);
      const cardBottom = -size.height / 2 + 28;
      const cardCenter = cardBottom + cardHeight / 2;
      return {
        portrait, cardWidth: Math.min(size.width * 0.94, 680), cardHeight, cardBottom,
        titleY: cardCenter + cardHeight * 0.37, playersHeadingY: cardCenter + cardHeight * 0.27, playersY: cardCenter + cardHeight * 0.09,
        noticeY: cardCenter - cardHeight * 0.15, hintY: cardCenter - cardHeight * 0.21,
        firstRowY: cardCenter - cardHeight * 0.3, secondRowY: cardCenter - cardHeight * 0.4,
        columnX: size.width * 0.22, buttonWidth: Math.min(size.width * 0.39, 260), buttonHeight: 62, buttonFont: 21,
      };
    }
    const compact = size.height < 600;
    return {
      portrait, cardWidth: 690, cardHeight: compact ? 390 : 550, cardBottom: compact ? -195 : -275,
      titleY: compact ? 150 : 220, playersHeadingY: compact ? 106 : 160, playersY: compact ? 25 : 65,
      noticeY: compact ? -75 : -95, hintY: compact ? -108 : -135,
      firstRowY: compact ? -122 : -175, secondRowY: compact ? -177 : -238,
      columnX: 105, buttonWidth: 150, buttonHeight: 52, buttonFont: 18,
    };
  }

  private createHomeAvatar(parent: Node, size: { width: number; height: number }): void {
    const portrait = size.height > size.width;
    const diameter = portrait ? 74 : 62;
    const node = new Node('AccountAvatar'); node.setParent(parent); node.layer = Layers.Enum.UI_2D; node.addComponent(UITransform).setContentSize(diameter, diameter);
    node.setPosition(size.width / 2 - diameter / 2 - (portrait ? 24 : 32), size.height / 2 - diameter / 2 - (portrait ? 26 : 28), 0);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(247, 251, 255, 255); graphics.circle(0, 0, diameter / 2); graphics.fill();
    graphics.strokeColor = new Color(125, 194, 255); graphics.lineWidth = 3; graphics.circle(0, 0, diameter / 2 - 1.5); graphics.stroke();
    graphics.fillColor = new Color(35, 113, 205); graphics.circle(0, 0, diameter / 2 - 7); graphics.fill();
    this.homeAvatarInitial = this.addLabel(node, 'AccountAvatarInitial', '我', Vec3.ZERO, diameter - 10, diameter - 10, portrait ? 28 : 23, Color.WHITE);
    node.on(Node.EventType.TOUCH_END, () => this.showAccountDrawer());
    this.updateHomeAvatar();
  }

  private updateHomeAvatar(): void {
    if (!this.homeAvatarInitial) return;
    const nickname = this.accountProfile?.nickname.trim() || '我';
    this.homeAvatarInitial.string = nickname.slice(0, 1).toUpperCase();
  }

  private renderActiveGames(): void {
    const root = this.activeGamesRoot;
    if (!root) return;
    root.children.slice().forEach((child) => { child.removeFromParent(); child.destroy(); });
    root.active = this.activeGames.length > 0;
    if (!root.active) return;
    const graphics = root.getComponent(Graphics) ?? root.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = new Color(245, 249, 255, 245);
    graphics.roundRect(-165, -63, 330, 126, 14);
    graphics.fill();
    graphics.strokeColor = new Color(126, 187, 245);
    graphics.lineWidth = 2;
    graphics.roundRect(-165, -63, 330, 126, 14);
    graphics.stroke();
    this.addLabel(root, 'ActiveGameTitle', '未结束的对局', new Vec3(0, 38, 0), 300, 26, 18, new Color(24, 70, 137));
    const game = this.activeGames[0];
    this.addLabel(root, 'ActiveGameInfo', `房间 ${game.roomId} · ${game.spectating || !game.color ? '观战' : this.colorName(game.color)} · 第${game.turnNumber}回合`, new Vec3(-35, 4, 0), 235, 28, 14, new Color(58, 79, 108));
    this.createModalButton(root, '重连入局', new Vec3(92, -31, 0), new Color(40, 117, 214), () => this.node.emit('rejoin-game', game.roomId), 112, 34, 14);
  }

  private showAccountDrawer(): void {
    if (!this.accountProfile) return;
    this.closeAccountDrawer();
    const size = view.getVisibleSize();
    const portrait = size.height > size.width;
    const modal = this.createModalRoot('AccountDrawer');
    const width = portrait ? Math.min(size.width * 0.8, 570) : 390;
    const height = portrait ? size.height - 58 : Math.min(size.height - 48, 580);
    const drawer = this.createCard(modal, 'AccountDrawerPanel', width, height, new Color(250, 252, 255, 255), new Color(126, 187, 245));
    drawer.setPosition(size.width / 2 - width / 2 - 18, 0, 0);
    const avatar = new Node('ProfileAvatar'); avatar.setParent(drawer); avatar.layer = Layers.Enum.UI_2D; avatar.addComponent(UITransform).setContentSize(100, 100); avatar.setPosition(0, height / 2 - 105, 0);
    const graphics = avatar.addComponent(Graphics); graphics.fillColor = new Color(41, 118, 211); graphics.circle(0, 0, 48); graphics.fill(); graphics.strokeColor = new Color(175, 219, 255); graphics.lineWidth = 3; graphics.circle(0, 0, 47); graphics.stroke();
    this.addLabel(avatar, 'ProfileAvatarInitial', (this.accountProfile.nickname.trim() || '我').slice(0, 1).toUpperCase(), Vec3.ZERO, 86, 86, 38, Color.WHITE);
    const top = height / 2;
    const textColor = new Color(59, 82, 116);
    this.addLabel(drawer, 'ProfileTitle', '账号详情', new Vec3(0, top - 190, 0), width - 44, 36, 27, new Color(23, 71, 140));
    const accountId = this.formatAccountIdentifier(this.accountProfile.playerId);
    const nickname = this.accountProfile.nickname.length > 14 ? `${this.accountProfile.nickname.slice(0, 14)}…` : this.accountProfile.nickname;
    this.createProfileLine(drawer, 'ProfileNickname', `昵称：${nickname}`, top - 235, width, textColor);
    this.createProfileLine(drawer, 'ProfileIdentifier', `账号标识：${accountId}`, top - 280, width, textColor, 54);
    this.createProfileLine(drawer, 'ProfileLoginMethod', '登录方式：本地账号', top - 325, width, textColor);
    this.createProfileLine(drawer, 'ProfileAvatarHeading', '头像设置', top - 400, width, textColor, 28, 18);
    this.createProfileLine(drawer, 'ProfileAvatarHintOne', '当前为默认头像；接入微信登录后，', top - 435, width, textColor);
    this.createProfileLine(drawer, 'ProfileAvatarHintTwo', '会在此同步微信昵称和头像。', top - 465, width, textColor);
    this.createModalButton(drawer, '关闭', new Vec3(0, -height / 2 + 56, 0), new Color(92, 122, 160), () => this.closeAccountDrawer(), 150, 46, 17);
    this.accountDrawer = modal;
  }

  private closeAccountDrawer(): void {
    if (this.accountDrawer?.isValid) this.accountDrawer.destroy();
    this.accountDrawer = null;
  }

  /** UUIDs are deliberately displayed in fixed, short rows so a sidebar never
   * lets an unbroken account identifier bleed outside its bounds. */
  private formatAccountIdentifier(value: string): string {
    const lineLength = 22;
    if (value.length <= lineLength) return value;
    const parts: string[] = [];
    for (let index = 0; index < value.length; index += lineLength) parts.push(value.slice(index, index + lineLength));
    return parts.join('\n　　　　');
  }

  private createProfileLine(parent: Node, name: string, value: string, y: number, drawerWidth: number, color: Color, height = 28, fontSize = 16): void {
    const line = this.addLabel(parent, name, value, new Vec3(0, y, 0), drawerWidth - 64, height, fontSize, color);
    line.horizontalAlign = Label.HorizontalAlign.LEFT;
    line.verticalAlign = Label.VerticalAlign.CENTER;
    line.overflow = Label.Overflow.CLAMP;
  }

  private createActionButton(title: string, action: string, position: Vec3, enabled: boolean, color = new Color(40, 117, 214), width = 150, height = 52, fontSize = 18): Button {
    const parent = ['QUICK_MATCH', 'CREATE_ROOM', 'JOIN_ROOM'].includes(action) ? this.homeRoot : this.roomRoot;
    const node = new Node(`${action}Button`); node.setParent(parent ?? this.getRuntimeRoot()); node.layer = Layers.Enum.UI_2D; node.addComponent(UITransform).setContentSize(width, height); node.setPosition(position);
    const graphics = node.addComponent(Graphics); graphics.fillColor = color; graphics.roundRect(-width / 2, -height / 2, width, height, 12); graphics.fill(); this.addLabel(node, `${action}Text`, title, Vec3.ZERO, width - 10, height - 8, fontSize, Color.WHITE);
    const button = node.addComponent(Button); button.interactable = enabled;
    node.on(Node.EventType.TOUCH_END, () => { if (button.interactable) this.node.emit('ui-action', action); });
    if (action === 'START_GAME') {
      const showOwnerHint = (event?: unknown): void => {
        if (!button.interactable && this.currentScreen === 'ROOM' && this.roomOwnerId !== this.localPlayerId) this.showTooltipAtPointer('非房主无法开始对局', event, node);
      };
      node.on(Node.EventType.MOUSE_ENTER, showOwnerHint);
      node.on(Node.EventType.MOUSE_MOVE, showOwnerHint);
      node.on(Node.EventType.MOUSE_LEAVE, () => this.hideTooltip());
    }
    this.actionButtons.set(action, button); return button;
  }
  private updateDebugDiceButton(): void {
    const label = this.actionButtons.get('DEBUG_DICE')?.node.getChildByName('DEBUG_DICEText')?.getComponent(Label);
    if (label) label.string = this.debugDiceEnabled ? '指定点数' : '调试';
  }
  private updateActionButtonTitle(action: string, title: string): void {
    const label = this.actionButtons.get(action)?.node.getChildByName(`${action}Text`)?.getComponent(Label);
    if (label) label.string = title;
  }
  /** Text-like tabs keep the account page light while remaining easy to click. */
  private createAuthTab(parent: Node, mode: 'LOGIN' | 'REGISTER', title: string, position: Vec3): void {
    const node = new Node(`AuthTab${mode}`); node.setParent(parent); node.layer = Layers.Enum.UI_2D; node.addComponent(UITransform).setContentSize(104, 36); node.setPosition(position); node.addComponent(Graphics);
    this.addLabel(node, `${mode}TabText`, title, new Vec3(0, 4, 0), 100, 28, 17, new Color(111, 130, 158));
    node.on(Node.EventType.TOUCH_END, () => this.showAuthPage(mode));
    this.authTabs.set(mode, node);
  }
  private updateAuthTabs(): void {
    this.authTabs.forEach((node, mode) => {
      const active = mode === this.authMode;
      const graphics = node.getComponent(Graphics);
      graphics?.clear();
      if (active) { graphics!.fillColor = new Color(38, 112, 207); graphics!.roundRect(-40, -16, 80, 3, 1); graphics!.fill(); }
      const label = node.getComponentInChildren(Label);
      if (label) label.color = active ? new Color(28, 91, 180) : new Color(111, 130, 158);
    });
  }
  private createRememberToggle(parent: Node, position: Vec3): void {
    const node = new Node('RememberLoginToggle'); node.setParent(parent); node.layer = Layers.Enum.UI_2D; node.addComponent(UITransform).setContentSize(280, 32); node.setPosition(position);
    const graphics = node.addComponent(Graphics);
    const text = this.addLabel(node, 'RememberLoginText', '', new Vec3(14, 0, 0), 245, 28, 14, new Color(81, 105, 142)); text.horizontalAlign = Label.HorizontalAlign.LEFT;
    const redraw = (): void => {
      graphics.clear(); graphics.fillColor = this.rememberLogin ? new Color(35, 119, 214) : new Color(255, 255, 255); graphics.roundRect(-130, -9, 18, 18, 4); graphics.fill(); graphics.strokeColor = new Color(79, 133, 203); graphics.lineWidth = 1.5; graphics.roundRect(-130, -9, 18, 18, 4); graphics.stroke();
      if (this.rememberLogin) { graphics.strokeColor = Color.WHITE; graphics.lineWidth = 2; graphics.moveTo(-126, -1); graphics.lineTo(-123, -5); graphics.lineTo(-116, 4); graphics.stroke(); }
      text.string = '自动登录（保存 30 天登录状态）';
    };
    node.on('remember-changed', redraw);
    node.on(Node.EventType.TOUCH_END, () => { this.rememberLogin = !this.rememberLogin; for (const form of this.authForms.values()) form.getChildByName('RememberLoginToggle')?.emit('remember-changed'); });
    redraw();
  }
  private createModalRoot(name: string): Node { const size = view.getVisibleSize(); const modal = new Node(name); modal.setParent(this.getRuntimeRoot()); modal.layer = Layers.Enum.UI_2D; modal.addComponent(UITransform).setContentSize(size); const graphics = modal.addComponent(Graphics); graphics.fillColor = new Color(8, 22, 46, 195); graphics.rect(-size.width / 2, -size.height / 2, size.width, size.height); graphics.fill(); modal.setSiblingIndex(this.getRuntimeRoot().children.length - 1); return modal; }
  private createCard(parent: Node, name: string, width: number, height: number, fill: Color, border: Color): Node { const card = new Node(name); card.setParent(parent); card.layer = Layers.Enum.UI_2D; card.addComponent(UITransform).setContentSize(width, height); const graphics = card.addComponent(Graphics); graphics.fillColor = fill; graphics.roundRect(-width / 2, -height / 2, width, height, 22); graphics.fill(); graphics.strokeColor = border; graphics.lineWidth = 3; graphics.roundRect(-width / 2, -height / 2, width, height, 22); graphics.stroke(); return card; }
  private createModalButton(parent: Node, title: string, position: Vec3, color: Color, handler: () => void, width = 155, height = 52, fontSize = 19): void { const node = new Node(`${title}Button`); node.setParent(parent); node.layer = Layers.Enum.UI_2D; node.addComponent(UITransform).setContentSize(width, height); node.setPosition(position); const graphics = node.addComponent(Graphics); graphics.fillColor = color; graphics.roundRect(-width / 2, -height / 2, width, height, 11); graphics.fill(); this.addLabel(node, `${title}Text`, title, Vec3.ZERO, width - 10, height - 8, fontSize, Color.WHITE); node.on(Node.EventType.TOUCH_END, handler); }
  /** All web EditBoxes share one 44 px baseline. The HTML input is layered on
   * top of these labels during editing, so alignment must be identical. */
  private createTextInput(parent: Node, name: string, position: Vec3, width: number, placeholder: string, password = false): EditBox {
    // EditBox reads inputMode while it is enabled.  Keep the node inactive until
    // SINGLE_LINE has been assigned; otherwise Cocos creates an HTML textarea
    // from its default ANY mode and it can never be converted back to an input.
    const node = new Node(name);
    node.active = false;
    node.setParent(parent);
    node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform).setContentSize(width, 44);
    node.setPosition(position);

    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(246, 250, 255, 255);
    graphics.roundRect(-width / 2, -22, width, 44, 10);
    graphics.fill();
    graphics.strokeColor = new Color(152, 181, 219, 255);
    graphics.lineWidth = 1.5;
    graphics.roundRect(-width / 2, -22, width, 44, 10);
    graphics.stroke();

    const label = this.addLabel(node, `${name}Text`, '', Vec3.ZERO, width - 20, 44, 17, new Color(38, 64, 104));
    const hint = this.addLabel(node, `${name}Hint`, '', Vec3.ZERO, width - 20, 44, 16, new Color(118, 136, 160));
    [label, hint].forEach((text) => {
      // EditBox positions its labels using a top-left origin.  These labels are
      // generated at runtime, so give them the anchor the engine expects.
      text.node.getComponent(UITransform)!.setAnchorPoint(0, 1);
      text.horizontalAlign = Label.HorizontalAlign.LEFT;
      text.verticalAlign = Label.VerticalAlign.CENTER;
      text.lineHeight = 22;
    });

    const input = node.addComponent(EditBox);
    ['TEXT_LABEL', 'PLACEHOLDER_LABEL'].forEach((automaticName) => node.getChildByName(automaticName)?.destroy());
    input.textLabel = label;
    input.placeholderLabel = hint;
    input.placeholder = placeholder;
    input.inputMode = EditBox.InputMode.SINGLE_LINE;
    input.inputFlag = password ? EditBox.InputFlag.PASSWORD : EditBox.InputFlag.DEFAULT;
    node.active = true;

    // The focused state is a browser input, whereas the unfocused state is a
    // Cocos Label. Cocos lays that label out again after blur, so set a fixed
    // baseline both after activation and after editing ends.
    const alignDisplayLabels = () => {
      this.alignEditBoxLabel(label, width);
      this.alignEditBoxLabel(hint, width);
    };
    this.scheduleOnce(alignDisplayLabels);
    input.node.on(EditBox.EventType.EDITING_DID_ENDED, alignDisplayLabels);
    return input;
  }

  private alignEditBoxLabel(label: Label, width: number): void {
    const labelNode = label.node;
    if (!labelNode?.isValid) return;
    // Cocos defaults to (-width / 2 + 2, 22). Match the DOM input's left
    // padding and preserve the settled 10 px downward Canvas baseline.
    labelNode.setPosition(-width / 2 + 8, 12, labelNode.position.z);
  }
  private installWebInputStyle(): void {
    if (typeof document === 'undefined' || document.getElementById('SkillLudoEditBoxStyle')) return;
    const style = document.createElement('style'); style.id = 'SkillLudoEditBoxStyle';
    // Creator anchors the real browser input at the bottom of the edit box.
    // Let the browser use its normal centred single-line baseline; forcing a
    // 44px line-height makes the caret sit lower than the canvas label.
    style.textContent = 'input.cocosEditBox { box-sizing: border-box !important; margin: 0 !important; padding: 0 8px !important; min-height: 0 !important; line-height: normal !important; vertical-align: middle !important; overflow-y: hidden !important; } input.cocosEditBox::-webkit-scrollbar { display: none; }';
    document.head.appendChild(style);
  }
  private addLabel(parent: Node, name: string, text: string, position: Vec3, width: number, height: number, fontSize: number, color: Color): Label { const node = new Node(name); node.setParent(parent); node.layer = Layers.Enum.UI_2D; node.addComponent(UITransform).setContentSize(width, height); node.setPosition(position); const label = node.addComponent(Label); label.fontSize = fontSize; label.lineHeight = fontSize + 6; label.color = color; label.string = text; label.horizontalAlign = Label.HorizontalAlign.CENTER; return label; }
  private renderChatEntries(): void {
    if (!this.chatLinesRoot?.isValid) return;
    this.chatLineNodes.forEach((node) => node.destroy()); this.chatLineNodes = [];
    let y = 112;
    this.chatEntries.slice(-6).forEach((entry, index) => {
      const system = entry.kind === 'SYSTEM';
      const ownMessage = !system && entry.senderId === this.localPlayerId;
      const privateMessage = entry.kind === 'PRIVATE';
      if (system) {
        const systemLabel = this.addLabel(this.chatLinesRoot!, `ChatSystem${index}`, `── ${entry.content} ──`, new Vec3(0, y, 0), 550, 28, 16, new Color(224, 68, 68));
        systemLabel.overflow = Label.Overflow.CLAMP;
        this.chatLineNodes.push(systemLabel.node);
        y -= 34;
        return;
      }

      const line = new Node(`ChatLine${index}`);
      line.setParent(this.chatLinesRoot!);
      line.layer = Layers.Enum.UI_2D;
      line.addComponent(UITransform).setContentSize(550, 42);
      line.setPosition(0, y - 2, 0);
      const align = ownMessage ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.LEFT;
      const peer = ownMessage ? entry.recipientNickname : entry.senderNickname;
      const privateTag = privateMessage ? (ownMessage ? ` · 私信给 ${peer ?? '玩家'}` : ' · 私信') : '';
      const nickname = ownMessage ? `我${privateTag}` : `${entry.senderNickname ?? '玩家'}${privateTag}`;
      const nicknameColor = this.playerNameColor(ownMessage ? this.playerColors.get(this.localPlayerId) : this.playerColors.get(entry.senderId ?? ''));
      const senderLabel = this.addLabel(line, 'Nickname', nickname, new Vec3(0, 10, 0), 530, 20, 13, nicknameColor);
      senderLabel.horizontalAlign = align;
      senderLabel.overflow = Label.Overflow.CLAMP;
      // Only the nickname is coloured. The actual chat content deliberately
      // remains one neutral colour for legibility, including private messages.
      const contentLabel = this.addLabel(line, 'Content', entry.content, new Vec3(0, -10, 0), 530, 22, 16, new Color(45, 61, 86));
      contentLabel.horizontalAlign = align;
      contentLabel.overflow = Label.Overflow.CLAMP;
      this.chatLineNodes.push(line);
      y -= 46;
    });
  }
  private setActionVisible(action: string, active: boolean): void { const button = this.actionButtons.get(action); if (button) button.node.active = active; }
  private updateStartButtonAppearance(enabled: boolean): void {
    const button = this.startButton;
    if (!button) return;
    const node = button.node;
    const transform = node.getComponent(UITransform);
    const graphics = node.getComponent(Graphics);
    const label = node.getChildByName('START_GAMEText')?.getComponent(Label);
    if (!transform || !graphics) return;
    const width = transform.width;
    const height = transform.height;
    graphics.clear();
    graphics.fillColor = enabled ? new Color(35, 145, 92) : new Color(155, 163, 174);
    graphics.roundRect(-width / 2, -height / 2, width, height, 12);
    graphics.fill();
    if (label) label.color = enabled ? Color.WHITE : new Color(238, 241, 245);
  }
  private showTooltipAtPointer(text: string, event: unknown, anchor: Node): void {
    const root = this.getRuntimeRoot();
    const existing = root.children.filter((child) => child.name === 'StartOwnerTooltip' && child.isValid);
    let tooltip = existing.shift();
    existing.forEach((duplicate) => duplicate.destroy());
    if (!tooltip) {
      tooltip = new Node('StartOwnerTooltip');
      tooltip.setParent(root);
      tooltip.layer = Layers.Enum.UI_2D;
      tooltip.addComponent(UITransform).setContentSize(224, 30);
      const graphics = tooltip.addComponent(Graphics);
      graphics.fillColor = new Color(255, 226, 111, 255);
      graphics.roundRect(-112, -15, 224, 30, 5);
      graphics.fill();
      graphics.strokeColor = new Color(134, 99, 20, 255);
      graphics.lineWidth = 1;
      graphics.roundRect(-112, -15, 224, 30, 5);
      graphics.stroke();
      const label = this.addLabel(tooltip, 'TooltipText', text, Vec3.ZERO, 212, 26, 14, new Color(28, 28, 28));
      label.verticalAlign = Label.VerticalAlign.CENTER;
    }
    tooltip.active = true;
    const label = tooltip.getChildByName('TooltipText')?.getComponent(Label);
    if (label) label.string = text;
    const pointer = event as { getUILocation?: () => { x: number; y: number } } | undefined;
    const location = pointer?.getUILocation?.();
    const size = view.getVisibleSize();
    const fallback = anchor.position.clone().add(new Vec3(0, 46, 0));
    const x = location ? location.x - size.width / 2 + 112 : fallback.x;
    const y = location ? location.y - size.height / 2 + 28 : fallback.y;
    tooltip.setPosition(Math.max(-size.width / 2 + 118, Math.min(size.width / 2 - 118, x)), Math.max(-size.height / 2 + 22, Math.min(size.height / 2 - 22, y)), 0);
    tooltip.setSiblingIndex(root.children.length - 1);
  }
  private hideTooltip(): void {
    const tooltips = this.getRuntimeRoot().children.filter((child) => child.name === 'StartOwnerTooltip' && child.isValid);
    tooltips.forEach((tooltip, index) => { if (index === 0) tooltip.active = false; else tooltip.destroy(); });
  }
  private drawCloud(graphics: Graphics, x: number, y: number, scale: number): void { graphics.fillColor = new Color(255, 255, 255, 34); graphics.circle(x - 42 * scale, y, 24 * scale); graphics.circle(x - 5 * scale, y + 12 * scale, 34 * scale); graphics.circle(x + 35 * scale, y, 26 * scale); graphics.fill(); }
  private updatePlayerColors(players: PlayerPublicState[]): void {
    this.playerColors.clear();
    players.forEach((player) => this.playerColors.set(player.id, player.color));
    this.renderChatEntries();
  }
  private colorName(color: PlayerColor): string { return FACTION_NAMES[color]; }
  private playerNameColor(color: PlayerColor | undefined): Color {
    // Red nicknames use orange rather than red to preserve contrast on white.
    return ({ RED: new Color(232, 125, 43), YELLOW: new Color(189, 143, 25), BLUE: new Color(43, 113, 210), GREEN: new Color(37, 144, 83) } as Record<PlayerColor, Color>)[color ?? 'BLUE'];
  }
  private playerLine(player: PlayerPublicState): string { return `${this.colorIcon(player.color)} ${player.nickname}${player.isBot ? ' · AI' : ''}　${player.ready ? '已准备' : '未准备'}　${player.connected ? '在线' : '重连中'}`; }
  private statusFor(snapshot: GameSnapshot, myTurn: boolean): string {
    if (snapshot.phase === 'GAME_OVER') return '本局结束';
    const current = snapshot.players.find((player) => player.id === snapshot.currentPlayerId);
    if (current?.isBot) return `${current.nickname} 正在操作`;
    if (current?.aiControlled) return `${current.nickname}（AI托管）正在操作`;
    if (myTurn && snapshot.phase === 'WAIT_ROLL') return '轮到你投骰子';
    if (myTurn && snapshot.phase === 'WAIT_SELECT_PIECE') return '请选择高亮飞机';
    return `等待 ${current?.nickname ?? '玩家'} 操作`;
  }
  private colorIcon(color: string): string { return ({ RED: '🔴', YELLOW: '🟡', BLUE: '🔵', GREEN: '🟢' } as Record<string, string>)[color] ?? '⚪'; }
  private setText(label: Label | null, value: string): void { if (label) label.string = value; }
  private getRuntimeRoot(): Node { if (this.runtimeRoot?.isValid) return this.runtimeRoot; let current: Node | null = this.node; while (current && !current.getComponent(Canvas)) current = current.parent; const root = new Node('LudoRuntimeHUD'); root.setParent(current ?? this.node); root.layer = Layers.Enum.UI_2D; root.addComponent(UITransform).setContentSize(view.getVisibleSize()); root.setPosition(Vec3.ZERO); this.runtimeRoot = root; return root; }
}

js.setClassAlias(GameUI, 'a2bbc8d8-a6fb-476c-a433-b316dedca61a');
