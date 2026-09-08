import { _decorator, Canvas, Color, Component, Graphics, js, Label, Layers, Node, UITransform, Vec3, view } from 'cc';
import type { BoardCalibrationData, BoardCalibrationOpen, DicePair, GameSnapshot, MoveResult, Piece, PlayerColor } from '../protocol/GameProtocol';
import { BoardLayout } from './BoardLayout';
import { BOARD_COLORS, VIEW_TURNS, rotateBoard } from './BoardGeometry';
import { drawBoardArtwork } from './BoardArtwork';
import { BoardScene3D, type TokenActor } from './BoardScene3D';
import { BoardCalibrationView } from './BoardCalibrationView';
import { DiceView3D } from './DiceView3D';
import { easeOut, MotionTimeline, smooth } from './MotionTimeline';
import { gameViewport } from './GameViewport';

const { ccclass, property } = _decorator;
export interface MovePreview { pieceId: string; color: PlayerColor; dice: number; destination: Vec3; description: string; }

/** Presentation only. Rules, previews, segments and captures arrive from the
 * authority; GameController serializes messages before they reach this view. */
@ccclass('BoardController')
export class BoardController extends Component {
  @property(Node) public boardRoot: Node | null = null;
  private root!: Node;
  private artwork!: Node;
  private scene3D!: BoardScene3D;
  private dice!: DiceView3D;
  private calibration!: BoardCalibrationView;
  private timeline = new MotionTimeline();
  private actors = new Map<string, TokenActor>();
  private pieces = new Map<string, Piece>();
  private previews: Record<string, MoveResult> = {};
  private movable = new Set<string>();
  private turns = 0;
  private epoch = 0;
  private target!: Node;

  public onLoad(): void {
    let canvas: Node | null = this.node;
    while (canvas && !canvas.getComponent(Canvas)) canvas = canvas.parent;
    this.root = new Node('LudoRuntimeBoard'); this.root.setParent(canvas ?? this.boardRoot ?? this.node); this.root.layer = Layers.Enum.UI_2D;
    this.root.addComponent(UITransform).setContentSize(720, 720);
    this.artwork = drawBoardArtwork(this.root);
    this.scene3D = new BoardScene3D(this.root);
    this.dice = new DiceView3D(this.scene3D, this.timeline, (index) => this.node.emit('die-selected', index));
    this.target = new Node('MoveDestination'); this.target.setParent(this.root); this.target.layer = Layers.Enum.UI_2D;
    this.target.addComponent(UITransform).setContentSize(52, 52); this.target.addComponent(Graphics); this.target.active = false;
    this.calibration = new BoardCalibrationView(this.root, (p) => this.toView(p), (p) => this.fromView(p), (data) => this.node.emit('calibration-save', data));
    this.resize();
    view.on('canvas-resize', this.resize, this);
    view.on('design-resolution-changed', this.resize, this);
    this.setBoardVisible(false);
  }
  public update(delta: number): void { this.timeline.update(delta); }
  public onDestroy(): void {
    view.off('canvas-resize', this.resize, this);
    view.off('design-resolution-changed', this.resize, this);
    this.cancelAnimations();
    this.scene3D?.destroy();
    this.root?.destroy();
  }
  public setBoardVisible(visible: boolean): void { if (this.root) this.root.active = visible; this.scene3D?.setVisible(visible); }
  public setLocalColor(color?: PlayerColor): void {
    const next = color ? VIEW_TURNS[color] : 0;
    if (next === this.turns) return;
    this.turns = next;
    this.artwork.angle = this.turns * 90;
    this.calibration.refreshView();
  }
  public applyCalibrationData(data: BoardCalibrationData): void { BoardLayout.setCalibrationData(data); }
  public startCalibration(target: BoardCalibrationOpen): void { this.setBoardVisible(true); this.calibration.open(target); }
  public stopCalibration(): void { this.calibration?.close(); }
  public cancelAnimations(): void { this.epoch += 1; this.timeline.cancel(); this.dice?.reset(); this.clearMovePreview(); }
  public playDiceRoll(pair: DicePair, rollId: number): Promise<void> { return this.dice.throw(pair, rollId); }

  public applySnapshot(snapshot: GameSnapshot): void {
    this.previews = snapshot.movePreviews;
    this.pieces = new Map(snapshot.pieces.map((piece) => [piece.id, { ...piece }]));
    for (const [id, actor] of this.actors) this.scene3D.showActor(actor, this.pieces.has(id));
    for (const piece of snapshot.pieces) {
      const actor = this.actor(piece);
      this.scene3D.showActor(actor, true);
      const stack = snapshot.pieces.filter((p) => p.color === piece.color && p.state === piece.state && p.progress === piece.progress);
      const inAirport = piece.state === 'AIRPORT' || piece.state === 'FINISHED';
      const level = inAirport ? 0 : stack.findIndex((p) => p.id === piece.id);
      this.scene3D.place(actor, this.piecePoint(piece), level * 7, piece.state === 'FINISHED' ? 0.86 : 1);
      actor.model.setRotationFromEuler(12, -8, 0);
      const badge = actor.hit.getChildByName('Badge')!.getComponent(Label)!;
      badge.string = piece.state === 'FINISHED' ? '✓' : level > 0 && level === stack.length - 1 ? String(stack.length) : '';
      badge.color = piece.state === 'FINISHED' ? new Color('#a77713') : new Color('#ffffff');
    }
    this.dice.restore(snapshot.diceChoices, snapshot.rollId, snapshot.phase === 'WAIT_SELECT_DIE');
    this.setMovablePieces(snapshot.movablePieceIds);
  }

  public setMovablePieces(ids: string[]): void {
    this.movable = new Set(ids);
    for (const [id, actor] of this.actors) {
      const graphics = actor.hit.getComponent(Graphics)!;
      graphics.clear();
      if (!this.movable.has(id)) continue;
      const color = this.pieces.get(id)?.color ?? 'RED';
      graphics.strokeColor = new Color(BOARD_COLORS[color]); graphics.lineWidth = 2.4;
      graphics.circle(0, 0, 23); graphics.stroke();
      graphics.strokeColor = Color.WHITE; graphics.lineWidth = 1; graphics.circle(0, 0, 20); graphics.stroke();
    }
  }
  public showMovePreview(pieceId: string, dice: number): MovePreview | null {
    const piece = this.pieces.get(pieceId), result = this.previews[pieceId];
    if (!piece || !result || !this.movable.has(pieceId)) return null;
    const destination = this.toView(BoardLayout.mainPathPosition(piece.color, result.toProgress));
    const graphics = this.target.getComponent(Graphics)!;
    graphics.clear(); graphics.strokeColor = new Color(BOARD_COLORS[piece.color]); graphics.lineWidth = 4;
    graphics.circle(0, 0, 23); graphics.stroke();
    this.target.setPosition(destination); this.target.active = true;
    const details = [result.tookOff ? '起飞' : `前进 ${dice} 格`];
    if (result.jumped) details.push('同色跳跃');
    if (result.usedFlightPath) details.push('穿越虫洞');
    if (result.killedPieceIds.length) details.push(`击回 ${result.killedPieceIds.length} 架飞机`);
    if (result.reachedFinish) details.push('抵达终点');
    return { pieceId, color: piece.color, dice, destination, description: details.join(' · ') };
  }
  public clearMovePreview(): void { if (this.target) this.target.active = false; }

  public async playMove(result: MoveResult): Promise<void> {
    const piece = this.pieces.get(result.pieceId), actor = this.actors.get(result.pieceId);
    if (!piece || !actor) return;
    const epoch = this.epoch;
    this.clearMovePreview(); this.dice.hide(); this.setMovablePieces([]);
    let current = this.piecePoint(piece);
    const captureTasks: Promise<void>[] = [];
    const captured = new Set<string>();
    const capture = (id: string): void => {
      if (captured.has(id)) return;
      captured.add(id); captureTasks.push(this.capture(id, epoch));
    };
    for (const segment of result.segments) {
      const steps = segment.kind === 'WALK' ? segment.path : [segment.toProgress];
      for (const progress of steps) {
        const destination = this.toView(BoardLayout.mainPathPosition(piece.color, progress));
        const flight = segment.kind === 'FLIGHT';
        const duration = flight ? 0.9 : segment.kind === 'TAKEOFF' ? 0.55 : segment.kind === 'JUMP' ? 0.42 : 0.15;
        const height = flight ? 86 : segment.kind === 'WALK' ? 11 : 42;
        const from = current.clone();
        const heading = -Math.atan2(destination.x - from.x, destination.y - from.y) * 180 / Math.PI;
        const completed = await this.timeline.animate(duration, (t) => {
          if (epoch !== this.epoch) return;
          const u = smooth(t);
          const position = Vec3.lerp(new Vec3(), from, destination, u);
          this.scene3D.place(actor, position, Math.sin(Math.PI * t) * height);
          actor.model.setRotationFromEuler(12 + Math.sin(t * Math.PI * 2) * (flight ? 28 : 12), Math.sin(t * Math.PI) * 20, heading);
          if (flight) for (const hit of result.captures) {
            const fraction = (hit.atProgress - segment.fromProgress) / (segment.toProgress - segment.fromProgress);
            if (fraction > 0 && fraction < 1 && u >= fraction) capture(hit.pieceId);
          }
        });
        if (!completed || epoch !== this.epoch) return;
        current = destination;
      }
    }
    for (const id of result.killedPieceIds) capture(id);
    if (result.reachedFinish) {
      await this.impact(current, new Color('#e9b744'), 0.5);
      if (epoch !== this.epoch) return;
      const home = this.toView(BoardLayout.airportPosition(piece.color, this.airportIndex(piece)));
      await this.timeline.animate(0.65, (t) => this.scene3D.place(actor, Vec3.lerp(new Vec3(), current, home, smooth(t)), 72 * Math.sin(Math.PI * t), 1 - t * 0.14));
    }
    await Promise.all(captureTasks);
  }
  private async capture(id: string, epoch: number): Promise<void> {
    const actor = this.actors.get(id), piece = this.pieces.get(id);
    if (!actor || !piece) return;
    const from = this.piecePoint(piece), destination = this.toView(BoardLayout.airportPosition(piece.color, this.airportIndex(piece)));
    void this.impact(from, new Color(BOARD_COLORS[piece.color]), 0.5);
    await this.timeline.animate(0.8, (t) => {
      if (epoch !== this.epoch) return;
      const point = Vec3.lerp(new Vec3(), from, destination, easeOut(t));
      this.scene3D.place(actor, point, Math.sin(Math.PI * t) * 95, 1 - Math.sin(Math.PI * t) * 0.25);
      actor.model.setRotationFromEuler(t * 360, t * 540, t * 240);
    });
  }
  private async impact(position: Vec3, color: Color, duration: number): Promise<void> {
    const node = new Node('CaptureImpact'); node.layer = Layers.Enum.UI_2D; node.setParent(this.root); node.setPosition(position);
    const graphics = node.addComponent(Graphics);
    await this.timeline.animate(duration, (t) => {
      graphics.clear(); graphics.strokeColor = new Color(color.r, color.g, color.b, Math.round(255 * (1 - t))); graphics.lineWidth = 4 * (1 - t);
      graphics.circle(0, 0, 12 + t * 44); graphics.stroke();
      graphics.fillColor = graphics.strokeColor;
      for (let i = 0; i < 8; i += 1) { const angle = Math.PI * i / 4; graphics.circle(Math.cos(angle) * t * 55, Math.sin(angle) * t * 55, 4 * (1 - t)); graphics.fill(); }
    });
    node.destroy();
  }
  private actor(piece: Piece): TokenActor {
    const existing = this.actors.get(piece.id);
    if (existing) return existing;
    const actor = this.scene3D.createActor(piece.id, this.scene3D.meshes.plane(piece.color), 18);
    actor.hit.addComponent(Graphics);
    actor.hit.on(Node.EventType.TOUCH_END, () => this.node.emit('piece-selected', piece.id));
    const badge = new Node('Badge'); badge.layer = Layers.Enum.UI_2D; badge.setParent(actor.hit); badge.setPosition(14, 18); badge.addComponent(UITransform).setContentSize(24, 24);
    const label = badge.addComponent(Label); label.fontSize = 18; label.isBold = true; label.horizontalAlign = Label.HorizontalAlign.CENTER;
    this.actors.set(piece.id, actor);
    return actor;
  }
  private airportIndex(piece: Piece): number { return Number(piece.id.split('-').pop()) - 1; }
  private piecePoint(piece: Piece): Vec3 { return this.toView(BoardLayout.piecePosition(piece.color, piece.progress, piece.state, this.airportIndex(piece))); }
  private toView(point: Readonly<Vec3>): Vec3 { const p = rotateBoard(point, this.turns); return new Vec3(p.x, p.y); }
  private fromView(point: Readonly<Vec3>): Vec3 { const p = rotateBoard(point, -this.turns); return new Vec3(p.x, p.y); }
  private resize(): void {
    const size = view.getVisibleSize(), layout = gameViewport(size.width, size.height);
    this.root.setPosition(layout.boardX, layout.boardY); this.root.setScale(layout.boardSize / 720, layout.boardSize / 720, 1);
  }
}
js.setClassAlias(BoardController, '3913f1d4-1728-4ee3-a774-48036639ec13');
