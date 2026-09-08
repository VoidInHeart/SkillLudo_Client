import { Camera, Color, Graphics, Layers, Mesh, MeshRenderer, Node, RenderTexture, Sprite, SpriteFrame, UITransform, Vec3 } from 'cc';
import { BOARD_SIZE } from './BoardGeometry';
import { TokenMeshes } from './TokenMeshes';

const MODEL_LAYER = 1 << 19;
export interface TokenActor { model: Node; shadow: Node; hit: Node; lift: number; }

/** A transparent 3D pass composited between vector board and interaction HUD.
 * Orthographic XY projection keeps every model footprint on its exact 2D anchor.
 * Height is real Z plus an explicit screen lift; no change to logical positions. */
export class BoardScene3D {
  public readonly meshes = new TokenMeshes();
  public readonly root: Node;
  public readonly overlay: Node;
  private readonly texture = new RenderTexture();
  private readonly frame = new SpriteFrame();
  private readonly camera: Camera;
  private readonly shadows: Node;
  public constructor(private readonly boardRoot: Node) {
    this.root = new Node('LudoModels3D');
    this.root.setParent(boardRoot.scene!);
    this.root.layer = MODEL_LAYER;
    const cameraNode = new Node('TokenCamera');
    cameraNode.setParent(this.root);
    cameraNode.setPosition(0, 0, 1000);
    this.camera = cameraNode.addComponent(Camera);
    this.camera.projection = Camera.ProjectionType.ORTHO;
    this.camera.orthoHeight = BOARD_SIZE / 2;
    this.camera.near = 1;
    this.camera.far = 2000;
    this.camera.visibility = MODEL_LAYER;
    this.camera.priority = -10;
    this.camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    this.camera.clearColor = new Color(0, 0, 0, 0);
    this.texture.reset({ width: 1024, height: 1024 });
    this.camera.targetTexture = this.texture;
    this.shadows = this.uiNode('TokenShadows', boardRoot);
    this.overlay = this.uiNode('Token3DComposite', boardRoot);
    this.frame.texture = this.texture;
    this.frame.packable = false;
    this.frame.flipUVY = false;
    const sprite = this.overlay.addComponent(Sprite);
    sprite.spriteFrame = this.frame;
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    this.overlay.getComponent(UITransform)!.setContentSize(BOARD_SIZE, BOARD_SIZE);
  }
  public createActor(id: string, mesh: Mesh, radius: number): TokenActor {
    const model = new Node(id);
    model.setParent(this.root);
    model.layer = MODEL_LAYER;
    const renderer = model.addComponent(MeshRenderer);
    renderer.mesh = mesh;
    renderer.setSharedMaterial(this.meshes.material, 0);
    const shadow = this.uiNode(`${id}-shadow`, this.shadows);
    const graphics = shadow.addComponent(Graphics);
    graphics.fillColor = new Color(20, 30, 41, 38);
    graphics.ellipse(0, 0, radius * 1.15, radius * 0.68); graphics.fill();
    graphics.fillColor = new Color(20, 30, 41, 32);
    graphics.ellipse(0, 0, radius * 0.8, radius * 0.44); graphics.fill();
    const hit = this.uiNode(`${id}-hit`, this.boardRoot);
    hit.getComponent(UITransform)!.setContentSize(radius * 2.7, radius * 2.7);
    return { model, shadow, hit, lift: 0 };
  }
  public place(actor: TokenActor, position: Readonly<Vec3>, lift = 0, scale = 1): void {
    actor.lift = lift;
    actor.model.setPosition(position.x, position.y + lift * 0.6, 8 + lift);
    actor.model.setScale(scale, scale, scale);
    actor.hit.setPosition(position.x, position.y + lift * 0.6);
    actor.shadow.setPosition(position.x + lift * 0.18 + 2, position.y - 3);
    actor.shadow.setScale((1 + lift / 100) * scale, (1 + lift / 100) * scale, 1);
  }
  public showActor(actor: TokenActor, visible: boolean): void { actor.model.active = visible; actor.shadow.active = visible; actor.hit.active = visible; }
  public destroyActor(actor: TokenActor): void { actor.model.destroy(); actor.shadow.destroy(); actor.hit.destroy(); }
  public setVisible(visible: boolean): void { this.root.active = visible; }
  public destroy(): void {
    this.camera.targetTexture = null;
    this.root.destroy();
    this.frame.destroy();
    this.texture.destroy();
    this.meshes.destroy();
  }
  private uiNode(name: string, parent: Node): Node {
    const node = new Node(name);
    node.setParent(parent);
    node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform).setContentSize(BOARD_SIZE, BOARD_SIZE);
    return node;
  }
}
