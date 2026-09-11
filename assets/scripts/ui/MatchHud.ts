import { Button, Color, Graphics, Label, Layers, Node, UITransform, view } from 'cc';
import type { ActionOption, GameSnapshot, PlayerColor } from '../protocol/GameProtocol';
import { BOARD_COLORS } from '../game/BoardGeometry';
import { gameViewport } from '../game/GameViewport';

const names: Record<PlayerColor, string> = { RED: '红', YELLOW: '黄', BLUE: '蓝', GREEN: '绿' };
const WHITE = new Color('#edf4fa');
const MUTED = new Color('#a4b8cc');

/** Match controls have no knowledge of login, lobby, calibration geometry or
 * animation internals. Snapshot + input lock completely determines their state. */
export class MatchHud {
  public readonly root: Node;
  private buttons = new Map<string, Button>();
  private labels = new Map<string, Label>();
  private snapshot: GameSnapshot | null = null;
  private localPlayerId = '';
  private busy = false;
  private pending = false;
  private admin = false;
  private calibrationText = '';
  private selectedOption: ActionOption | null = null;
  public constructor(parent: Node, private readonly emit: (action: string) => void) {
    this.root = this.node('MatchHud', parent, 286, 664);
    this.rebuild();
    view.on('canvas-resize', this.rebuild, this);
    view.on('design-resolution-changed', this.rebuild, this);
  }
  public destroy(): void { view.off('canvas-resize', this.rebuild, this); view.off('design-resolution-changed', this.rebuild, this); this.root.destroy(); }
  public setVisible(visible: boolean): void { this.root.active = visible; }
  public setAdmin(admin: boolean): void { this.admin = admin; this.refresh(); }
  public setBusy(busy: boolean): void { this.busy = busy; this.refresh(); }
  public requestPending(): void { this.pending = true; this.refresh(); }
  public clearPending(): void { this.pending = false; this.refresh(); }
  public setSelectedOption(option: ActionOption | null): void { this.selectedOption = option; this.refresh(); }
  public showStatus(message: string): void { this.text('status', message); }
  public showCalibration(message: string): void { this.calibrationText = message; this.text('calibration', message); }
  public render(snapshot: GameSnapshot, playerId: string): void {
    this.snapshot = snapshot; this.localPlayerId = playerId; this.pending = false; this.refresh();
  }
  private rebuild(): void {
    this.root.children.slice().forEach((child) => { child.removeFromParent(); child.destroy(); });
    this.buttons.clear(); this.labels.clear();
    const size = view.getVisibleSize(), layout = gameViewport(size.width, size.height), p = layout.portrait;
    const width = layout.hudWidth, height = layout.hudHeight, top = height / 2;
    this.root.setPosition(layout.hudX, layout.hudY);
    this.root.getComponent(UITransform)!.setContentSize(width, height);
    const background = this.root.getComponent(Graphics) ?? this.root.addComponent(Graphics);
    background.clear(); background.fillColor = new Color('#11283d'); background.roundRect(-width / 2, -height / 2, width, height, 20); background.fill();
    background.strokeColor = new Color('#36516b'); background.lineWidth = 1; background.roundRect(-width / 2, -height / 2, width, height, 20); background.stroke();
    this.label('room', '好友对局', p ? -width * 0.24 : 0, top - 30, p ? width * 0.46 : width - 30, 28, 19, WHITE);
    this.label('color', '', p ? width * 0.23 : 0, p ? top - 30 : top - 65, p ? width * 0.44 : width - 30, 28, 16, MUTED);
    this.label('players', '', p ? -width * 0.23 : 0, p ? top - 82 : top - 134, p ? width * 0.45 : width - 32, p ? 66 : 100, p ? 15 : 16, MUTED);
    this.label('dice', '投出两枚骰子', p ? width * 0.23 : 0, p ? top - 62 : top - 204, p ? width * 0.43 : width - 20, 26, 16, WHITE);
    this.button('SELECT_DIE_0', '—', p ? width * 0.23 - 55 : -59, p ? top - 108 : top - 254, 100, 58, 25);
    this.button('SELECT_DIE_1', '—', p ? width * 0.23 + 55 : 59, p ? top - 108 : top - 254, 100, 58, 25);
    this.label('status', '', 0, p ? -4 : top - 314, width - 20, 44, 16, WHITE);
    this.button('ROLL_DICE', '掷出双骰', p ? -width * 0.24 : 0, p ? -59 : top - 369, p ? width * 0.42 : width - 42, 44, 19);
    this.label('skills', '阵营技能 · 待解锁', p ? width * 0.23 : 0, p ? -62 : top - 414, p ? width * 0.42 : width - 20, 28, 14, MUTED);
    const actions = [['GAME_CHAT', '聊天'], ['AI_TAKEOVER', 'AI托管'], ['EXIT_GAME', '退出'], ['DEBUG_DICE', '调试'], ['CALIBRATE', '校准']];
    actions.forEach(([action, title], index) => {
      const x = p ? (index - 2) * Math.min(108, (width - 28) / 5) : (index % 3 - 1) * 85;
      const y = p ? -114 : top - 464 - Math.floor(index / 3) * 42;
      this.button(action, title, x, y, p ? 96 : 78, 32, 14);
    });
    this.label('calibration', this.calibrationText, 0, p ? -144 : -height / 2 + 22, width - 16, 28, 12, new Color('#f8d776'));
    this.refresh();
  }
  private refresh(): void {
    const snapshot = this.snapshot;
    this.buttons.get('CALIBRATE')!.node.active = this.admin;
    if (!snapshot) return;
    const local = snapshot.players.find((p) => p.id === this.localPlayerId);
    const current = snapshot.players.find((p) => p.id === snapshot.currentPlayerId);
    const myTurn = current?.id === this.localPlayerId && !local?.aiControlled;
    const enabled = !!myTurn && !this.busy && !this.pending;
    this.text('room', `${snapshot.roomId} · 第 ${snapshot.turnNumber} 回合`);
    this.text('color', local ? `${names[local.color]}色阵营 · 你的机场在左下` : '观战');
    const lines = snapshot.players.map((p) => `${p.id === current?.id ? '▶ ' : ''}${names[p.color]} · ${p.nickname.slice(0, 9)}${p.isBot || p.aiControlled ? ' [AI]' : ''}`);
    this.text('players', lines.join('\n'));
    const pair = snapshot.diceChoices;
    this.text('dice', snapshot.phase === 'WAIT_SELECT_DIE' ? '选择本回合点数' : snapshot.dice ? `本回合选择：${snapshot.dice}` : '投出两枚骰子');
    for (let index = 0; index < 2; index += 1) {
      this.text(`SELECT_DIE_${index}`, pair ? String(pair[index]) : '—');
      this.enable(`SELECT_DIE_${index}`, enabled && snapshot.phase === 'WAIT_SELECT_DIE', this.selectedOption?.dieIndex === index && snapshot.phase === 'WAIT_SELECT_DIE');
    }
    const canPass = snapshot.phase === 'WAIT_SELECT_DIE' && !!this.selectedOption && this.selectedOption.movablePieceIds.length === 0;
    this.text('ROLL_DICE', canPass ? '无棋可动 · 确认跳过' : '掷出双骰');
    this.enable('ROLL_DICE', enabled && (snapshot.phase === 'WAIT_ROLL' || canPass));
    this.enable('DEBUG_DICE', enabled && snapshot.phase === 'WAIT_ROLL');
    this.enable('GAME_CHAT', true);
    this.enable('AI_TAKEOVER', snapshot.roomStatus === 'PLAYING');
    this.enable('EXIT_GAME', snapshot.roomStatus === 'PLAYING');
    this.enable('CALIBRATE', this.admin && !this.busy);
    this.text('AI_TAKEOVER', local?.aiControlled ? '取消托管' : 'AI托管');
    let status = myTurn ? snapshot.phase === 'WAIT_SELECT_DIE' ? '点击棋盘骰子或点数卡选择' : snapshot.phase === 'WAIT_SELECT_PIECE' ? '请选择高亮飞机' : '轮到你投骰子' : `等待 ${current?.nickname ?? '玩家'}`;
    if (myTurn && snapshot.phase === 'WAIT_SELECT_DIE' && this.selectedOption) status = this.selectedOption.movablePieceIds.length
      ? `预选 ${this.selectedOption.dice} · 点击高亮飞机出发\n点击另一枚骰子可更换点数` : `预选 ${this.selectedOption.dice} · 无棋可动\n可换点数，或确认跳过`;
    if (this.busy) status = '正在播放棋局动作…';
    if (this.pending) status = '正在等待服务器…';
    if (snapshot.phase === 'GAME_OVER') status = `本局获胜：${snapshot.players.find((p) => p.id === snapshot.rankings[0])?.nickname ?? '对局结束'}`;
    this.text('status', status);
    if (local) this.labels.get('color')!.color = new Color(BOARD_COLORS[local.color]);
  }
  private enable(action: string, enabled: boolean, selected = false): void {
    const button = this.buttons.get(action)!; button.interactable = enabled;
    const size = button.node.getComponent(UITransform)!;
    const graphics = button.node.getComponent(Graphics)!;
    graphics.clear(); graphics.fillColor = new Color(selected ? '#ad8240' : enabled ? '#287bc0' : '#293e50');
    graphics.roundRect(-size.width / 2, -size.height / 2, size.width, size.height, 9); graphics.fill();
    this.labels.get(action)!.color = enabled || selected ? WHITE : MUTED;
  }
  private button(action: string, title: string, x: number, y: number, width: number, height: number, font: number): void {
    const node = this.node(action, this.root, width, height); node.setPosition(x, y); node.addComponent(Graphics);
    const button = node.addComponent(Button); this.buttons.set(action, button);
    this.label(action, title, 0, 0, width - 6, height - 4, font, WHITE, node);
    node.on(Node.EventType.TOUCH_END, () => { if (button.interactable) this.emit(action); });
    this.enable(action, false);
  }
  private label(id: string, text: string, x: number, y: number, width: number, height: number, font: number, color: Color, parent = this.root): void {
    const node = this.node(`${id}-label`, parent, width, height); node.setPosition(x, y);
    const label = node.addComponent(Label); label.string = text; label.fontSize = font; label.lineHeight = font + 6; label.color = color;
    label.horizontalAlign = Label.HorizontalAlign.CENTER; label.verticalAlign = Label.VerticalAlign.CENTER; label.overflow = Label.Overflow.SHRINK;
    this.labels.set(id, label);
  }
  private text(id: string, value: string): void { const label = this.labels.get(id); if (label) label.string = value; }
  private node(name: string, parent: Node, width: number, height: number): Node {
    const node = new Node(name); node.setParent(parent); node.layer = Layers.Enum.UI_2D; node.addComponent(UITransform).setContentSize(width, height); return node;
  }
}
