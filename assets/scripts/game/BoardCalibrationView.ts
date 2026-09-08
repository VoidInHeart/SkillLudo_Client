import { Color, EventTouch, Graphics, Label, Layers, Node, UITransform, Vec3 } from 'cc';
import type { BoardCalibrationOpen } from '../protocol/GameProtocol';
import { BoardLayout } from './BoardLayout';

/** The original admin drag/confirm workflow, isolated from game presentation.
 * Coordinates saved to the server are canonical even in a rotated player view. */
export class BoardCalibrationView {
  private marker: Node;
  private panel: Node;
  private label: Label;
  private target: BoardCalibrationOpen | null = null;
  public constructor(
    private readonly root: Node,
    private readonly toView: (point: Readonly<Vec3>) => Vec3,
    private readonly fromView: (point: Readonly<Vec3>) => Vec3,
    private readonly save: (value: object) => void
  ) {
    this.marker = this.node('CalibrationAircraft', root, 54, 54);
    const g = this.marker.addComponent(Graphics);
    g.fillColor = new Color('#171f2c');
    g.moveTo(0, 22); g.lineTo(6, 3); g.lineTo(23, -8); g.lineTo(23, -13); g.lineTo(5, -8); g.lineTo(5, -20); g.lineTo(-5, -20); g.lineTo(-5, -8); g.lineTo(-23, -13); g.lineTo(-23, -8); g.lineTo(-6, 3); g.close(); g.fill();
    g.strokeColor = Color.WHITE; g.lineWidth = 2; g.moveTo(-7, 0); g.lineTo(7, 0); g.moveTo(0, -7); g.lineTo(0, 7); g.stroke();
    this.marker.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => {
      const pointer = event.getUILocation();
      const point = root.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(pointer.x, pointer.y));
      this.marker.setPosition(Math.max(-350, Math.min(350, point.x)), Math.max(-350, Math.min(350, point.y)));
      this.panel.active = false;
    });
    this.marker.on(Node.EventType.TOUCH_END, () => this.confirm());
    this.panel = this.node('CalibrationConfirm', root, 220, 96);
    const panel = this.panel.addComponent(Graphics);
    panel.fillColor = new Color('#fff5d6'); panel.roundRect(-110, -48, 220, 96, 10); panel.fill();
    const text = this.node('Coordinate', this.panel, 208, 52); text.setPosition(0, 15);
    this.label = text.addComponent(Label); this.label.fontSize = 14; this.label.lineHeight = 20; this.label.color = new Color('#202c39'); this.label.horizontalAlign = Label.HorizontalAlign.CENTER;
    this.button('重摆', -52, () => { this.panel.active = false; });
    this.button('确认', 52, () => {
      if (!this.target) return;
      const point = fromView(this.marker.position);
      save({ key: this.target.key, x: point.x, y: point.y, single: this.target.single });
      this.panel.active = false;
    });
    this.close();
  }
  public open(target: BoardCalibrationOpen): void {
    this.target = target;
    const point = target.position ? new Vec3(target.position.x, target.position.y) : BoardLayout.calibrationPosition(target.key);
    this.marker.setPosition(this.toView(point));
    this.marker.active = true;
    this.marker.setSiblingIndex(this.root.children.length - 1);
    this.confirm();
  }
  public close(): void { this.target = null; this.marker.active = false; this.panel.active = false; }
  public refreshView(): void { if (this.target) this.open(this.target); }
  private confirm(): void {
    if (!this.target) return;
    const point = this.fromView(this.marker.position);
    this.label.string = `${this.target.key}\n(${point.x.toFixed(1)}, ${point.y.toFixed(1)})`;
    this.panel.setPosition(Math.max(-242, Math.min(242, this.marker.position.x + 92)), Math.max(-295, Math.min(295, this.marker.position.y + 75)));
    this.panel.active = true;
    this.panel.setSiblingIndex(this.root.children.length - 1);
  }
  private button(title: string, x: number, callback: () => void): void {
    const node = this.node(title, this.panel, 84, 30); node.setPosition(x, -27);
    const graphics = node.addComponent(Graphics); graphics.fillColor = new Color(x < 0 ? '#738495' : '#278357'); graphics.roundRect(-42, -15, 84, 30, 5); graphics.fill();
    const textNode = this.node(`${title}-text`, node, 82, 28);
    const label = textNode.addComponent(Label); label.string = title; label.fontSize = 16; label.horizontalAlign = Label.HorizontalAlign.CENTER; label.verticalAlign = Label.VerticalAlign.CENTER;
    node.on(Node.EventType.TOUCH_END, callback);
  }
  private node(name: string, parent: Node, width: number, height: number): Node {
    const node = new Node(name); node.layer = Layers.Enum.UI_2D; node.setParent(parent); node.addComponent(UITransform).setContentSize(width, height); return node;
  }
}
