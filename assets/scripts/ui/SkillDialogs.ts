import { BlockInputEvents, Button, Color, Graphics, Label, Layers, Node, UITransform, view } from 'cc';
import type { GameSnapshot, PlayerColor } from '../protocol/GameProtocol';
import { describeSkill, FACTION_NAMES, SKILL_CATALOG, SKILL_KIND_NAMES } from '../game/SkillCatalog';

export type SkillInput = { type: 'cast'; skillId: string; targetPieceIds?: string[]; targetCell?: string; reactionId?: number }
  | { type: 'option'; optionId: string } | { type: 'target'; skillId: 'uk-sun' | 'us-bomb' };

/** Catalog, action choices and defensive reactions share one modal surface.
 * Availability comes exclusively from the latest authoritative snapshot. */
export class SkillDialogs {
  private root: Node | null = null;
  private snapshot: GameSnapshot | null = null;
  private playerId = '';
  private busy = false;
  private mode: 'closed' | 'book' | 'options' | 'reaction' | 'confirm' = 'closed';
  private color: PlayerColor = 'RED';
  private skillIndex = 0;
  private reactionKey = '';
  private locks = new Set<string>();
  private countdown: Label | null = null;
  private inMatch = false;

  public constructor(private readonly parent: Node, private readonly emit: (input: SkillInput) => void) {
    view.on('canvas-resize', this.resize, this); view.on('design-resolution-changed', this.resize, this);
  }
  public destroy(): void { this.close(); view.off('canvas-resize', this.resize, this); view.off('design-resolution-changed', this.resize, this); }
  private resize(): void { if (this.mode === 'book') this.renderBook(); else if (this.mode === 'options') this.renderOptions(); else if (this.mode === 'reaction') this.renderReaction(); }
  public close(): void { this.remove(); this.mode = 'closed'; }
  public setBusy(busy: boolean): void {
    if (this.busy === busy) return;
    this.busy = busy;
    if (this.mode === 'book') this.renderBook();
    if (this.mode === 'options') this.renderOptions();
    if (this.mode === 'reaction') this.renderReaction();
  }
  public sync(snapshot: GameSnapshot, playerId: string): void {
    this.snapshot = snapshot; this.playerId = playerId;
    const reaction = snapshot.reaction;
    const local = snapshot.players.find((p) => p.id === playerId);
    if (reaction?.playerId === playerId && !local?.aiControlled && snapshot.phase === 'WAIT_REACTION') {
      const key = `${snapshot.roomId}:${reaction.id}`;
      if (key !== this.reactionKey) { this.locks.clear(); this.reactionKey = key; }
      this.mode = 'reaction'; this.renderReaction(); return;
    }
    if (this.mode === 'reaction' || this.mode === 'confirm' || this.mode === 'options') this.close();
    if (this.mode === 'book') this.renderBook();
  }
  public update(): void {
    if (this.countdown && this.snapshot?.reaction) this.countdown.string = `还有 ${Math.max(0, Math.ceil((this.snapshot.reaction.expiresAt - Date.now()) / 1000))} 秒 · 超时放弃`;
  }
  public openBook(inMatch = false): void {
    if (this.mode === 'reaction') return;
    this.inMatch = inMatch;
    this.color = inMatch ? this.snapshot?.players.find((p) => p.id === this.playerId)?.color ?? 'RED' : 'RED';
    this.skillIndex = 0; this.mode = 'book'; this.renderBook();
  }
  public confirmTarget(description: string, input: SkillInput, cancel: () => void): void {
    this.mode = 'confirm';
    const { card, width, height } = this.frame('确认技能目标', 340);
    this.label(card, 'TargetSummary', description, 0, 32, width - 48, 138, 20);
    this.button(card, 'CancelSkill', '取消', -width * .23, -height / 2 + 65, width * .38, () => { this.close(); cancel(); });
    this.button(card, 'ConfirmSkill', '确认发动', width * .23, -height / 2 + 65, width * .38, () => { this.close(); this.emit(input); });
  }

  private renderBook(): void {
    const { card, width, height } = this.frame('阵营技能图鉴');
    const top = height / 2;
    this.button(card, 'CloseSkills', '关闭', width / 2 - 58, top - 32, 82, () => this.close(), true, false, 34);
    (['RED', 'YELLOW', 'BLUE', 'GREEN'] as PlayerColor[]).forEach((color, index) => {
      this.button(card, `Faction-${color}`, FACTION_NAMES[color], (index - 1.5) * (width - 32) / 4, top - 89, (width - 48) / 4,
        () => { this.color = color; this.skillIndex = 0; this.renderBook(); }, true, this.color === color);
    });
    const skills = SKILL_CATALOG.filter((s) => s.color === this.color);
    const definition = skills[this.skillIndex];
    const owner = this.inMatch ? this.snapshot?.players.find((p) => p.color === this.color) : undefined;
    skills.forEach((skill, index) => {
      const state = this.snapshot?.skills.find((s) => s.playerId === owner?.id && s.skillId === skill.id);
      const dim = !!state && ((state.cooldownTurns > 0 && !state.available) || state.charges === 0 || (['cn-scale', 'uk-industry'].includes(skill.id) && !state.awakened));
      const progress = skill.kind === 'AWAKENING' && state ? ` (${state.progress ?? 0}/${skill.id === 'cn-roar' ? 100 : 2})` : '';
      this.button(card, `Skill-${skill.id}`, skill.name + progress,
      (index - (skills.length - 1) / 2) * (width - 32) / skills.length, top - 146, (width - 44) / skills.length,
      () => { this.skillIndex = index; this.renderBook(); }, true, this.skillIndex === index, 42, dim);
    });
    const runtime = this.snapshot?.skills.find((s) => s.playerId === owner?.id && s.skillId === definition.id);
    const color = new Color(({ RED: '#ff938c', YELLOW: '#ffe08a', BLUE: '#79b8ff', GREEN: '#a2e58e' })[this.color]);
    this.label(card, 'SkillKind', SKILL_KIND_NAMES[definition.kind], 0, top - 196, width - 40, 28, 16, color);
    const descriptionHeight = Math.max(80, height - 370);
    this.label(card, 'SkillDescription', describeSkill(definition.id, runtime), 0, top - 222 - descriptionHeight / 2, width - 52, descriptionHeight, 20);
    let status = runtime ? runtime.reason || (runtime.awakened ? '已觉醒' : runtime.available ? '可以发动' : '自动生效 / 等待条件') : '进入对局后显示技能状态';
    if (runtime && definition.kind === 'LIMITED') status = runtime.charges > 0 ? `剩余 1 次 · ${status}` : '本局已使用';
    if (runtime && definition.kind === 'COOLDOWN' && runtime.cooldownTurns > 0) status = `冷却中 · 还需 ${runtime.cooldownTurns} 个己方正常回合`;
    if (runtime && definition.kind === 'AWAKENING') status = runtime.awakened ? '已觉醒 · 永久生效' : `觉醒进度：${runtime.progress ?? 0}${definition.id === 'cn-roar' ? ' / 100（超过后觉醒）' : ' / 2 架'}`;
    if (runtime && definition.id === 'uk-apple' && !runtime.awakened) status += runtime.charges === 0 ? ' · 绑定已使用' : ' · 绑定剩余 1 次';
    if (runtime && definition.id === 'cn-scale' && runtime.forcedDelta) status += ` · 本次强制 ${runtime.forcedDelta > 0 ? '+' : ''}${runtime.forcedDelta}`;
    if (runtime && definition.id === 'cn-scale' && runtime.storedCharge) status += ' · 已储备 1 次';
    if (runtime && definition.id === 'cn-scale' && runtime.usedThisTurn) status = '本轮已使用（含储备），下轮再操作';
    if (runtime && definition.id === 'cn-grit') status = `${'◆'.repeat(runtime.energy ?? 0)}${'◇'.repeat(3 - (runtime.energy ?? 0))}  能量 · 强化 ${runtime.level ?? 0}/3`;
    this.label(card, 'SkillStatus', status, 0, -height / 2 + 114, width - 40, 42, 16,
      runtime?.available || runtime?.awakened ? color : new Color('#a4b8cc'));
    const canUse = this.inMatch && !!runtime?.available && owner?.id === this.playerId && !owner?.aiControlled && !this.busy;
    this.button(card, 'ActivateSkill', definition.id === 'cn-grit' ? '消耗 3 能量 · 强化' : ['uk-industry', 'cn-scale'].includes(definition.id) ? '选择改点方案' : '发动技能',
      0, -height / 2 + 65, Math.min(width - 60, 350), () => {
        if (definition.id === 'uk-industry' || definition.id === 'cn-scale') { this.mode = 'options'; this.renderOptions(); }
        else {
          this.close();
          if (definition.id === 'uk-sun' || definition.id === 'us-bomb') this.emit({ type: 'target', skillId: definition.id });
          else this.emit({ type: 'cast', skillId: definition.id === 'cn-grit' ? 'cn-upgrade' : definition.id });
        }
      }, canUse);
    this.label(card, 'TrusteePolicy', 'AI 托管只触发被动效果，不会主动发动技能', 0, -height / 2 + 23, width - 28, 26, 13, new Color('#a4b8cc'));
  }
  private renderOptions(): void {
    const options = this.snapshot?.actionOptions?.filter((o) => o.kind === 'UK_PLUS' || o.kind === 'UK_SUM' || o.kind === 'CN_SHIFT') ?? [];
    const { card, width, height } = this.frame('选择改点方案');
    this.label(card, 'OptionsHint', '点选仅预览；点击高亮飞机后才消耗技能', 0, height / 2 - 78, width - 32, 38, 17);
    const rowHeight = Math.min(65, (height - 200) / Math.ceil(Math.max(1, options.length) / 2));
    options.forEach((option, index) => this.button(card, `Option-${option.id}`, `${option.label}\n${option.movablePieceIds.length} 架可动`,
      (index % 2 === 0 ? -1 : 1) * width * .235, height / 2 - 136 - Math.floor(index / 2) * rowHeight, width * .44,
      () => { this.close(); this.emit({ type: 'option', optionId: option.id }); }, !this.busy, false, rowHeight - 8));
    this.button(card, 'BackToSkills', '返回图鉴', 0, -height / 2 + 45, 200, () => { this.mode = 'book'; this.renderBook(); });
  }
  private renderReaction(): void {
    const reaction = this.snapshot?.reaction;
    if (!reaction) return;
    const binding = reaction.kind === 'UK_BIND';
    const { card, width, height } = this.frame(binding ? '牛顿的苹果 · 是否绑定敌机？' : '传统艺能 · 是否锁定飞机？', 460);
    this.label(card, 'ReactionHint', binding ? '选择一架飞机与敌机绑定同行，本局仅一次。\n主动移动或越过返家检查点时脱离。' : `最多选择 ${reaction.capacity} 架。锁定仍计为被击落。\n原格清空后，选原始骰点 3 或 4 可解锁移动。`, 0, height / 2 - 105, width - 40, 64, 18);
    this.countdown = this.label(card, 'ReactionCountdown', '', 0, height / 2 - 164, width - 32, 28, 17, new Color('#f8d776'));
    reaction.pieceIds.forEach((id, index) => this.button(card, `Lock-${id}`, `${this.locks.has(id) ? '☑' : '□'}  ${binding ? '英国' : '法国'} ${id.split('-').pop()} 号飞机`,
      (index % 2 === 0 ? -1 : 1) * width * .23, height / 2 - 219 - Math.floor(index / 2) * 51, width * .43,
      () => { if (this.locks.has(id)) this.locks.delete(id); else if (this.locks.size < reaction.capacity) this.locks.add(id); this.renderReaction(); }, !this.busy, this.locks.has(id)));
    const respond = (ids: string[]): void => { this.emit({ type: 'cast', skillId: binding ? 'uk-bind' : 'fr-lock', reactionId: reaction.id, targetPieceIds: ids }); };
    this.button(card, 'DeclineLock', binding ? '放弃绑定' : '不锁定', -width * .23, -height / 2 + 52, width * .4, () => respond([]), !this.busy);
    this.button(card, 'ConfirmLocks', `${binding ? '绑定' : '锁定'}所选（${this.locks.size}）`, width * .23, -height / 2 + 52, width * .4, () => respond(Array.from(this.locks)), !this.busy && this.locks.size > 0);
    this.update();
  }
  private remove(): void {
    this.countdown = null;
    if (this.root?.isValid) { this.root.active = false; this.root.removeFromParent(); this.root.destroy(); }
    this.root = null;
  }
  private frame(title: string, desiredHeight = 620): { card: Node; width: number; height: number } {
    this.remove();
    const size = view.getVisibleSize(), width = Math.min(680, size.width - 28), height = Math.min(desiredHeight, size.height - 24);
    const overlay = this.node(`Skills-${this.mode}`, this.parent, size.width, size.height);
    overlay.addComponent(BlockInputEvents); this.root = overlay;
    const shade = overlay.addComponent(Graphics); shade.fillColor = new Color(5, 15, 27, 222); shade.rect(-size.width / 2, -size.height / 2, size.width, size.height); shade.fill();
    const card = this.node('SkillCard', overlay, width, height);
    const bg = card.addComponent(Graphics); bg.fillColor = new Color('#11283d'); bg.roundRect(-width / 2, -height / 2, width, height, 18); bg.fill();
    this.label(card, 'SkillTitle', title, this.mode === 'book' ? -35 : 0, height / 2 - 32, width - (this.mode === 'book' ? 160 : 30), 35, 23);
    return { card, width, height };
  }
  private node(name: string, parent: Node, width: number, height: number): Node {
    const node = new Node(name); node.layer = Layers.Enum.UI_2D; node.setParent(parent); node.addComponent(UITransform).setContentSize(width, height); return node;
  }
  private label(parent: Node, name: string, text: string, x: number, y: number, width: number, height: number, font: number, color = new Color('#edf4fa')): Label {
    const node = this.node(name, parent, width, height); node.setPosition(x, y);
    const label = node.addComponent(Label); label.string = text; label.fontSize = font; label.lineHeight = font + 9; label.color = color;
    label.horizontalAlign = Label.HorizontalAlign.CENTER; label.verticalAlign = Label.VerticalAlign.CENTER; label.overflow = Label.Overflow.SHRINK;
    return label;
  }
  private button(parent: Node, name: string, title: string, x: number, y: number, width: number, click: () => void, enabled = true, selected = false, height = 42, dim = false): void {
    const node = this.node(name, parent, width, height); node.setPosition(x, y);
    const bg = node.addComponent(Graphics); bg.fillColor = new Color(dim ? '#293e50' : selected ? '#986e32' : enabled ? '#287bc0' : '#293e50'); bg.roundRect(-width / 2, -height / 2, width, height, 8); bg.fill();
    const button = node.addComponent(Button); button.interactable = enabled;
    this.label(node, 'Text', title, 0, 0, width - 8, height - 4, 17, new Color(enabled && !dim ? '#edf4fa' : '#8296aa'));
    node.on(Node.EventType.TOUCH_END, () => { if (button.interactable) click(); });
  }
}
