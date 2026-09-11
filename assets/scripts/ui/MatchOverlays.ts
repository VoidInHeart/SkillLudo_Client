import { BlockInputEvents, Button, Color, Graphics, Label, Layers, Node, UITransform, view } from 'cc';
import type { ChatEntry, GameSnapshot, MatchVote } from '../protocol/GameProtocol';
import { gameViewport } from '../game/GameViewport';
import { FACTION_NAMES } from '../game/SkillCatalog';
import { inactivitySeconds, secondsRemaining } from './MatchPresentation';

export type LifecycleInput = { type: 'VOTE_PAUSE' | 'VOTE_CONTINUE'; voteId: number; agree: boolean } | { type: 'EXIT_GAME' | 'GAME_CHAT' };

/** Timed, non-blocking chat and warning surfaces; server-owned pause and voting modals. */
export class MatchOverlays {
  private readonly root: Node;
  private readonly toasts: Node;
  private readonly warning: Label;
  private modal: Node | null = null;
  private snapshot: GameSnapshot | null = null;
  private playerId = '';
  private roomId = '';
  private activeScreen = false;
  private modalKey = '';
  private dismissedWinner = '';
  private clock: Label | null = null;
  private deadline = 0;
  private pausedClock = false;
  private modalScale = 1;
  private entries: Array<{ entry: ChatEntry; expiresAt: number }> = [];
  private now: () => number = () => Date.now();
  public constructor(parent: Node, private readonly emit: (input: LifecycleInput) => void) {
    this.root = this.node('MatchOverlays', parent, 0, 0);
    this.toasts = this.node('ChatToasts', this.root, 0, 0);
    this.warning = this.label(this.root, 'InactivityWarning', '', 0, 0, 650, 27, 21, '#ff4e58');
    this.warning.isBold = true;
    view.on('canvas-resize', this.resize, this); view.on('design-resolution-changed', this.resize, this);
  }
  public destroy(): void { view.off('canvas-resize', this.resize, this); view.off('design-resolution-changed', this.resize, this); this.root.destroy(); }
  public setClock(now: () => number): void { this.now = now; }
  public setVisible(visible: boolean): void { this.activeScreen = visible; this.root.active = visible; }
  public render(snapshot: GameSnapshot, playerId: string): void {
    if (this.roomId && this.roomId !== snapshot.roomId) { this.entries = []; this.renderToasts(); }
    this.roomId = snapshot.roomId; this.snapshot = snapshot; this.playerId = playerId;
    if (snapshot.roomStatus === 'WAITING') this.dismissedWinner = '';
    this.renderModal(); this.resize();
  }
  public appendChat(entry: ChatEntry): void {
    this.entries.push({ entry, expiresAt: Date.now() + 30_000 });
    this.entries = this.entries.slice(-80); this.renderToasts();
  }
  public update(): void {
    const remaining = this.entries.filter((e) => e.expiresAt > Date.now());
    if (remaining.length !== this.entries.length) { this.entries = remaining; this.renderToasts(); }
    const seconds = inactivitySeconds(this.snapshot, this.playerId, this.now());
    this.warning.node.active = this.activeScreen && seconds !== null;
    this.warning.string = seconds === null ? '' : `将会在${seconds}秒后进入托管`;
    if (this.clock) this.clock.string = this.pausedClock
      ? `暂停剩余 ${Math.floor(secondsRemaining(this.deadline, this.now()) / 60)}:${String(secondsRemaining(this.deadline, this.now()) % 60).padStart(2, '0')}`
      : `投票剩余 ${secondsRemaining(this.deadline, this.now())} 秒`;
  }
  private resize(): void {
    const size = view.getVisibleSize(), layout = gameViewport(size.width, size.height);
    this.root.getComponent(UITransform)!.setContentSize(size);
    this.warning.node.setPosition(layout.boardX, layout.boardY - layout.boardSize / 2 - 13);
    this.warning.node.getComponent(UITransform)!.setContentSize(layout.boardSize, 26);
    this.warning.fontSize = layout.portrait ? 21 : 18;
    this.renderToasts(); this.renderModal(true); this.update();
  }
  private renderToasts(): void {
    this.clear(this.toasts);
    const size = view.getVisibleSize(), width = Math.min(345, size.width * .48);
    this.entries.slice(-4).forEach(({ entry }, i, shown) => {
      const card = this.card('ChatToast', this.toasts, width, 58, '#11283d');
      card.setPosition(-size.width / 2 + width / 2 + 14, -size.height * .12 - (shown.length - 1 - i) * 64);
      const sender = entry.kind === 'SYSTEM' ? '系统' : `${entry.kind === 'PRIVATE' ? '私信 · ' : ''}${entry.senderNickname ?? '玩家'}`;
      const label = this.label(card, 'ToastMessage', `${sender}：${entry.content}`, 0, 0, width - 22, 50, 15, entry.kind === 'SYSTEM' ? '#ffd787' : '#edf4fa');
      label.horizontalAlign = Label.HorizontalAlign.LEFT;
    });
  }
  private renderModal(force = false): void {
    const s = this.snapshot;
    const timing = s?.lifecycle;
    const winnerKey = s && s.rankings.length ? `${s.roomId}:${s.rankings.join(',')}:${s.roomStatus}` : '';
    const key = timing?.pause ? `pause:${timing.pause.startedAt}`
      : timing?.continueVote ? `continue:${timing.continueVote.id}:${JSON.stringify(timing.continueVote.votes)}`
      : s?.roomStatus === 'FINISHED' && winnerKey !== this.dismissedWinner ? `winner:${winnerKey}`
      : timing?.pauseVote ? `vote:${timing.pauseVote.id}:${JSON.stringify(timing.pauseVote.votes)}` : '';
    if (!force && key === this.modalKey) return;
    this.modalKey = key;
    this.modal?.removeFromParent(); this.modal?.destroy(); this.modal = null; this.clock = null;
    if (!s || !key) return;
    const size = view.getVisibleSize();
    const isPauseVote = !!timing?.pauseVote && !timing.pause && !timing.continueVote;
    this.modalScale = size.height > size.width ? 1.4 : 1;
    const width = Math.min(isPauseVote ? 350 * this.modalScale : this.modalScale > 1 ? 680 : 620, size.width - 28);
    const height = (isPauseVote ? 214 : 400) * this.modalScale;
    const overlay = this.node(isPauseVote ? 'PauseVotePopup' : 'MatchModal', this.root, size.width, size.height);
    if (!isPauseVote) {
      overlay.addComponent(BlockInputEvents);
      const g = overlay.addComponent(Graphics); g.fillColor = new Color(4, 12, 24, 230); g.rect(-size.width / 2, -size.height / 2, size.width, size.height); g.fill();
    }
    this.modal = overlay;
    const card = this.card(isPauseVote ? 'PauseVoteCard' : 'MatchModalCard', overlay, width, height, '#132d44');
    card.addComponent(BlockInputEvents);
    if (isPauseVote) card.setPosition(size.width / 2 - width / 2 - 14, -size.height / 2 + height / 2 + 16);
    if (timing?.pause) {
      this.label(card, 'PauseTitle', '技术暂停', 0, 136, width - 30, 52, 34, '#ffc96c');
      this.clock = this.label(card, 'PauseCountdown', '', 0, 58, width - 30, 58, 36, '#ffffff');
      this.deadline = timing.pause.endsAt; this.pausedClock = true;
      this.label(card, 'PauseHint', '棋局与行动倒计时已冻结\n可关闭网页，重新登录后从未结束对局返回', 0, -18, width - 36, 75, 19);
      this.button(card, 'PausedChat', '聊天', -width * .23, -132, width * .38, () => this.emit({ type: 'GAME_CHAT' }));
      this.button(card, 'PausedExit', '暂时离开', width * .23, -132, width * .38, () => this.emit({ type: 'EXIT_GAME' }));
    } else if (isPauseVote) {
      const vote = timing!.pauseVote!;
      const initiator = s.players.find((p) => p.id === vote.initiatorId)?.nickname ?? '玩家';
      this.label(card, 'VoteTitle', `${initiator} 请求技术暂停`, 0, 70, width - 24, 35, 21, '#ffc96c');
      this.label(card, 'VoteHint', `全票同意后暂停 2 分钟 · ${Object.values(vote.votes).filter(Boolean).length}/${vote.required}`, 0, 27, width - 20, 30, 16);
      this.clock = this.label(card, 'VoteCountdown', '', 0, -7, width - 20, 26, 16, '#ffc96c');
      this.deadline = vote.expiresAt; this.pausedClock = false;
      this.voteButtons(card, vote, 'VOTE_PAUSE', width, -64);
    } else {
      const champion = s.players.find((p) => p.id === s.rankings[0]);
      this.label(card, 'WinnerTitle', champion ? `${FACTION_NAMES[champion.color]}获胜！` : '本局结束', 0, 134, width - 30, 62, 42, '#ffdb81');
      this.label(card, 'WinnerName', champion?.nickname ?? '', 0, 78, width - 30, 36, 23);
      if (timing?.continueVote) {
        const vote = timing.continueVote;
        this.label(card, 'ContinueHint', `是否继续围观，角逐第二名？\n需 ${vote.required}/${vote.voterIds.length} 名真人同意（含观战）\n当前同意 ${Object.values(vote.votes).filter(Boolean).length} 票 · 本局仅一次继续机会`, 0, 5, width - 35, 104, 19);
        this.clock = this.label(card, 'ContinueCountdown', '', 0, -77, width - 24, 30, 19, '#ffc96c');
        this.deadline = vote.expiresAt; this.pausedClock = false;
        this.voteButtons(card, vote, 'VOTE_CONTINUE', width, -141);
      } else {
        const runner = s.players.find((p) => p.id === s.rankings[1]);
        this.label(card, 'FinalRanking', runner ? `第二名 · ${FACTION_NAMES[runner.color]}\n${runner.nickname}` : '感谢参与本次飞行棋对局', 0, -10, width - 35, 80, 24);
        this.button(card, 'DismissWinner', '查看棋盘', 0, -135, width * .55, () => { this.dismissedWinner = winnerKey; this.renderModal(); });
      }
    }
    this.update();
  }
  private voteButtons(card: Node, vote: MatchVote, type: 'VOTE_PAUSE' | 'VOTE_CONTINUE', width: number, y: number): void {
    const eligible = vote.voterIds.includes(this.playerId), voted = Object.prototype.hasOwnProperty.call(vote.votes, this.playerId);
    if (!eligible || voted) {
      this.label(card, 'VoteSubmitted', voted ? `已投${vote.votes[this.playerId] ? '同意' : '不同意'} · 等待结果` : '本次投票无需你表决', 0, y, width - 22, 42, 18, '#a5bbce'); return;
    }
    const submit = (agree: boolean) => {
      for (const button of card.getComponentsInChildren(Button)) button.interactable = false;
      this.emit({ type, voteId: vote.id, agree });
    };
    this.button(card, 'VoteNo', '不同意', -width * .23, y, width * .4, () => submit(false));
    this.button(card, 'VoteYes', '同意', width * .23, y, width * .4, () => submit(true), '#b98429');
  }
  private clear(node: Node): void { node.children.slice().forEach((n) => { n.removeFromParent(); n.destroy(); }); }
  private node(name: string, parent: Node, width: number, height: number): Node {
    const node = new Node(name); node.setParent(parent); node.layer = Layers.Enum.UI_2D; node.addComponent(UITransform).setContentSize(width, height); return node;
  }
  private card(name: string, parent: Node, width: number, height: number, color: string): Node {
    const node = this.node(name, parent, width, height), g = node.addComponent(Graphics);
    g.fillColor = new Color(color); g.roundRect(-width / 2, -height / 2, width, height, 14); g.fill();
    g.lineWidth = 1; g.strokeColor = new Color('#49677f'); g.roundRect(-width / 2, -height / 2, width, height, 14); g.stroke(); return node;
  }
  private label(parent: Node, name: string, text: string, x: number, y: number, width: number, height: number, font: number, color = '#edf4fa'): Label {
    const scale = this.scaleFor(parent); y *= scale; height *= scale; font *= scale;
    const node = this.node(name, parent, width, height); node.setPosition(x, y);
    const label = node.addComponent(Label); label.string = text; label.fontSize = font; label.lineHeight = font + 7; label.color = new Color(color);
    label.overflow = Label.Overflow.SHRINK; label.horizontalAlign = Label.HorizontalAlign.CENTER; label.verticalAlign = Label.VerticalAlign.CENTER; return label;
  }
  private button(parent: Node, name: string, title: string, x: number, y: number, width: number, click: () => void, color = '#287bc0'): void {
    const scale = this.scaleFor(parent);
    const node = this.card(name, parent, width, 43 * scale, color); node.setPosition(x, y * scale); const button = node.addComponent(Button);
    this.label(node, 'Text', title, 0, 0, width - 12, 37, 18);
    node.on(Node.EventType.TOUCH_END, () => { if (button.interactable) click(); });
  }
  private scaleFor(parent: Node): number {
    for (let node: Node | null = parent; node; node = node.parent) if (node === this.modal) return this.modalScale;
    return 1;
  }
}
