import { Color, Graphics, Label, Layers, Node, UITransform } from 'cc';
import { ART_SIZE, BOARD_SHAPES, BOARD_SIZE, artToBoard } from './BoardGeometry';

/** Same vector primitives as the review SVG; no texture/coordinate drift. */
export function drawBoardArtwork(parent: Node): Node {
  const node = new Node('ClassicBoardV2');
  node.layer = Layers.Enum.UI_2D;
  node.setParent(parent);
  node.addComponent(UITransform).setContentSize(BOARD_SIZE, BOARD_SIZE);
  const graphics = node.addComponent(Graphics);
  for (const shape of BOARD_SHAPES) {
    if (shape.kind === 'text') {
      const text = new Node(`BoardText-${shape.value}`);
      text.setParent(node);
      text.layer = Layers.Enum.UI_2D;
      text.addComponent(UITransform).setContentSize(65, 38);
      const position = artToBoard(shape.center);
      text.setPosition(position.x, position.y);
      text.angle = -(shape.rotation ?? 0);
      const label = text.addComponent(Label);
      label.string = shape.value;
      label.fontSize = shape.size * BOARD_SIZE / ART_SIZE;
      label.lineHeight = label.fontSize + 2;
      label.color = new Color(shape.fill);
      label.isBold = true;
      label.horizontalAlign = Label.HorizontalAlign.CENTER;
      label.verticalAlign = Label.VerticalAlign.CENTER;
      continue;
    }
    graphics.fillColor = new Color(shape.fill);
    graphics.strokeColor = new Color(shape.stroke ?? shape.fill);
    graphics.lineWidth = (shape.width ?? 0) * BOARD_SIZE / ART_SIZE;
    if (shape.kind === 'circle') {
      const { x, y } = artToBoard(shape.center);
      graphics.circle(x, y, shape.radius * BOARD_SIZE / ART_SIZE);
    } else {
      shape.points.forEach((point, index) => { const { x, y } = artToBoard(point); if (!index) graphics.moveTo(x, y); else graphics.lineTo(x, y); });
      graphics.close();
    }
    graphics.fill();
    if (shape.width) graphics.stroke();
  }
  return node;
}
