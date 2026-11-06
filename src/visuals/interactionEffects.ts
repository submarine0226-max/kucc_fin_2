export interface PointerPoint { x: number; y: number }

export function sandClickKick(x: number, y: number, cx: number, cy: number, seed: number) {
  const dx = x - cx, dy = y - cy, distance = Math.hypot(dx, dy), radius = 0.28;
  if (distance >= radius) return null;
  const weight = (1 - distance / radius) ** 2;
  const angle = seed * 2.399963;
  const nx = distance > 0.001 ? dx / distance : Math.cos(angle);
  const ny = distance > 0.001 ? dy / distance : Math.sin(angle);
  return { vx: (nx * 1.7 + Math.cos(angle) * 0.3) * weight,
    vy: (1.9 + ny * 0.8) * weight, life: 0.8 + weight * 0.4 };
}

export interface FlowerHit { x: number; y: number; radius: number }
export function pickFlower(x: number, y: number, flowers: readonly FlowerHit[]): number | null {
  for (let i = flowers.length - 1; i >= 0; i--) {
    const f = flowers[i];
    if (Math.hypot(x - f.x, y - f.y) <= f.radius * 1.15) return i;
  }
  return null;
}

export function bloomAfterPluck(bloom: number, delay: number, dt: number) {
  dt = Math.max(0, Math.min(dt, 0.1));
  const remaining = Math.max(0, delay - dt);
  const growTime = Math.max(0, dt - delay);
  return { delay: remaining, bloom: Math.min(1, bloom + growTime / 1.1) };
}

export interface StirPoint extends PointerPoint { vx: number; vy: number }
/** A bounded path queue. Only velocity is injected, never new dye or a brightness flash. */
export class MarblingBrush {
  private readonly pending: StirPoint[] = [];
  stroke(from: PointerPoint, to: PointerPoint, aspect: number) {
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    const x0 = clamp(from.x), y0 = clamp(from.y), x1 = clamp(to.x), y1 = clamp(to.y);
    const dx = x1 - x0, dy = y1 - y0;
    const distance = Math.hypot(dx * aspect, dy);
    if (distance < 0.0002) return;
    const count = Math.min(8, Math.max(1, Math.ceil(distance / 0.025)));
    const speed = Math.hypot(dx * aspect, dy) * 8000;
    const cap = Math.min(1, 850 / Math.max(speed, 1));
    const vx = dx * aspect * 8000 * cap / Math.sqrt(count);
    const vy = -dy * 8000 * cap / Math.sqrt(count);
    for (let i = 1; i <= count; i++) {
      this.pending.push({ x: x0 + dx * i / count, y: 1 - (y0 + dy * i / count), vx, vy });
    }
    if (this.pending.length > 24) this.pending.splice(0, this.pending.length - 24);
  }
  take(limit = 8) { return this.pending.splice(0, limit); }
}
