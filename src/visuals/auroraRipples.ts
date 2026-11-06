export const AURORA_LAKE_TOP = 0.8;
export const MAX_LAKE_RIPPLES = 8;
export const LAKE_RIPPLE_LIFE = 3;
export interface LakeRipple { x: number; y: number; age: number }

/** Canvas coordinates enter from the top; the shader uses bottom-origin UVs. */
export class AuroraRipples {
  readonly rings: LakeRipple[] = [];
  add(point: { x: number; y: number }): boolean {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) ||
      point.x < 0 || point.x > 1 || point.y <= AURORA_LAKE_TOP || point.y > 1) return false;
    if (this.rings.length >= MAX_LAKE_RIPPLES) this.rings.shift();
    this.rings.push({ x: point.x, y: 1 - point.y, age: 0 });
    return true;
  }
  update(dt: number) {
    dt = Math.max(0, Math.min(dt, 0.1));
    for (let i = this.rings.length - 1; i >= 0; i--) {
      this.rings[i].age += dt;
      if (this.rings[i].age >= LAKE_RIPPLE_LIFE) this.rings.splice(i, 1);
    }
  }
}
