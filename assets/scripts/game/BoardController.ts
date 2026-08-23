import { _decorator, Canvas, Color, Component, EventTouch, Graphics, js, Label, Layers, Node, resources, Sprite, SpriteFrame, tween, UITransform, Vec3 } from 'cc';
import { BoardLayout } from './BoardLayout';
import type { BoardCalibrationData, BoardCalibrationOpen, GameSnapshot, MoveResult, Piece, PieceState, PlayerColor } from '../protocol/GameProtocol';

const { ccclass, property } = _decorator;
const pieceColors: Record<PlayerColor, Color> = {
  RED: new Color(232, 73, 73), YELLOW: new Color(241, 190, 55),
  BLUE: new Color(65, 142, 234), GREEN: new Color(78, 177, 94)
};

/** A client-only visual hint. The server remains the sole authority for moves. */
export interface MovePreview {
  pieceId: string;
  color: PlayerColor;
  dice: number;
  destination: Vec3;
  description: string;
}

/** Renders server snapshots and replays server-authorized MoveResult paths. */
@ccclass('BoardController')
export class BoardController extends Component {
  @property(Node)
  public boardRoot: Node | null = null;

  private readonly pieceNodes = new Map<string, Node>();
  private readonly pieces = new Map<string, Piece>();
  private readonly previewPieceColors = new Map<string, PlayerColor>();
  private pendingSnapshot: GameSnapshot | null = null;
  private animating = false;
  private renderRoot: Node | null = null;
  private moveTarget: Node | null = null;
  private selectedPieceId = '';
  private movablePieceIds = new Set<string>();
  private boardVisible = true;
  private calibrationMarker: Node | null = null;
  private calibrationConfirm: Node | null = null;
  private calibrationTarget: BoardCalibrationOpen | null = null;

  public onLoad(): void {
    // Manually created children default to DEFAULT. Canvas only draws UI_2D by default.
    this.applyUiLayer(this.node);
    if (this.boardRoot) this.applyUiLayer(this.boardRoot);
    this.loadBoardArtwork();
    this.createAirportPreviewPieces();
  }

  public applySnapshot(snapshot: GameSnapshot): void {
    if (this.animating) {
      this.pendingSnapshot = snapshot;
      return;
    }
    this.renderSnapshot(snapshot);
  }

  public applyCalibrationData(data: BoardCalibrationData): void { BoardLayout.setCalibrationData(data); }

  /** The lobby is a dedicated home screen; the board appears when a match starts. */
  public setBoardVisible(visible: boolean): void {
    this.boardVisible = visible;
    if (this.renderRoot?.isValid) this.renderRoot.active = visible;
  }

  public async playMove(result: MoveResult): Promise<void> {
    this.clearMovePreview();
    const piece = this.pieces.get(result.pieceId);
    const node = this.pieceNodes.get(result.pieceId);
    if (!piece || !node || this.animating) return;
    this.animating = true;
    for (const progress of result.path) {
      // A bounced move briefly touches the final square, but it has not
      // completed until the final MoveResult destination is 57.
      const state = progress >= 57 && result.toProgress === 57 ? 'FINISHED' : progress >= 52 ? 'FINAL_PATH' : 'MAIN_PATH';
      await this.moveNode(node, BoardLayout.piecePosition(piece.color, progress, state));
    }
    this.animating = false;
    if (this.pendingSnapshot) {
      const snapshot = this.pendingSnapshot;
      this.pendingSnapshot = null;
      this.renderSnapshot(snapshot);
    }
  }

  public setMovablePieces(pieceIds: string[]): void {
    this.movablePieceIds = new Set(pieceIds);
    for (const [id, node] of this.pieceNodes) {
      const movable = this.movablePieceIds.has(id);
      node.setScale(movable ? new Vec3(id === this.selectedPieceId ? 1.38 : 1.24, id === this.selectedPieceId ? 1.38 : 1.24, 1) : Vec3.ONE);
      this.setPieceGlow(node, movable, pieceColors[this.previewPieceColors.get(id) ?? this.pieces.get(id)?.color ?? 'RED']);
    }
  }

  /** Shows the exact server-rule destination before the player confirms the move. */
  public showMovePreview(pieceId: string, dice: number): MovePreview | null {
    const piece = this.pieces.get(pieceId);
    if (!piece || !this.movablePieceIds.has(pieceId) || !Number.isInteger(dice) || dice < 1 || dice > 6) return null;

    const result = this.previewResult(piece, dice);
    if (!result) return null;
    this.selectedPieceId = pieceId;
    const target = BoardLayout.piecePosition(piece.color, result.progress, result.state);
    this.showMoveTarget(target, pieceColors[piece.color]);
    this.setMovablePieces([...this.movablePieceIds]);
    return {
      pieceId,
      color: piece.color,
      dice,
      destination: target,
      description: result.description
    };
  }

  public clearMovePreview(): void {
    this.selectedPieceId = '';
    if (this.moveTarget?.isValid) this.moveTarget.active = false;
    this.setMovablePieces([...this.movablePieceIds]);
  }

  /** Admin-only visual calibration uses one draggable black aircraft. */
  public startCalibration(target: BoardCalibrationOpen): void {
    this.calibrationTarget = target;
    this.setBoardVisible(true);
    const root = this.getRenderRoot();
    if (!this.calibrationMarker?.isValid) {
      const marker = new Node('BoardCalibrationMarker');
      marker.setParent(root);
      marker.layer = Layers.Enum.UI_2D;
      marker.addComponent(UITransform).setContentSize(52, 52);
      this.drawPlane(marker.addComponent(Graphics), new Color(25, 25, 28), false);
      marker.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => this.moveCalibrationMarker(event));
      marker.on(Node.EventType.TOUCH_END, () => this.showCalibrationConfirmation());
      this.calibrationMarker = marker;
    }
    const stored = target.position ? new Vec3(target.position.x, target.position.y, 0) : BoardLayout.calibrationPosition(target.key);
    this.calibrationMarker.setPosition(stored);
    this.calibrationMarker.active = true;
    this.calibrationMarker.setSiblingIndex(root.children.length - 1);
    if (this.calibrationConfirm?.isValid) this.calibrationConfirm.active = false;
  }

  public stopCalibration(): void {
    this.calibrationTarget = null;
    if (this.calibrationMarker?.isValid) this.calibrationMarker.active = false;
    if (this.calibrationConfirm?.isValid) this.calibrationConfirm.active = false;
  }

  private renderSnapshot(snapshot: GameSnapshot): void {
    if (this.selectedPieceId && (snapshot.phase !== 'WAIT_SELECT_PIECE' || snapshot.movablePieceIds.indexOf(this.selectedPieceId) < 0)) this.clearMovePreview();
    this.pieces.clear();
    snapshot.pieces.forEach((piece) => this.pieces.set(piece.id, piece));
    snapshot.pieces.forEach((piece, index) => {
      const node = this.getOrCreatePieceNode(piece);
      const stackIndex = this.stackIndex(piece, snapshot.pieces, index);
      const stackCount = this.stackCount(piece, snapshot.pieces);
      node.setPosition(BoardLayout.piecePosition(piece.color, piece.progress, piece.state, stackIndex));
      this.updatePieceAppearance(node, piece, stackCount);
      node.active = true;
    });
    const occupiedColors = new Set(snapshot.pieces.map((piece) => piece.color));
    for (const [id, node] of this.pieceNodes) {
      const previewColor = this.previewPieceColors.get(id);
      if (previewColor) {
        // Empty airports remain visually complete until a player of that colour joins.
        node.active = !occupiedColors.has(previewColor);
      } else if (!this.pieces.has(id)) {
        node.active = false;
      }
    }
    this.setMovablePieces(snapshot.movablePieceIds);
  }

  /** Keep all sixteen planes visible in the lobby instead of showing an empty board. */
  private createAirportPreviewPieces(): void {
    for (const color of Object.keys(pieceColors) as PlayerColor[]) {
      for (let index = 0; index < 4; index += 1) {
        const id = `preview-${color}-${index}`;
        this.previewPieceColors.set(id, color);
        const node = this.getOrCreatePieceNode({ id, playerId: 'preview', color, state: 'AIRPORT', progress: -1 });
        node.setPosition(BoardLayout.airportPosition(color, index));
        node.active = true;
      }
    }
  }

  private getOrCreatePieceNode(piece: Piece): Node {
    const existing = this.pieceNodes.get(piece.id);
    if (existing) return existing;
    const root = this.getRenderRoot();
    const node = new Node(piece.id);
    node.setParent(root);
    node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform).setContentSize(38, 38);
    const graphics = node.addComponent(Graphics);
    this.drawPlane(graphics, pieceColors[piece.color], piece.state === 'FINISHED');
    // renderRoot is a Canvas child, not a child of this controller node. Emit
    // from the controller so GameController's listener receives plane taps.
    if (!this.previewPieceColors.has(piece.id)) node.on(Node.EventType.TOUCH_END, () => this.node.emit('piece-selected', piece.id));
    this.pieceNodes.set(piece.id, node);
    return node;
  }

  /** Mirrors GameRules.calculateMove for display only; it never changes game state. */
  private previewResult(piece: Piece, dice: number): { progress: number; state: PieceState; description: string } | null {
    if (piece.state === 'AIRPORT' && dice !== 5 && dice !== 6) return null;
    if (piece.state === 'FINISHED') return null;

    let progress = piece.state === 'AIRPORT' ? 0 : piece.progress;
    const events: string[] = [piece.state === 'AIRPORT' ? '起飞至起点' : `前进 ${dice} 格`];
    if (piece.state !== 'AIRPORT') {
      let direction = 1;
      for (let step = 0; step < dice; step += 1) {
        if (progress === 57) direction = -1;
        progress += direction;
      }
      if (piece.progress + dice > 57) events.push('越过终点后折返');
    }
    // The server's colour-specific cells are route-relative: same-colour cells
    // occur every four positions, while each colour's flight trigger is 18.
    if (piece.state !== 'AIRPORT' && progress < 52 && progress % 4 === 0 && progress + 4 < 52) {
      progress += 4;
      events.push('触发同色跳跃');
    }
    if (progress < 52 && progress === 18) {
      progress += 12;
      events.push('进入飞行通道');
    }
    const state: PieceState = progress === 57 ? 'FINISHED' : progress >= 52 ? 'FINAL_PATH' : 'MAIN_PATH';
    if (state === 'FINISHED') events.push('抵达终点');
    else if (state === 'FINAL_PATH') events.push('进入终点航道');
    return { progress, state, description: events.join('，') };
  }

  private setPieceGlow(pieceNode: Node, active: boolean, color: Color): void {
    let glow = pieceNode.getChildByName('MovableGlow');
    if (!glow) {
      glow = new Node('MovableGlow');
      glow.setParent(pieceNode);
      glow.layer = Layers.Enum.UI_2D;
      glow.addComponent(UITransform).setContentSize(60, 60);
      const graphics = glow.addComponent(Graphics);
      graphics.lineWidth = 3;
      graphics.circle(0, 0, 25);
      graphics.stroke();
      graphics.lineWidth = 1.5;
      graphics.circle(0, 0, 29);
      graphics.stroke();
      glow.setSiblingIndex(0);
    }
    const graphics = glow.getComponent(Graphics);
    if (graphics) {
      graphics.clear();
      graphics.strokeColor = new Color(color.r, color.g, color.b, 255);
      graphics.lineWidth = 3;
      graphics.circle(0, 0, 25);
      graphics.stroke();
      graphics.lineWidth = 1.5;
      graphics.circle(0, 0, 29);
      graphics.stroke();
    }
    glow.active = active;
  }

  private moveCalibrationMarker(event: EventTouch): void {
    if (!this.calibrationMarker?.isValid) return;
    const location = event.getUILocation();
    const transform = this.getRenderRoot().getComponent(UITransform);
    const local = transform?.convertToNodeSpaceAR(new Vec3(location.x, location.y, 0));
    if (!local) return;
    this.calibrationMarker.setPosition(
      Math.max(-350, Math.min(350, local.x)),
      Math.max(-350, Math.min(350, local.y)),
      0
    );
    if (this.calibrationConfirm?.isValid) this.calibrationConfirm.active = false;
  }

  private showCalibrationConfirmation(): void {
    const marker = this.calibrationMarker;
    const target = this.calibrationTarget;
    if (!marker?.isValid || !target) return;
    const root = this.getRenderRoot();
    if (this.calibrationConfirm?.isValid) this.calibrationConfirm.destroy();
    const panel = new Node('CalibrationConfirm');
    panel.setParent(root);
    panel.layer = Layers.Enum.UI_2D;
    panel.addComponent(UITransform).setContentSize(196, 82);
    const x = Math.max(-250, Math.min(250, marker.position.x + 108));
    const y = Math.max(-305, Math.min(305, marker.position.y + 58));
    panel.setPosition(x, y, 0);
    const graphics = panel.addComponent(Graphics);
    graphics.fillColor = new Color(255, 244, 192, 250);
    graphics.roundRect(-98, -41, 196, 82, 8);
    graphics.fill();
    graphics.strokeColor = new Color(48, 48, 48, 255);
    graphics.lineWidth = 1.5;
    graphics.roundRect(-98, -41, 196, 82, 8);
    graphics.stroke();
    this.addCalibrationLabel(panel, 'ConfirmText', `确认 ${target.key}\n(${marker.position.x.toFixed(1)}, ${marker.position.y.toFixed(1)})`, new Vec3(0, 17), 184, 38, 14);
    const cancel = this.addCalibrationButton(panel, '重摆', new Vec3(-45, -23), new Color(112, 120, 132));
    cancel.on(Node.EventType.TOUCH_END, () => { panel.active = false; });
    const confirm = this.addCalibrationButton(panel, '确认', new Vec3(45, -23), new Color(45, 135, 79));
    confirm.on(Node.EventType.TOUCH_END, () => {
      panel.active = false;
      this.node.emit('calibration-save', {
        key: target.key,
        x: marker.position.x,
        y: marker.position.y,
        single: target.single
      });
    });
    panel.setSiblingIndex(root.children.length - 1);
    this.calibrationConfirm = panel;
  }

  private addCalibrationButton(parent: Node, title: string, position: Vec3, color: Color): Node {
    const node = new Node(`${title}CalibrationButton`);
    node.setParent(parent);
    node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform).setContentSize(72, 28);
    node.setPosition(position);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = color;
    graphics.roundRect(-36, -14, 72, 28, 5);
    graphics.fill();
    this.addCalibrationLabel(node, 'Text', title, Vec3.ZERO, 68, 24, 13, Color.WHITE);
    return node;
  }

  private addCalibrationLabel(parent: Node, name: string, value: string, position: Vec3, width: number, height: number, fontSize: number, color = new Color(28, 28, 28)): Label {
    const node = new Node(name);
    node.setParent(parent);
    node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform).setContentSize(width, height);
    node.setPosition(position);
    const label = node.addComponent(Label);
    label.string = value;
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 3;
    label.color = color;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    return label;
  }

  private showMoveTarget(position: Vec3, color: Color): void {
    const root = this.getRenderRoot();
    if (!this.moveTarget?.isValid) {
      this.moveTarget = new Node('MoveDestination');
      this.moveTarget.setParent(root);
      this.moveTarget.layer = Layers.Enum.UI_2D;
      this.moveTarget.addComponent(UITransform).setContentSize(74, 74);
      this.moveTarget.addComponent(Graphics);
    }
    const graphics = this.moveTarget.getComponent(Graphics);
    if (graphics) {
      graphics.clear();
      graphics.fillColor = new Color(color.r, color.g, color.b, 66);
      graphics.circle(0, 0, 32);
      graphics.fill();
      graphics.strokeColor = new Color(255, 255, 255, 255);
      graphics.lineWidth = 4;
      graphics.circle(0, 0, 28);
      graphics.stroke();
      graphics.strokeColor = new Color(color.r, color.g, color.b, 255);
      graphics.lineWidth = 3;
      graphics.circle(0, 0, 34);
      graphics.stroke();
    }
    this.moveTarget.setPosition(position);
    this.moveTarget.active = true;
    this.moveTarget.setSiblingIndex(root.children.length - 1);
  }

  /** A small, clear plane silhouette drawn in code so no aircraft sprite sheet is required. */
  private updatePieceAppearance(node: Node, piece: Piece, stackCount: number): void {
    const graphics = node.getComponent(Graphics);
    if (graphics) this.drawPlane(graphics, pieceColors[piece.color], piece.state === 'FINISHED');
    this.setStackBadge(node, piece, stackCount);
  }

  private setStackBadge(pieceNode: Node, piece: Piece, count: number): void {
    let badge = pieceNode.getChildByName('StackBadge');
    const visible = piece.state !== 'AIRPORT' && piece.state !== 'FINISHED' && count > 1;
    if (!visible) {
      if (badge) badge.active = false;
      return;
    }
    if (!badge) {
      badge = new Node('StackBadge'); badge.setParent(pieceNode); badge.layer = Layers.Enum.UI_2D; badge.addComponent(UITransform).setContentSize(20, 20); badge.setPosition(15, 14, 0);
      const graphics = badge.addComponent(Graphics); graphics.fillColor = new Color(29, 53, 90, 245); graphics.circle(0, 0, 10); graphics.fill(); graphics.strokeColor = Color.WHITE; graphics.lineWidth = 1.4; graphics.circle(0, 0, 9); graphics.stroke();
      const label = new Node('StackCount'); label.setParent(badge); label.layer = Layers.Enum.UI_2D; label.addComponent(UITransform).setContentSize(20, 18); const text = label.addComponent(Label); text.fontSize = 12; text.lineHeight = 14; text.color = Color.WHITE; text.horizontalAlign = Label.HorizontalAlign.CENTER; text.verticalAlign = Label.VerticalAlign.CENTER;
    }
    const label = badge.getComponentInChildren(Label);
    if (label) label.string = String(count);
    badge.active = true;
  }

  private drawPlane(graphics: Graphics, color: Color, finished = false): void {
    graphics.clear();
    if (finished) {
      graphics.fillColor = color;
      graphics.circle(0, 0, 17);
      graphics.fill();
      graphics.strokeColor = Color.WHITE;
      graphics.lineWidth = 2.5;
      graphics.moveTo(-8, 0); graphics.lineTo(-2, -7); graphics.lineTo(9, 8); graphics.stroke();
      graphics.strokeColor = new Color(39, 54, 78, 220);
      graphics.lineWidth = 1.6;
      graphics.circle(0, 0, 17);
      graphics.stroke();
      return;
    }
    graphics.fillColor = new Color(255, 255, 255, 235);
    graphics.circle(0, 0, 17);
    graphics.fill();
    graphics.fillColor = color;
    graphics.moveTo(0, 15);
    graphics.lineTo(-5, 5);
    graphics.lineTo(-15, 2);
    graphics.lineTo(-15, -3);
    graphics.lineTo(-5, -2);
    graphics.lineTo(-5, -12);
    graphics.lineTo(5, -12);
    graphics.lineTo(5, -2);
    graphics.lineTo(15, -3);
    graphics.lineTo(15, 2);
    graphics.lineTo(5, 5);
    graphics.close();
    graphics.fill();
    graphics.strokeColor = new Color(39, 54, 78, 220);
    graphics.lineWidth = 1.6;
    graphics.circle(0, 0, 17);
    graphics.stroke();
  }

  private drawGeneratedBoard(): void {
    const root = this.getRenderRoot();
    const graphics = root.getComponent(Graphics) ?? root.addComponent(Graphics);
    graphics.clear();
    for (let index = 0; index < 52; index += 1) {
      const color = index % 13 === 0 ? pieceColors.RED : new Color(238, 242, 247);
      const angle = Math.PI / 2 - index * (Math.PI * 2 / 52);
      graphics.fillColor = color;
      graphics.circle(Math.cos(angle) * 225, Math.sin(angle) * 225, 11);
      graphics.fill();
    }
    for (const color of Object.keys(pieceColors) as PlayerColor[]) {
      for (let index = 0; index < 4; index += 1) {
        const position = BoardLayout.airportPosition(color, index);
        graphics.fillColor = pieceColors[color];
        graphics.circle(position.x, position.y, 17);
        graphics.fill();
      }
    }
  }

  /** Loads the project-owned classic board texture; circles remain as a safe fallback while importing assets. */
  private loadBoardArtwork(): void {
    resources.load('textures/ludo-classic-board-cropped/spriteFrame', SpriteFrame, (error, frame) => {
      if (error || !frame) {
        console.warn('未找到棋盘美术资源，已使用代码占位棋盘。', error);
        this.drawGeneratedBoard();
        return;
      }
      const root = this.getRenderRoot();
      let artwork = root.getChildByName('LudoBoardArtwork');
      if (!artwork) {
        artwork = new Node('LudoBoardArtwork');
        artwork.setParent(root);
        artwork.layer = Layers.Enum.UI_2D;
        artwork.addComponent(UITransform).setContentSize(720, 720);
        artwork.addComponent(Sprite);
      }
      const sprite = artwork.getComponent(Sprite);
      if (sprite) {
        sprite.spriteFrame = frame;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        artwork.getComponent(UITransform)?.setContentSize(720, 720);
      }
      artwork.setSiblingIndex(0);
    });
  }

  private stackIndex(piece: Piece, pieces: Piece[], ownIndex: number): number {
    const matching = pieces.filter((candidate) => candidate.state === piece.state && candidate.color === piece.color && candidate.progress === piece.progress);
    return matching.findIndex((candidate) => candidate.id === pieces[ownIndex].id);
  }

  private stackCount(piece: Piece, pieces: Piece[]): number {
    return pieces.filter((candidate) => candidate.state === piece.state && candidate.color === piece.color && candidate.progress === piece.progress).length;
  }

  private moveNode(node: Node, position: Vec3): Promise<void> {
    return new Promise((resolve) => tween(node).to(0.11, { position }).call(() => resolve()).start());
  }

  private applyUiLayer(node: Node): void {
    node.layer = Layers.Enum.UI_2D;
    node.children.forEach((child) => this.applyUiLayer(child));
  }

  /**
   * Do not render under the manually arranged script node. A dedicated direct
   * Canvas child avoids accidental local offsets/layers in an empty new scene.
   */
  private getRenderRoot(): Node {
    if (this.renderRoot?.isValid) return this.renderRoot;
    const canvas = this.findCanvasNode();
    const root = new Node('LudoRuntimeBoard');
    root.setParent(canvas);
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(720, 720);
    root.setPosition(Vec3.ZERO);
    root.active = this.boardVisible;
    this.renderRoot = root;
    return root;
  }

  private findCanvasNode(): Node {
    let current: Node | null = this.node;
    while (current) {
      if (current.getComponent(Canvas)) return current;
      current = current.parent;
    }
    return this.boardRoot ?? this.node;
  }
}

// Creator's preview scene endpoint serializes script UUIDs in expanded form.
// Register that form as an alias so runtime deserialization resolves this component.
js.setClassAlias(BoardController, '3913f1d4-1728-4ee3-a774-48036639ec13');
