import { BlockInputEvents, Button, Color, EditBox, Graphics, Label, Layers, Mask, Node, ScrollView, UITransform, sys, view } from 'cc';

type Kind = 'COUNTRY' | 'FEEDBACK';
interface Skill { name: string; type: string; trigger: string; description: string; cooldown: string; }
const TYPES = [['NORMAL', '普通技能'], ['LIMITED', '限定技能'], ['COOLDOWN', 'CD 技能'], ['AWAKENING', '觉醒技能']];
const blankSkill = (): Skill => ({ name: '', type: 'NORMAL', trigger: '', description: '', cooldown: '' });

/** Cocos UI also works in the mini-game. Keep input nodes alive across close/rotation. */
export class SubmissionDialog {
  public readonly root: Node;
  private readonly card: Node;
  private readonly inputs = new Map<string, EditBox>();
  private readonly countryGroup: Node;
  private readonly feedbackGroup: Node;
  private readonly notice: Label;
  private readonly title: Label;
  private readonly skillIndex: Label;
  private readonly typeLabel: Label;
  private readonly typeMenu: Node;
  private readonly review: Node;
  private readonly reviewText: Label;
  private readonly reviewScroll: ScrollView;
  private readonly sendButton: Button;
  private readonly reviewStatus: Label;
  private kind: Kind = 'COUNTRY';
  private account = '';
  private skills: Skill[] = [blankSkill()];
  private index = 0;
  private pending = false;
  private sealed = false;
  private submissionId = '';
  private submittedDraft: Record<string, unknown> | null = null;
  private timeout: ReturnType<typeof setTimeout> | undefined;

  public constructor(parent: Node, private readonly send: (data: Record<string, unknown>) => void) {
    this.root = this.node('SubmissionDialog', parent, 0, 0); this.root.addComponent(BlockInputEvents);
    this.card = this.node('SubmissionCard', this.root, 640, 650); this.panel(this.card, 640, 650, '#eff5fc');
    this.title = this.label('SubmissionTitle', this.card, 'DIY新的国家卡片', 0, 286, 510, 38, 28);
    this.button('CloseSubmission', this.card, '×', 285, 290, 44, () => this.close());
    this.countryGroup = this.node('CountryForm', this.card, 600, 450);
    this.input('CountryName', this.countryGroup, '国家名称（必填，30 字以内）', 245, 44, 30);
    this.input('CountryDescription', this.countryGroup, '国家介绍（可选，300 字以内）', 189, 52, 300, true);
    this.skillIndex = this.label('SkillIndex', this.countryGroup, '', 0, 136, 170, 34, 21);
    this.button('PreviousSkill', this.countryGroup, '上一项', -225, 136, 110, () => this.navigate(-1));
    this.button('NextSkill', this.countryGroup, '下一项', -100, 136, 110, () => this.navigate(1));
    this.button('AddSkill', this.countryGroup, '+ 技能', 100, 136, 110, () => { if (this.skills.length < 6) { this.save(); this.skills.push(blankSkill()); this.index = this.skills.length - 1; this.renderSkill(); } });
    this.button('DeleteSkill', this.countryGroup, '删除', 225, 136, 110, () => { if (this.skills.length > 1) { this.skills.splice(this.index, 1); this.index = Math.min(this.index, this.skills.length - 1); this.renderSkill(); this.save(); } });
    this.input('SkillName', this.countryGroup, '技能名称（必填，30 字以内）', 83, 44, 30);
    const typeButton = this.button('SkillType', this.countryGroup, '', -170, 31, 220, () => { this.typeMenu.active = !this.typeMenu.active; this.typeMenu.setSiblingIndex(-1); });
    this.typeLabel = typeButton.node.getComponentInChildren(Label)!;
    this.label('TypeHint', this.countryGroup, '选择技能类型 ▾', 130, 31, 285, 36, 20).node.on(Node.EventType.TOUCH_END, () => { this.typeMenu.active = !this.typeMenu.active; this.typeMenu.setSiblingIndex(-1); });
    this.input('SkillTrigger', this.countryGroup, '触发条件（可选，100 字以内）', -21, 44, 100);
    this.input('SkillCooldown', this.countryGroup, 'CD 规则（例如：每 3 个正常回合一次）', -73, 44, 60);
    this.input('SkillDescription', this.countryGroup, '技能效果（必填，600 字以内）', -158, 110, 600, true);
    this.typeMenu = this.node('SkillTypeMenu', this.countryGroup, 230, 190); this.typeMenu.setPosition(-170, -82);
    this.typeMenu.addComponent(BlockInputEvents); this.panel(this.typeMenu, 230, 190, '#dceafb');
    TYPES.forEach(([type, name], i) => this.button(`Type-${type}`, this.typeMenu, name, 0, 68 - i * 45, 218, () => {
      this.skills[this.index].type = type; this.typeMenu.active = false; this.updateType(); this.save();
    })); this.typeMenu.active = false;
    this.feedbackGroup = this.node('FeedbackForm', this.card, 600, 480);
    this.label('FeedbackHint', this.feedbackGroup, '遇到了什么问题？也欢迎提出建议。', 0, 226, 550, 44, 22);
    this.input('FeedbackContent', this.feedbackGroup, '请描述问题、操作步骤或改进建议（1–3000 字）', 20, 350, 3000, true);
    this.notice = this.label('SubmissionNotice', this.card, '草稿自动保存在当前设备', 0, -239, 580, 38, 18);
    this.button('PreviewSubmission', this.card, '预览并提交', 0, -285, 220, () => this.preview());
    this.review = this.node('SubmissionReview', this.card, 640, 650); this.panel(this.review, 640, 650, '#eff5fc'); this.review.addComponent(BlockInputEvents);
    this.label('ReviewTitle', this.review, '确认投稿内容', 0, 282, 540, 40, 28);
    this.label('ReviewRecipient', this.review, '发送至 skillludoadapter@163.com · 附带登录账号', 0, 240, 590, 35, 18);
    const viewport = this.node('ReviewViewport', this.review, 590, 390); viewport.setPosition(0, 20); viewport.addComponent(Mask);
    const content = this.node('ReviewContent', viewport, 565, 390); content.getComponent(UITransform)!.setAnchorPoint(0.5, 1); content.setPosition(0, 195);
    this.reviewText = this.label('ReviewText', content, '', 0, 0, 565, 390, 21);
    this.reviewText.node.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
    this.reviewText.horizontalAlign = Label.HorizontalAlign.LEFT; this.reviewText.verticalAlign = Label.VerticalAlign.TOP; this.reviewText.overflow = Label.Overflow.RESIZE_HEIGHT;
    this.reviewScroll = viewport.addComponent(ScrollView); this.reviewScroll.content = content; this.reviewScroll.horizontal = false;
    this.reviewStatus = this.label('SubmissionResult', this.review, '', 0, -227, 580, 85, 18);
    this.button('EditSubmission', this.review, '返回编辑', -160, -287, 160, () => { if (!this.pending) { this.review.active = false; } });
    this.sendButton = this.button('SendSubmission', this.review, '提交', 40, -287, 150, () => this.submit());
    this.button('CloseReview', this.review, '关闭', 230, -287, 100, () => this.close());
    this.review.active = false; this.root.active = false;
    view.on('canvas-resize', this.resize, this); view.on('design-resolution-changed', this.resize, this);
  }
  public open(kind: Kind, accountId: string): void {
    if (!accountId.startsWith('u_')) return;
    if (this.pending) { this.root.active = true; this.root.setSiblingIndex(-1); return; }
    if (this.root.active) this.save();
    if (this.account !== accountId || this.kind !== kind) {
      this.account = accountId; this.kind = kind; this.index = 0; this.skills = [blankSkill()];
      this.inputs.forEach((input) => { input.string = ''; });
      try {
        const saved = JSON.parse(sys.localStorage.getItem(this.key) || 'null');
        if (saved?.draft) {
          const draft = saved.draft;
          this.inputs.get('CountryName')!.string = draft.country?.name || '';
          this.inputs.get('CountryDescription')!.string = draft.country?.description || '';
          this.inputs.get('FeedbackContent')!.string = draft.content || '';
          if (draft.country?.skills?.length) this.skills = draft.country.skills.slice(0, 6);
        }
        this.submissionId = saved?.id || ''; this.submittedDraft = saved?.submittedDraft || null; this.sealed = !!saved?.sealed;
      } catch { this.submissionId = ''; this.submittedDraft = null; this.sealed = false; }
      this.review.active = false;
      this.reviewStatus.string = '';
    }
    this.title.string = kind === 'COUNTRY' ? 'DIY新的国家卡片' : '反馈';
    this.countryGroup.active = kind === 'COUNTRY'; this.feedbackGroup.active = kind === 'FEEDBACK';
    this.root.active = true; this.root.setSiblingIndex(-1); this.renderSkill(); this.resize();
  }
  public close(): void { this.save(); this.root.active = false; }
  public destroy(): void { clearTimeout(this.timeout); view.off('canvas-resize', this.resize, this); view.off('design-resolution-changed', this.resize, this); this.root.destroy(); }
  public result(data: { id?: string; status?: string; message: string }): void {
    if (data.id && data.id !== this.submissionId) return;
    clearTimeout(this.timeout); this.pending = false;
    this.sealed = data.status !== 'ERROR'; this.sendButton.interactable = !this.sealed;
    this.reviewStatus.string = `${data.message}${data.id ? `\n编号：${data.id}` : ''}`; this.save();
  }
  private get key(): string { return `skillLudo.submission.${this.account}.${this.kind}`; }
  private navigate(delta: number): void { this.save(); this.index = Math.max(0, Math.min(this.skills.length - 1, this.index + delta)); this.renderSkill(); }
  private renderSkill(): void {
    const skill = this.skills[this.index];
    for (const [name, key] of [['SkillName', 'name'], ['SkillTrigger', 'trigger'], ['SkillDescription', 'description'], ['SkillCooldown', 'cooldown']]) this.inputs.get(name)!.string = skill[key as keyof Skill] || '';
    this.skillIndex.string = `${this.index + 1} / ${this.skills.length}`; this.updateType();
  }
  private updateType(): void {
    this.typeLabel.string = TYPES.find(([type]) => type === this.skills[this.index].type)?.[1] || '普通技能';
    this.inputs.get('SkillCooldown')!.node.active = this.skills[this.index].type === 'COOLDOWN';
  }
  private draft(): Record<string, unknown> {
    const skill = this.skills[this.index];
    skill.name = this.inputs.get('SkillName')!.string.trim(); skill.trigger = this.inputs.get('SkillTrigger')!.string.trim();
    skill.description = this.inputs.get('SkillDescription')!.string.trim(); skill.cooldown = skill.type === 'COOLDOWN' ? this.inputs.get('SkillCooldown')!.string.trim() : '';
    return this.kind === 'COUNTRY' ? { kind: this.kind, country: { name: this.inputs.get('CountryName')!.string.trim(), description: this.inputs.get('CountryDescription')!.string.trim(), skills: this.skills.map((s) => ({ ...s })) } }
      : { kind: this.kind, content: this.inputs.get('FeedbackContent')!.string.trim() };
  }
  private save(): void {
    if (!this.account) return;
    try { sys.localStorage.setItem(this.key, JSON.stringify({ draft: this.draft(), id: this.submissionId, submittedDraft: this.submittedDraft, sealed: this.sealed })); } catch { this.notice.string = '设备无法保存草稿，请提交前保留内容'; }
  }
  private preview(): void {
    this.save(); const draft = this.draft();
    if (encodeURIComponent(JSON.stringify(draft)).replace(/%[A-F\d]{2}/gi, 'x').length > 12000) { this.notice.string = '内容过长，请将整份投稿控制在约 3500 个汉字以内'; return; }
    const country = draft.country as { name: string; description: string; skills: Skill[] } | undefined;
    if (country ? !country.name || country.skills.some((s) => !s.name || !s.description || (s.type === 'COOLDOWN' && !s.cooldown)) : !draft.content) { this.notice.string = '请填写国家名称、每项技能名称和效果；CD 技能需填写冷却规则'; if (!country) this.notice.string = '请填写反馈内容'; return; }
    // A changed draft is a new submission. Reopening/retrying the same draft
    // keeps its ID across reconnects, so lost acknowledgements never duplicate mail.
    if (JSON.stringify(draft) !== JSON.stringify(this.submittedDraft)) {
      this.submissionId = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      this.submittedDraft = draft; this.sealed = false; this.reviewStatus.string = '';
    }
    this.sendButton.interactable = !this.pending && !this.sealed;
    if (this.sealed && !this.reviewStatus.string) this.reviewStatus.string = '该内容已有提交记录；如需修改，请返回编辑。';
    this.reviewText.string = country ? `${country.name}\n${country.description}\n\n${country.skills.map((s, i) => `${i + 1}. ${s.name} · ${TYPES.find(([t]) => t === s.type)?.[1]}\n触发：${s.trigger || '见效果描述'}\n效果：${s.description}${s.cooldown ? `\n冷却：${s.cooldown}` : ''}`).join('\n\n')}` : String(draft.content);
    this.review.active = true; this.reviewText.updateRenderData(true);
    this.reviewScroll.content!.getComponent(UITransform)!.height = Math.max(390, this.reviewText.node.getComponent(UITransform)!.height);
    this.reviewScroll.scrollToTop(0); this.save();
  }
  private submit(): void {
    if (this.pending || this.sealed || !this.submittedDraft) return;
    this.pending = true; this.sendButton.interactable = false; this.reviewStatus.string = '正在保存并发送，请稍候…'; this.save();
    this.timeout = setTimeout(() => this.result({ status: 'ERROR', message: '暂未收到确认；可再次点击提交查询，同一编号不会重复发信' }), 45000);
    this.send({ id: this.submissionId, draft: this.submittedDraft });
  }
  private resize(): void {
    const size = view.getVisibleSize(); this.root.getComponent(UITransform)!.setContentSize(size);
    const shade = this.root.getComponent(Graphics) || this.root.addComponent(Graphics); shade.clear(); shade.fillColor = new Color(10, 28, 50, 175); shade.rect(-size.width / 2, -size.height / 2, size.width, size.height); shade.fill();
    const scale = Math.min(1.2, (size.width - 28) / 640, (size.height - 28) / 650); this.card.setScale(scale, scale, 1);
  }
  private node(name: string, parent: Node, width: number, height: number): Node { const node = new Node(name); node.layer = Layers.Enum.UI_2D; node.setParent(parent); node.addComponent(UITransform).setContentSize(width, height); return node; }
  private panel(node: Node, width: number, height: number, color: string): void { const g = node.addComponent(Graphics); g.fillColor = new Color(color); g.roundRect(-width / 2, -height / 2, width, height, 12); g.fill(); }
  private label(name: string, parent: Node, value: string, x: number, y: number, width: number, height: number, font = 21): Label {
    const node = this.node(name, parent, width, height); node.setPosition(x, y); const label = node.addComponent(Label);
    label.string = value; label.fontSize = font; label.lineHeight = font + 6; label.color = new Color('#284868'); label.horizontalAlign = Label.HorizontalAlign.CENTER; label.verticalAlign = Label.VerticalAlign.CENTER; label.overflow = Label.Overflow.SHRINK; return label;
  }
  private button(name: string, parent: Node, text: string, x: number, y: number, width: number, action: () => void): Button {
    const node = this.node(name, parent, width, 40); node.setPosition(x, y); this.panel(node, width, 40, '#d1e4f6'); this.label(`${name}Text`, node, text, 0, 0, width - 8, 38);
    const button = node.addComponent(Button); node.on(Button.EventType.CLICK, action); return button;
  }
  private input(name: string, parent: Node, hint: string, y: number, height: number, max: number, multiline = false): EditBox {
    const node = this.node(name, parent, 570, height); node.active = false; node.setPosition(0, y); this.panel(node, 570, height, '#ffffff');
    const text = this.label(`${name}Text`, node, '', 0, 0, 548, height - 8, 22), placeholder = this.label(`${name}Hint`, node, '', 0, 0, 548, height - 8, 20);
    for (const label of [text, placeholder]) { label.node.getComponent(UITransform)!.setAnchorPoint(0, 1); label.horizontalAlign = Label.HorizontalAlign.LEFT; label.verticalAlign = multiline ? Label.VerticalAlign.TOP : Label.VerticalAlign.CENTER; label.overflow = Label.Overflow.CLAMP; }
    placeholder.color = new Color('#8398ad');
    const input = node.addComponent(EditBox); input.inputMode = multiline ? EditBox.InputMode.ANY : EditBox.InputMode.SINGLE_LINE; input.inputFlag = EditBox.InputFlag.DEFAULT;
    input.textLabel = text; input.placeholderLabel = placeholder; input.placeholder = hint; input.maxLength = max;
    ['TEXT_LABEL', 'PLACEHOLDER_LABEL'].forEach((key) => node.getChildByName(key)?.destroy()); node.active = true;
    node.on(EditBox.EventType.TEXT_CHANGED, () => this.save()); this.inputs.set(name, input); return input;
  }
}
