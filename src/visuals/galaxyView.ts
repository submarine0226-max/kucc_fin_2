import type { ViewState } from './interaction';

/** Column-major rotation shared by stars, gas, shock waves and comet orbits. */
export function galaxyViewMatrix(view: ViewState): Float32Array {
  const pitch = Math.acos(0.46) + view.y * Math.PI;
  const yaw = view.x * Math.PI;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  return new Float32Array([cy, 0, -sy, sy * sp, cp, cy * sp, sy * cp, -sp, cy * cp]);
}
