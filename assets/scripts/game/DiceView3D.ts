import { Quat, Vec3 } from 'cc';
import type { DicePair } from '../protocol/GameProtocol';
import { BoardScene3D, type TokenActor } from './BoardScene3D';
import { DIE_FACE_EULER, throwHeight } from './DiceMotion';
import { easeOut, MotionTimeline, smooth } from './MotionTimeline';

/** True six-face dice. Randomness determines only their tumbling path; final
 * faces always come from the server, including restored reconnect snapshots. */
export class DiceView3D {
  private actors: TokenActor[];
  private epoch = 0;
  private shownRollId = -1;
  private readonly destinations = [new Vec3(-91, 102), new Vec3(98, -106)];
  public constructor(private readonly scene: BoardScene3D, private readonly timeline: MotionTimeline, select: (index: number) => void) {
    this.actors = [0, 1].map((index) => {
      const actor = scene.createActor(`Die-${index}`, scene.meshes.die(), 23);
      actor.hit.on('touch-end', () => select(index));
      scene.showActor(actor, false);
      return actor;
    });
  }
  public async throw(pair: DicePair, rollId: number): Promise<void> {
    const epoch = ++this.epoch;
    this.shownRollId = rollId;
    await Promise.all(this.actors.map(async (actor, index) => {
      this.scene.showActor(actor, true);
      const from = new Vec3(-230 + index * 90, -230);
      const target = this.destinations[index];
      const final = this.restRotation(pair[index], index);
      const spin = new Quat();
      await this.timeline.animate(1.12 + index * 0.13, (t) => {
        if (epoch !== this.epoch) return;
        const u = easeOut(t);
        const point = Vec3.lerp(new Vec3(), from, target, u);
        point.x += Math.sin(t * Math.PI) * (index ? 45 : -25);
        const height = throwHeight(t);
        this.scene.place(actor, point, height, 22);
        // Shadow scale is in board units, unlike the unit cube's model scale.
        actor.shadow.setScale(1 + height / 150, 1 + height / 150, 1);
        Quat.fromEuler(spin, 580 * (1 - t), (index ? -640 : 720) * (1 - t), 400 * (1 - t));
        Quat.multiply(spin, final, spin);
        const settle = t > 0.8 ? smooth((t - 0.8) / 0.2) : 0;
        actor.model.setRotation(Quat.slerp(new Quat(), spin, final, settle));
      });
      if (epoch === this.epoch) this.placeRest(actor, pair[index], index);
    }));
  }
  public restore(pair: DicePair | null, rollId: number, visible: boolean): void {
    if (!pair || !visible) { this.hide(); return; }
    this.shownRollId = rollId;
    this.actors.forEach((actor, index) => { this.scene.showActor(actor, true); this.placeRest(actor, pair[index], index); });
  }
  public hide(): void { this.epoch += 1; this.actors.forEach((actor) => this.scene.showActor(actor, false)); }
  public reset(): void { this.hide(); this.shownRollId = -1; }
  private placeRest(actor: TokenActor, value: number, index: number): void {
    this.scene.place(actor, this.destinations[index], 0, 22);
    actor.shadow.setScale(1, 1, 1);
    actor.model.setRotation(this.restRotation(value, index));
  }
  private restRotation(value: number, index: number): Quat {
    const face = Quat.fromEuler(new Quat(), ...DIE_FACE_EULER[value]);
    const tilt = Quat.fromEuler(new Quat(), -16, 18, index ? 12 : -12);
    return Quat.multiply(new Quat(), tilt, face);
  }
}
