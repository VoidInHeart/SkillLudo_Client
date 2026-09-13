import { BlockInputEvents, Button, Color, EventTouch, Graphics, Label, Layers, Node, UITransform, sys, view } from 'cc';

const CHAT_TOASTS_KEY = 'skillLudo.chatToastsEnabled';

/** Local display preferences, independent of the current room or account. */
export class SettingsPanel {
  public readonly root: Node;
  public chatToastsEnabled = true;
  private readonly gear: Node;
  private modal: Node | null = null;
  private toggle: Node | null = null;
  private stateLabel: Label | null = null;
  private scale = 1;

  public constructor(parent: Node, private readonly changed: (enabled: boolean) => void, private readonly feedback: () => void = () => {}) {
    try { this.chatToastsEnabled = sys.localStorage.getItem(CHAT_TOASTS_KEY) !== 'false'; } catch { /* Use the default when storage is unavailable. */ }
    this.root = this.node('GlobalSettings', parent, 0, 0);
    this.gear = this.node('SettingsGear', this.root, 60, 60);
    this.gear.addComponent(Button);
    const g = this.gear.addComponent(Graphics);
    g.fillColor = new Color(24, 54, 87, 220); g.roundRect(-28, -28, 56, 56, 15); g.fill();
    g.strokeColor = new Color('#e4effb'); g.lineWidth = 2.6;
    for (let i = 0; i < 32; i++) {
      const angle = i * Math.PI / 16, radius = i % 4 < 2 ? 20 : 16;
      if (i === 0) g.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      else g.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    g.close(); g.stroke(); g.circle(0, 0, 7); g.stroke();
    this.gear.on(Node.EventType.TOUCH_END, () => this.modal ? this.close() : this.open());
    view.on('canvas-resize', this.resize, this); view.on('design-resolution-changed', this.resize, this);
    this.resize();
  }
  public destroy(): void {
    view.off('canvas-resize', this.resize, this); view.off('design-resolution-changed', this.resize, this);
    this.root.destroy();
  }
  public update(): void {
    // Keep the gear available above chat, skill, pause and winner windows.
    const siblings = this.root.parent?.children;
    if (siblings && siblings[siblings.length - 1] !== this.root) this.root.setSiblingIndex(siblings.length - 1);
  }
  public close(): void {
    this.modal?.removeFromParent(); this.modal?.destroy(); this.modal = null; this.toggle = null; this.stateLabel = null;
  }
  public open(): void {
    this.close();
    const size = view.getVisibleSize(); this.scale = size.height > size.width ? 1.2 : 1;
    const s = this.scale;
    this.modal = this.node('SettingsModal', this.root, size.width, size.height);
    this.modal.addComponent(BlockInputEvents);
    const shade = this.modal.addComponent(Graphics); shade.fillColor = new Color(8, 22, 46, 110);
    shade.rect(-size.width / 2, -size.height / 2, size.width, size.height); shade.fill();
    const card = this.node('SettingsCard', this.modal, 490 * s, 280 * s);
    card.addComponent(BlockInputEvents);
    const background = card.addComponent(Graphics); background.fillColor = new Color('#f0f6fc');
    background.roundRect(-245 * s, -140 * s, 490 * s, 280 * s, 20 * s); background.fill();
    this.label(card, 'SettingsTitle', '设置', 0, 93, 360, 44, 29, '#24466b');
    const close = this.node('CloseSettings', card, 48 * s, 48 * s); close.setPosition(211 * s, 105 * s);
    this.label(close, 'CloseSettingsText', '×', 0, 0, 46, 46, 30, '#58738f');
    close.addComponent(Button); close.on(Node.EventType.TOUCH_END, () => this.close());
    this.label(card, 'ChatToastsTitle', '聊天消息浮窗', -83, 18, 240, 38, 22, '#29496c');
    this.label(card, 'ChatToastsHint', '显示新收到的聊天与系统消息', -83, -18, 254, 34, 15, '#647d96');
    this.label(card, 'SettingsHint', '关闭后仍可在聊天窗口查看完整消息', -48, -98, 340, 38, 16, '#647d96');
    const feedback = this.node('FeedbackButton', card, 85 * s, 40 * s); feedback.setPosition(178 * s, -98 * s);
    this.label(feedback, 'FeedbackText', '反馈', 0, 0, 80, 36, 20, '#287bc0');
    feedback.addComponent(Button); feedback.on(Button.EventType.CLICK, () => { this.close(); this.feedback(); });
    this.toggle = this.node('ChatToastsToggle', card, 110 * s, 60 * s); this.toggle.setPosition(155 * s, 14 * s);
    this.toggle.addComponent(Button); this.toggle.addComponent(Graphics);
    this.stateLabel = this.label(card, 'ChatToastsState', '', 155, -37, 100, 30, 17, '#486b8d');
    let startX = 0, progress = 0, startProgress = 0, distance = 0;
    this.toggle.on(Node.EventType.TOUCH_START, (event: EventTouch) => {
      startX = event.getUILocation().x; startProgress = progress = this.chatToastsEnabled ? 1 : 0; distance = 0;
    });
    this.toggle.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => {
      distance = event.getUILocation().x - startX;
      progress = Math.max(0, Math.min(1, startProgress + distance / (52 * s)));
      this.drawToggle(progress);
    });
    this.toggle.on(Node.EventType.TOUCH_END, () => {
      this.chatToastsEnabled = Math.abs(distance) > 5 * s ? progress >= 0.5 : !this.chatToastsEnabled;
      try { sys.localStorage.setItem(CHAT_TOASTS_KEY, String(this.chatToastsEnabled)); } catch { /* The current-page preference still works without storage. */ }
      this.changed(this.chatToastsEnabled); this.drawToggle();
    });
    this.toggle.on(Node.EventType.TOUCH_CANCEL, () => this.drawToggle());
    this.drawToggle(); this.gear.setSiblingIndex(this.root.children.length - 1); this.update();
  }
  private resize(): void {
    const size = view.getVisibleSize(); this.root.getComponent(UITransform)!.setContentSize(size);
    this.gear.setPosition(-size.width / 2 + 46, size.height / 2 - 46);
    if (this.modal) this.open();
    this.update();
  }
  private drawToggle(progress = this.chatToastsEnabled ? 1 : 0): void {
    const g = this.toggle?.getComponent(Graphics); if (!g) return;
    const s = this.scale;
    g.clear(); g.fillColor = new Color(progress >= 0.5 ? '#398bb8' : '#a5b6c8');
    g.roundRect(-49 * s, -23 * s, 98 * s, 46 * s, 23 * s); g.fill();
    g.fillColor = new Color('#ffffff'); g.circle((-26 + progress * 52) * s, 0, 18 * s); g.fill();
    if (this.stateLabel) this.stateLabel.string = this.chatToastsEnabled ? '已开启' : '已关闭';
  }
  private node(name: string, parent: Node, width: number, height: number): Node {
    const node = new Node(name); node.setParent(parent); node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform).setContentSize(width, height); return node;
  }
  private label(parent: Node, name: string, text: string, x: number, y: number, width: number, height: number, font: number, color: string): Label {
    const s = this.scale, node = this.node(name, parent, width * s, height * s); node.setPosition(x * s, y * s);
    const label = node.addComponent(Label); label.string = text; label.fontSize = font * s; label.lineHeight = (font + 5) * s;
    label.color = new Color(color); label.horizontalAlign = Label.HorizontalAlign.CENTER; label.verticalAlign = Label.VerticalAlign.CENTER;
    return label;
  }
}
