import { Color, Material, Mesh, Quat, utils, Vec3 } from 'cc';
import type { PlayerColor } from '../protocol/GameProtocol';
import { BOARD_COLORS } from './BoardGeometry';
import { DIE_FACE_EULER, DIE_PIPS } from './DiceMotion';

type V = [number, number, number];
/** Low-poly solids with flat facet shading: real meshes, one draw per token,
 * no physics/WASM dependency and no runtime downloaded models. */
class Solid {
  public positions: number[] = [];
  public normals: number[] = [];
  public colors: number[] = [];
  public indices: number[] = [];
  public face(points: V[], color: Color): void {
    const start = this.positions.length / 3;
    const a = new Vec3(...points[0]), b = new Vec3(...points[1]), c = new Vec3(...points[2]);
    const normal = Vec3.cross(new Vec3(), b.subtract(a), c.subtract(a)).normalize();
    const light = Math.max(0.58, Math.min(1.08, 0.78 + normal.z * 0.2 - normal.x * 0.12 + normal.y * 0.1));
    for (const point of points) {
      this.positions.push(...point);
      this.normals.push(normal.x, normal.y, normal.z);
      this.colors.push(Math.min(1, color.r * light / 255), Math.min(1, color.g * light / 255), Math.min(1, color.b * light / 255), 1);
    }
    for (let i = 1; i < points.length - 1; i += 1) this.indices.push(start, start + i, start + i + 1);
  }
  public extrude(points: Array<[number, number]>, bottom: number, top: number, color: Color): void {
    // Convex polygons are CCW when viewed from +Z.
    this.face(points.map(([x, y]) => [x, y, top]), color);
    this.face([...points].reverse().map(([x, y]) => [x, y, bottom]), color);
    points.forEach(([x, y], index) => {
      const [nx, ny] = points[(index + 1) % points.length];
      this.face([[x, y, bottom], [nx, ny, bottom], [nx, ny, top], [x, y, top]], color);
    });
  }
  public mesh(): Mesh { return utils.createMesh({ positions: this.positions, normals: this.normals, colors: this.colors, indices: this.indices }); }
}

export class TokenMeshes {
  public readonly material = new Material();
  private readonly meshes = new Map<string, Mesh>();
  public constructor() { this.material.initialize({ effectName: 'builtin-unlit', defines: { USE_VERTEX_COLOR: true } }); }
  public plane(color: PlayerColor): Mesh {
    const existing = this.meshes.get(color);
    if (existing) return existing;
    const solid = new Solid();
    const pigment = new Color(BOARD_COLORS[color]);
    const ring: Array<[number, number]> = Array.from({ length: 24 }, (_, i) => [Math.cos(i * Math.PI / 12) * 14, Math.sin(i * Math.PI / 12) * 14]);
    solid.extrude(ring, 0, 2.4, new Color('#f2f3ed'));
    solid.extrude(ring.map(([x, y]) => [x * 0.89, y * 0.89]), 2.4, 3.8, pigment);
    solid.extrude([[-3, -13], [3, -13], [4, 9], [0, 20], [-4, 9]], 4, 8, pigment);
    solid.extrude([[-19, -6], [-4, -3], [-4, 7], [-19, -2]], 4, 6, pigment);
    solid.extrude([[4, -3], [19, -6], [19, -2], [4, 7]], 4, 6, pigment);
    solid.extrude([[-10, -13], [10, -13], [7, -8], [-7, -8]], 4, 6, pigment);
    solid.extrude([[-2.5, 2], [2.5, 2], [2, 10], [0, 13], [-2, 10]], 8, 10, new Color('#173753'));
    solid.extrude([[-1.2, -12], [1.2, -12], [1.2, -6], [-1.2, -6]], 8, 14, pigment);
    const mesh = solid.mesh(); this.meshes.set(color, mesh); return mesh;
  }
  public die(): Mesh {
    const existing = this.meshes.get('die');
    if (existing) return existing;
    const solid = new Solid();
    const white = new Color('#fff9e9');
    for (let value = 1; value <= 6; value += 1) {
      // Inverse final alignment maps our +Z face onto its physical cube face.
      const orientation = Quat.invert(new Quat(), Quat.fromEuler(new Quat(), ...DIE_FACE_EULER[value]));
      const transform = (point: V): V => { const v = Vec3.transformQuat(new Vec3(), new Vec3(...point), orientation); return [v.x, v.y, v.z]; };
      // Rounded cube surface, with a narrow bevel around each face.
      const grid = [-1, -0.8, 0.8, 1];
      const rounded = (x: number, y: number): V => {
        const inset = new Vec3(Math.max(-0.8, Math.min(0.8, x)), Math.max(-0.8, Math.min(0.8, y)), 0.8);
        const delta = new Vec3(x, y, 1).subtract(inset).normalize().multiplyScalar(0.2);
        return transform([inset.x + delta.x, inset.y + delta.y, inset.z + delta.z]);
      };
      for (let row = 0; row < 3; row += 1) for (let col = 0; col < 3; col += 1) {
        solid.face([rounded(grid[col], grid[row]), rounded(grid[col + 1], grid[row]), rounded(grid[col + 1], grid[row + 1]), rounded(grid[col], grid[row + 1])], white);
      }
      for (const [x, y] of DIE_PIPS[value]) {
        const points: V[] = Array.from({ length: 12 }, (_, i) => transform([x * 0.49 + Math.cos(i * Math.PI / 6) * 0.135, y * 0.49 + Math.sin(i * Math.PI / 6) * 0.135, 1.005]));
        solid.face(points, new Color(value === 1 ? '#e54443' : '#233c54'));
      }
    }
    const mesh = solid.mesh(); this.meshes.set('die', mesh); return mesh;
  }
  public destroy(): void { this.material.destroy(); this.meshes.forEach((mesh) => mesh.destroy()); this.meshes.clear(); }
}
