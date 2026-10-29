import type { HardwareSignals, WebGLInfo } from "./types";
import { fnv1a, withTimeout } from "./util";

/** The drawing the canvas fingerprint hashes, on a fresh 240×60 canvas (null without 2D). */
export function paintFingerprint(): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = 60;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#f60";
  ctx.fillRect(100, 1, 62, 20);
  ctx.fillStyle = "#069";
  ctx.font = "15px 'Arial'";
  ctx.fillText("notabot, Cwm fjordbank 😃", 2, 15);
  ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
  ctx.font = "18px 'Times New Roman'";
  ctx.fillText("notabot, Cwm fjordbank 😃", 4, 45);
  ctx.globalCompositeOperation = "multiply";
  for (const [color, x] of [
    ["#f2f", 40],
    ["#2ff", 80],
    ["#ff2", 60],
  ] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, 30, 22, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fill();
  }
  return canvas;
}

function drawCanvas(): string | null {
  return paintFingerprint()?.toDataURL() ?? null;
}

/** Hash of a drawing of text and shapes, read twice: noise injection makes the two differ. */
export function collectCanvas(): HardwareSignals["canvas"] {
  const a = drawCanvas();
  if (!a) return null;
  const b = drawCanvas();
  return { hash: fnv1a(a), stable: a === b };
}

function sceneHash(gl: WebGLRenderingContext): string | null {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.shaderSource(
    vs,
    "attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.,1.);}",
  );
  gl.shaderSource(
    fs,
    "precision mediump float;varying vec2 v;void main(){gl_FragColor=vec4(sin(v.x*9.7)*.5+.5,cos(v.y*7.3)*.5+.5,fract(v.x*v.y*13.1),1.);}",
  );
  gl.compileShader(vs);
  gl.compileShader(fs);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const pixels = new Uint8Array(64 * 64 * 4);
  gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return fnv1a(pixels);
}

function webglCanvas(): { canvas: HTMLCanvasElement; gl: WebGLRenderingContext } | null {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const gl = (canvas.getContext("webgl", { preserveDrawingBuffer: true }) ??
    canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
  return gl ? { canvas, gl } : null;
}

/** The scene the WebGL fingerprint hashes, rendered on a 64×64 canvas (null without WebGL). */
export function paintWebGLScene(): HTMLCanvasElement | null {
  const made = webglCanvas();
  if (!made) return null;
  sceneHash(made.gl);
  return made.canvas;
}

/** Graphics card and driver, as WebGL names them and as they render. */
export function collectWebGL(): WebGLInfo | null {
  const gl = webglCanvas()?.gl;
  if (!gl) return null;
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    version: String(gl.getParameter(gl.VERSION)),
    vendor: String(gl.getParameter(gl.VENDOR)),
    renderer: String(gl.getParameter(gl.RENDERER)),
    unmaskedVendor: debug ? String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)) : null,
    unmaskedRenderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : null,
    shadingLanguage: String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION)),
    maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
    extensions: gl.getSupportedExtensions()?.length ?? 0,
    sceneHash: sceneHash(gl),
  };
}

/** An oscillator through a compressor, rendered offline: the float math differs per stack. */
export async function collectAudio(): Promise<HardwareSignals["audio"]> {
  const Ctx =
    globalThis.OfflineAudioContext ??
    (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx(1, 5000, 44100);
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = 10000;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -50;
  comp.knee.value = 40;
  comp.ratio.value = 12;
  comp.attack.value = 0;
  comp.release.value = 0.25;
  osc.connect(comp);
  comp.connect(ctx.destination);
  osc.start(0);
  const buffer = await withTimeout(ctx.startRendering(), 1500, null);
  if (!buffer) return null;
  const data = buffer.getChannelData(0).subarray(4500);
  let sum = 0;
  for (const v of data) sum += Math.abs(v);
  return { hash: fnv1a(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)), sum };
}

export async function collectWebGPU(): Promise<HardwareSignals["webgpu"]> {
  const gpu = (
    navigator as Navigator & {
      gpu?: {
        requestAdapter(): Promise<{ info?: { vendor: string; architecture: string } } | null>;
      };
    }
  ).gpu;
  if (!gpu) return null;
  const adapter = await withTimeout(gpu.requestAdapter(), 1000, null);
  if (!adapter?.info) return null;
  return { vendor: adapter.info.vendor, architecture: adapter.info.architecture };
}

const FONTS = [
  "Arial",
  "Arial Narrow",
  "Calibri",
  "Cambria",
  "Candara",
  "Comic Sans MS",
  "Consolas",
  "Courier New",
  "DejaVu Sans",
  "Futura",
  "Geneva",
  "Georgia",
  "Gill Sans",
  "Helvetica Neue",
  "Liberation Sans",
  "Lucida Grande",
  "Menlo",
  "Monaco",
  "Noto Sans",
  "Optima",
  "Palatino",
  "Roboto",
  "Segoe UI",
  "SF Pro Text",
  "Tahoma",
  "Trebuchet MS",
  "Ubuntu",
  "Verdana",
];

/** Installed fonts, found by measuring text that falls back to a generic family otherwise. */
export function collectFonts(): string[] {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return [];
  const text = "mmmmmmmmmmlli1WQ@#";
  const width = (font: string) => {
    ctx.font = `72px ${font}`;
    return ctx.measureText(text).width;
  };
  const bases = ["monospace", "sans-serif", "serif"].map((b) => [b, width(b)] as const);
  return FONTS.filter((f) => bases.some(([b, w]) => width(`'${f}', ${b}`) !== w));
}
