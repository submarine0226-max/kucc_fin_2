export const FULLSCREEN_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export interface Program {
  handle: WebGLProgram;
  u: Record<string, WebGLUniformLocation>;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): Program {
  const handle = gl.createProgram()!;
  gl.attachShader(handle, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(handle, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(handle);
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`Program link failed: ${gl.getProgramInfoLog(handle)}`);
  }
  const u: Record<string, WebGLUniformLocation> = {};
  const count = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(handle, i)!;
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(handle, info.name)!;
  }
  return { handle, u };
}

export function getGL(canvas: HTMLCanvasElement, opts: WebGLContextAttributes = {}): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, ...opts });
  if (!gl) throw new Error('WebGL2 unavailable');
  return gl;
}

export function hasWebGL2(): boolean {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return false;
  const ok = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return ok;
}

export function releaseGL(gl: WebGL2RenderingContext) {
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}

/** A 1-pixel-tall texture holding the spectrum, so shaders can sample it by frequency. */
export class SpectrumTexture {
  readonly tex: WebGLTexture;
  constructor(private readonly gl: WebGL2RenderingContext, private readonly size: number) {
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, size, 1, 0, gl.RED, gl.FLOAT, new Float32Array(size));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  update(data: Float32Array, unit: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.size, 1, gl.RED, gl.FLOAT, data);
  }
}

export const NOISE_GLSL = `
// Integer math. A floating-point hash can compile differently at each call site, so the
// same lattice corner gets two values and the noise shows a hard seam along the cell edge.
float hash(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p)) + ivec2(65536));
  uint h = q.x * 1597334677u ^ q.y * 3812015801u;
  h *= 1597334677u;
  h ^= h >> 15;
  h *= 3812015801u;
  h ^= h >> 13;
  return float(h) / 4294967295.0;
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    a *= 0.5;
  }
  return v;
}
float spectrumAt(sampler2D tex, float x) {
  float p = clamp(x, 0.0, 1.0) * 63.0;
  float i = floor(p);
  return mix(texelFetch(tex, ivec2(int(i), 0), 0).r,
             texelFetch(tex, ivec2(min(int(i) + 1, 63), 0), 0).r, p - i);
}
`;
