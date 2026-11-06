import type { ElementKey, Features } from '../audio/features';
import { ElementFocus } from './interaction';
import { MarblingBrush } from './interactionEffects';
import { FULLSCREEN_VS, createProgram, getGL, releaseGL, type Program } from './gl';
import { ELEMENT_RGB, moodBackground, moodVivid, type Visual, type VisualInfo } from './types';

/** 마블링: paint floating on water, moved by a real fluid simulation (Stam's stable fluids). */
export const marblingInfo: VisualInfo = {
  id: 'marbling',
  name: '마블링',
  needsWebGL: true,
  interaction: { pointer: '드래그로 물감 섞기' },
  legend: {
    drums: { color: '#f66570', text: '물을 밀어내는 붉은 물감' },
    bass: { color: '#4593fc', text: '아래에서 밀려오는 푸른 물결' },
    vocal: { color: '#ffd158', text: '음 높이를 따라 흐르는 금빛 줄기' },
    melody: { color: '#58c7c7', text: '빗살처럼 그어지는 물감 방울' },
  },
};

const SIM_HEIGHT = 200;
const DYE_HEIGHT = 720;
const PRESSURE_ITERATIONS = 18;

const HEADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
`;

const SPLAT = `${HEADER}
uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform vec4 uValue;
uniform float uRadius, uAspect;
uniform float uRadial;
void main() {
  vec2 d = vUv - uPoint;
  d.x *= uAspect;
  float g = exp(-dot(d, d) / uRadius);
  vec4 add = uValue * g;
  if (uRadial > 0.0) add = vec4(normalize(d + 1e-5) * uRadial * g * sqrt(dot(d, d) / uRadius + 0.02), 0.0, 0.0);
  o = texture(uTarget, vUv) + add;
}`;

const ADVECT = `${HEADER}
uniform sampler2D uVelocity, uSource;
uniform vec2 uTexel;
uniform float uDt, uDissipation, uEdge;
void main() {
  vec2 coord = vUv - uDt * texture(uVelocity, vUv).xy * uTexel;
  vec2 edge = smoothstep(vec2(0.0), vec2(0.03), vUv) * smoothstep(vec2(0.0), vec2(0.03), 1.0 - vUv);
  o = texture(uSource, coord) * uDissipation * mix(uEdge, 1.0, edge.x * edge.y);
}`;

const DIVERGENCE = `${HEADER}
uniform sampler2D uVelocity;
uniform vec2 uTexel;
void main() {
  float L = texture(uVelocity, vUv - vec2(uTexel.x, 0)).x;
  float R = texture(uVelocity, vUv + vec2(uTexel.x, 0)).x;
  float B = texture(uVelocity, vUv - vec2(0, uTexel.y)).y;
  float T = texture(uVelocity, vUv + vec2(0, uTexel.y)).y;
  o = vec4(0.5 * (R - L + T - B), 0, 0, 1);
}`;

const CURL = `${HEADER}
uniform sampler2D uVelocity;
uniform vec2 uTexel;
void main() {
  float L = texture(uVelocity, vUv - vec2(uTexel.x, 0)).y;
  float R = texture(uVelocity, vUv + vec2(uTexel.x, 0)).y;
  float B = texture(uVelocity, vUv - vec2(0, uTexel.y)).x;
  float T = texture(uVelocity, vUv + vec2(0, uTexel.y)).x;
  o = vec4(0.5 * (R - L - T + B), 0, 0, 1);
}`;

const VORTICITY = `${HEADER}
uniform sampler2D uVelocity, uCurl;
uniform vec2 uTexel;
uniform float uStrength, uDt;
void main() {
  float L = texture(uCurl, vUv - vec2(uTexel.x, 0)).x;
  float R = texture(uCurl, vUv + vec2(uTexel.x, 0)).x;
  float B = texture(uCurl, vUv - vec2(0, uTexel.y)).x;
  float T = texture(uCurl, vUv + vec2(0, uTexel.y)).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = vec2(abs(T) - abs(B), abs(R) - abs(L));
  force = force / (length(force) + 1e-4) * uStrength * C;
  force.y = -force.y;
  o = vec4(texture(uVelocity, vUv).xy + force * uDt, 0, 1);
}`;

const PRESSURE = `${HEADER}
uniform sampler2D uPressure, uDivergence;
uniform vec2 uTexel;
void main() {
  float L = texture(uPressure, vUv - vec2(uTexel.x, 0)).x;
  float R = texture(uPressure, vUv + vec2(uTexel.x, 0)).x;
  float B = texture(uPressure, vUv - vec2(0, uTexel.y)).x;
  float T = texture(uPressure, vUv + vec2(0, uTexel.y)).x;
  o = vec4((L + R + B + T - texture(uDivergence, vUv).x) * 0.25, 0, 0, 1);
}`;

const GRADIENT = `${HEADER}
uniform sampler2D uPressure, uVelocity;
uniform vec2 uTexel;
void main() {
  float L = texture(uPressure, vUv - vec2(uTexel.x, 0)).x;
  float R = texture(uPressure, vUv + vec2(uTexel.x, 0)).x;
  float B = texture(uPressure, vUv - vec2(0, uTexel.y)).x;
  float T = texture(uPressure, vUv + vec2(0, uTexel.y)).x;
  o = vec4(texture(uVelocity, vUv).xy - vec2(R - L, T - B) * 0.5, 0, 1);
}`;

const DISPLAY = `${HEADER}
uniform sampler2D uDye;
uniform vec2 uTexel;
uniform vec3 uBg;
uniform vec3 uDrumColor, uBassColor, uVocalColor, uMelodyColor;
uniform float uExposure;
void main() {
  // Keep each element in its own channel, so focus also applies to paint already on the water.
  vec4 elements = texture(uDye, vUv);
  vec3 dye = elements.x * uDrumColor + elements.y * uBassColor + elements.z * uVocalColor + elements.w * uMelodyColor;
  float L = dot(texture(uDye, vUv - vec2(uTexel.x, 0)), vec4(0.33));
  float R = dot(texture(uDye, vUv + vec2(uTexel.x, 0)), vec4(0.33));
  float B = dot(texture(uDye, vUv - vec2(0, uTexel.y)), vec4(0.33));
  float T = dot(texture(uDye, vUv + vec2(0, uTexel.y)), vec4(0.33));
  // Treat dye thickness as height to get the wet, oily relief of real marbled paper.
  vec3 normal = normalize(vec3((L - R) * 3.2, (B - T) * 3.2, 1.0));
  float light = dot(normal, normalize(vec3(-0.45, 0.6, 0.66)));
  float spec = pow(max(light, 0.0), 26.0) * smoothstep(0.02, 0.4, dot(dye, vec3(0.33)));
  // Scale by the strongest channel, so thick paint stays saturated instead of going white.
  float thick = max(max(dye.r, dye.g), dye.b);
  vec3 hue = dye / max(thick, 1e-4);
  vec3 paint = hue * (1.0 - exp(-thick * 2.2 * uExposure));
  float cover = 1.0 - exp(-thick * 3.5);
  vec3 col = mix(uBg, paint, cover) * (0.72 + 0.42 * light) + spec * 0.22;
  o = vec4(pow(col, vec3(0.92)), 1.0);
}`;

interface Fbo {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}
interface DoubleFbo {
  read: Fbo;
  write: Fbo;
  swap(): void;
}

export class MarblingVisual implements Visual {
  readonly focus = new ElementFocus();
  readonly canvas = document.createElement('canvas');
  private readonly gl = getGL(this.canvas);
  private readonly p: Record<string, Program>;
  private velocity!: DoubleFbo;
  private pressure!: DoubleFbo;
  private dye!: DoubleFbo;
  private divergence!: Fbo;
  private curl!: Fbo;
  private aspect = 1;
  private t = 0;
  private bassSide = 0;
  private ready = false;
  private readonly brush = new MarblingBrush();

  drag(from: { x: number; y: number }, to: { x: number; y: number }) {
    this.brush.stroke(from, to, this.aspect);
  }

  constructor() {
    const gl = this.gl;
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_color_buffer_half_float');
    const make = (fs: string) => createProgram(gl, FULLSCREEN_VS, fs);
    this.p = {
      splat: make(SPLAT),
      advect: make(ADVECT),
      divergence: make(DIVERGENCE),
      curl: make(CURL),
      vorticity: make(VORTICITY),
      pressure: make(PRESSURE),
      gradient: make(GRADIENT),
      display: make(DISPLAY),
    };
  }

  private makeFbo(w: number, h: number, internal: number, format: number): Fbo {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { fbo, tex, w, h };
  }

  private makeDouble(w: number, h: number, internal: number, format: number): DoubleFbo {
    const d: DoubleFbo = {
      read: this.makeFbo(w, h, internal, format),
      write: this.makeFbo(w, h, internal, format),
      swap() {
        const t = d.read;
        d.read = d.write;
        d.write = t;
      },
    };
    return d;
  }

  resize(width: number, height: number) {
    const gl = this.gl;
    const pixel = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.max(1, Math.round(width * pixel));
    this.canvas.height = Math.max(1, Math.round(height * pixel));
    this.aspect = width / Math.max(1, height);
    const simW = Math.round(SIM_HEIGHT * this.aspect);
    const dyeW = Math.round(DYE_HEIGHT * this.aspect);
    this.velocity = this.makeDouble(simW, SIM_HEIGHT, gl.RG16F, gl.RG);
    this.pressure = this.makeDouble(simW, SIM_HEIGHT, gl.R16F, gl.RED);
    this.dye = this.makeDouble(dyeW, DYE_HEIGHT, gl.RGBA16F, gl.RGBA);
    this.divergence = this.makeFbo(simW, SIM_HEIGHT, gl.R16F, gl.RED);
    this.curl = this.makeFbo(simW, SIM_HEIGHT, gl.R16F, gl.RED);
    this.ready = true;
  }

  private bind(unit: number, tex: WebGLTexture, loc: WebGLUniformLocation) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  private blit(target: Fbo | null) {
    const gl = this.gl;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private splatInto(target: DoubleFbo, x: number, y: number, r: number, v: readonly number[], radial = 0) {
    const gl = this.gl;
    const p = this.p.splat;
    gl.useProgram(p.handle);
    this.bind(0, target.read.tex, p.u.uTarget);
    gl.uniform2f(p.u.uPoint, x, y);
    gl.uniform4f(p.u.uValue, v[0], v[1], v[2], v[3] ?? 0);
    gl.uniform1f(p.u.uRadius, r);
    gl.uniform1f(p.u.uAspect, this.aspect);
    gl.uniform1f(p.u.uRadial, radial);
    this.blit(target.write);
    target.swap();
  }

  private inject(x: number, y: number, r: number, vx: number, vy: number, key: ElementKey, amount: number, radial = 0) {
    this.splatInto(this.velocity, x, y, r, [vx, vy, 0], radial);
    if (amount > 0) {
      const elements = [0, 0, 0, 0];
      elements[(['drums', 'bass', 'vocal', 'melody'] as ElementKey[]).indexOf(key)] = amount;
      this.splatInto(this.dye, x, y, r * 0.8, elements);
    }
  }

  private drive(f: Features, dt: number) {
    const a = f.arousal;
    const flow = 0.6 + 1.2 * a;
    const scale = dt * 60;

    if (f.bass > 0.1) {
      this.bassSide += dt * (0.25 + 0.5 * a);
      const x = 0.5 + 0.42 * Math.sin(this.bassSide);
      const push = (40 + 190 * f.bass * f.bass) * flow;
      const dx = Math.cos(this.bassSide) * 50 * flow;
      this.inject(x, 0.04, 0.008 + 0.022 * f.bass, dx, push, 'bass', 0.05 * f.bass * scale);
    }

    if (f.kick > 0) {
      const angle = this.t * 2.399 * 2;
      const x = 0.5 + 0.34 * Math.cos(angle);
      const y = 0.5 + 0.3 * Math.sin(angle);
      this.inject(x, y, 0.004 + 0.006 * f.kick, 0, 0, 'drums', 1.0 * f.kick, 300 * f.kick * flow);
    }
    if (f.snare > 0) {
      for (let i = 0; i < 3; i++) {
        const x = 0.1 + Math.random() * 0.8;
        const y = 0.1 + Math.random() * 0.8;
        this.inject(x, y, 0.0014, 0, 0, 'drums', 0.65 * f.snare, 120 * f.snare);
      }
    }

    if (f.vocal > 0.06) {
      const phase = this.t * (0.3 + 0.3 * a);
      const x = 0.5 + 0.4 * Math.sin(phase);
      const y = 0.12 + 0.8 * f.vocalPitch;
      const vx = Math.cos(phase) * 170 * flow;
      const vy = Math.sin(this.t * 2.4) * 70;
      this.inject(x, y, 0.0009 + 0.003 * f.vocal, vx, vy, 'vocal', 0.2 * f.vocal * scale);
    }

    if (f.melodyNote > 0) {
      // Marblers drag a comb through the paint. Each note is one pass of that comb.
      const y = 0.08 + 0.86 * f.melodyPitch;
      const dir = f.melodyPitchClass % 2 ? 1 : -1;
      const teeth = 5;
      for (let i = 0; i < teeth; i++) {
        const x = (i + 0.5 + (Math.random() - 0.5) * 0.3) / teeth;
        this.inject(x, y, 0.0006 + 0.0007 * f.melodyNote, dir * 240 * flow, 0, 'melody', 0.75 * f.melodyNote);
      }
    }
  }

  private step(f: Features, dt: number) {
    const gl = this.gl;
    const P = this.p;
    gl.disable(gl.BLEND);
    const simW = this.velocity.read.w;
    const simH = this.velocity.read.h;
    const texelX = 1 / simW;
    const texelY = 1 / simH;

    gl.useProgram(P.curl.handle);
    this.bind(0, this.velocity.read.tex, P.curl.u.uVelocity);
    gl.uniform2f(P.curl.u.uTexel, texelX, texelY);
    this.blit(this.curl);

    gl.useProgram(P.vorticity.handle);
    this.bind(0, this.velocity.read.tex, P.vorticity.u.uVelocity);
    this.bind(1, this.curl.tex, P.vorticity.u.uCurl);
    gl.uniform2f(P.vorticity.u.uTexel, texelX, texelY);
    gl.uniform1f(P.vorticity.u.uStrength, 2.5 + 3 * f.arousal);
    gl.uniform1f(P.vorticity.u.uDt, dt);
    this.blit(this.velocity.write);
    this.velocity.swap();

    gl.useProgram(P.divergence.handle);
    this.bind(0, this.velocity.read.tex, P.divergence.u.uVelocity);
    gl.uniform2f(P.divergence.u.uTexel, texelX, texelY);
    this.blit(this.divergence);

    gl.useProgram(P.pressure.handle);
    gl.uniform2f(P.pressure.u.uTexel, texelX, texelY);
    this.bind(1, this.divergence.tex, P.pressure.u.uDivergence);
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      this.bind(0, this.pressure.read.tex, P.pressure.u.uPressure);
      this.blit(this.pressure.write);
      this.pressure.swap();
    }

    gl.useProgram(P.gradient.handle);
    this.bind(0, this.pressure.read.tex, P.gradient.u.uPressure);
    this.bind(1, this.velocity.read.tex, P.gradient.u.uVelocity);
    gl.uniform2f(P.gradient.u.uTexel, texelX, texelY);
    this.blit(this.velocity.write);
    this.velocity.swap();

    gl.useProgram(P.advect.handle);
    gl.uniform1f(P.advect.u.uDt, dt);
    gl.uniform2f(P.advect.u.uTexel, texelX, texelY);
    this.bind(0, this.velocity.read.tex, P.advect.u.uVelocity);
    this.bind(1, this.velocity.read.tex, P.advect.u.uSource);
    gl.uniform1f(P.advect.u.uDissipation, Math.exp(-dt * 1.1));
    gl.uniform1f(P.advect.u.uEdge, 0);
    this.blit(this.velocity.write);
    this.velocity.swap();

    this.bind(0, this.velocity.read.tex, P.advect.u.uVelocity);
    this.bind(1, this.dye.read.tex, P.advect.u.uSource);
    gl.uniform1f(P.advect.u.uDissipation, Math.exp(-dt * (0.2 + 0.22 * f.arousal)));
    gl.uniform1f(P.advect.u.uEdge, 1);
    this.blit(this.dye.write);
    this.dye.swap();
  }

  frame(f: Features) {
    this.focus.update(f.dt);
    if (!this.ready) return;
    const gl = this.gl;
    const dt = Math.min(f.dt, 1 / 30);
    this.t += dt;
    this.drive(f, dt);
    for (const point of this.brush.take()) {
      this.splatInto(this.velocity, point.x, point.y, 0.0035, [point.vx, point.vy, 0]);
    }
    this.step(f, dt);

    const bg = moodBackground(f.valence, f.arousal);
    const d = this.p.display;
    gl.useProgram(d.handle);
    this.bind(0, this.dye.read.tex, d.u.uDye);
    gl.uniform2f(d.u.uTexel, 1 / this.dye.read.w, 1 / this.dye.read.h);
    gl.uniform3f(d.u.uBg, bg[0] / 255, bg[1] / 255, bg[2] / 255);
    for (const [key, uniform] of [['drums', 'uDrumColor'], ['bass', 'uBassColor'], ['vocal', 'uVocalColor'], ['melody', 'uMelodyColor']] as const) {
      const c = this.focus.color(key, moodVivid(ELEMENT_RGB[key], f.valence, f.arousal));
      gl.uniform3f(d.u[uniform], c[0] / 255, c[1] / 255, c[2] / 255);
    }
    gl.uniform1f(d.u.uExposure, 1 + 0.18 * f.pulse);
    this.blit(null);
  }

  dispose() {
    releaseGL(this.gl);
  }
}
