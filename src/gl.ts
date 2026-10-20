// WebGL2 renderer: each step's segments are drawn as instanced quads into a
// buffer that is never cleared, so the wake accumulates on the GPU.
// Colour comes from a cosine palette along the line and over time, edges can
// be soft (glow), and the background is a gradient with optional film grain.
import { SEG } from "./engine";
import { WORLD, type Blend, type Palette } from "./model";

const LINE_VS = `#version 300 es
layout(location=0) in vec2 corner;     // x: 0..1 along, y: -1..1 across
layout(location=1) in vec4 seg;        // x0 y0 x1 y1 in world units
layout(location=2) in float u;         // position along the line, 0..1
uniform float width;                   // world units
uniform float world;
uniform float soft;
uniform bool usePalette;
uniform vec3 pa, pb, pc, pd;           // cosine palette
uniform float spread, phase;
uniform vec3 ink;
out vec3 vColor;
out float vAcross;
void main() {
    vec2 a = seg.xy, b = seg.zw;
    vec2 d = b - a;
    float len = length(d);
    vec2 dir = len > 0.0 ? d / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    float w = width * (1.0 + 2.0 * soft);   // soft lines are drawn wider and fade out
    vec2 p = mix(a - dir * w * 0.5, b + dir * w * 0.5, corner.x) + nrm * corner.y * w * 0.5;
    gl_Position = vec4(p.x / world * 2.0 - 1.0, 1.0 - p.y / world * 2.0, 0.0, 1.0);
    vColor = usePalette ? clamp(pa + pb * cos(6.2831853 * (pc * (u * spread + phase) + pd)), 0.0, 1.0) : ink;
    vAcross = corner.y;
}`;

const LINE_FS = `#version 300 es
precision highp float; // must match the vertex shader: both declare "soft"
in vec3 vColor;
in float vAcross;
uniform float alpha;
uniform float soft;
uniform bool multiply;
out vec4 outColor;
void main() {
    float a = alpha * mix(1.0, exp(-3.5 * vAcross * vAcross), soft);
    // multiply darkens toward the colour; everything else is premultiplied colour
    outColor = multiply ? vec4(mix(vec3(1.0), vColor, a), 1.0) : vec4(vColor * a, a);
}`;

const BG_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 uv;
void main() { uv = P[gl_VertexID] * 0.5 + 0.5; gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`;

const BG_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform vec3 c0, c1;
uniform float grain;
uniform float seed;
out vec4 outColor;
float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423) + seed); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
void main() {
    float r = clamp(length(uv - 0.5) * 1.35, 0.0, 1.0);
    vec3 c = mix(c0, c1, r * r);
    c += (hash(gl_FragCoord.xy) - 0.5) * grain * 0.22;
    outColor = vec4(c, 1.0);
}`;

function program(gl: WebGL2RenderingContext, vs: string, fs: string) {
    const prog = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
        const sh = gl.createShader(type)!;
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader");
        gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    const u = (name: string) => gl.getUniformLocation(prog, name)!;
    return { prog, u };
}

export interface LineStyle {
    ink: [number, number, number];
    palette: Palette | null;
    spread: number;
    phase: number;
    blend: Blend;
    soft: number;
    alpha: number;
    width: number;
}

export class Renderer {
    readonly gl: WebGL2RenderingContext;
    private buf: WebGLBuffer;
    private cap = 0;
    private line: ReturnType<typeof program>;
    private bg: ReturnType<typeof program>;
    private lineVao: WebGLVertexArrayObject;
    private bgVao: WebGLVertexArrayObject;

    constructor(readonly canvas: HTMLCanvasElement) {
        const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: true, premultipliedAlpha: true });
        if (!gl) throw new Error("WebGL2 is not available in this browser");
        this.gl = gl;
        this.line = program(gl, LINE_VS, LINE_FS);
        this.bg = program(gl, BG_VS, BG_FS);
        gl.useProgram(this.line.prog);
        gl.uniform1f(this.line.u("world"), WORLD);

        this.lineVao = gl.createVertexArray()!;
        gl.bindVertexArray(this.lineVao);
        const quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        this.buf = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, SEG * 4, 0);
        gl.vertexAttribDivisor(1, 1);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 1, gl.FLOAT, false, SEG * 4, 16);
        gl.vertexAttribDivisor(2, 1);
        this.bgVao = gl.createVertexArray()!;
        gl.bindVertexArray(null);
    }

    resize(px: number) {
        if (this.canvas.width !== px) {
            this.canvas.width = px;
            this.canvas.height = px;
        }
        this.gl.viewport(0, 0, px, px);
    }

    /** Paint the background: a radial gradient from c0 (centre) to c1 (edge), plus grain. */
    clear(c0: [number, number, number], c1: [number, number, number] = c0, grain = 0, seed = 0) {
        const gl = this.gl;
        gl.disable(gl.BLEND);
        gl.useProgram(this.bg.prog);
        gl.bindVertexArray(this.bgVao);
        gl.uniform3fv(this.bg.u("c0"), c0);
        gl.uniform3fv(this.bg.u("c1"), c1);
        gl.uniform1f(this.bg.u("grain"), grain);
        gl.uniform1f(this.bg.u("seed"), (seed % 1000) / 1000);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    draw(segs: Float32Array, count: number, st: LineStyle) {
        if (!count) return;
        const gl = this.gl;
        gl.useProgram(this.line.prog);
        gl.bindVertexArray(this.lineVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        if (segs.length > this.cap) {
            this.cap = segs.length;
            gl.bufferData(gl.ARRAY_BUFFER, segs.byteLength, gl.DYNAMIC_DRAW);
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, segs.subarray(0, count * SEG));

        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        if (st.blend === "add") gl.blendFunc(gl.ONE, gl.ONE);
        else if (st.blend === "screen") gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
        else if (st.blend === "multiply") gl.blendFunc(gl.DST_COLOR, gl.ZERO);
        else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        const U = this.line.u;
        gl.uniform1i(U("multiply"), st.blend === "multiply" ? 1 : 0);
        gl.uniform1i(U("usePalette"), st.palette ? 1 : 0);
        if (st.palette) {
            const p = st.palette;
            gl.uniform3f(U("pa"), p[0], p[1], p[2]);
            gl.uniform3f(U("pb"), p[3], p[4], p[5]);
            gl.uniform3f(U("pc"), p[6], p[7], p[8]);
            gl.uniform3f(U("pd"), p[9], p[10], p[11]);
        }
        gl.uniform1f(U("spread"), st.spread);
        gl.uniform1f(U("phase"), st.phase);
        gl.uniform3fv(U("ink"), st.ink);
        gl.uniform1f(U("alpha"), st.alpha);
        gl.uniform1f(U("soft"), st.soft);
        // never thinner than one device pixel, or lines shimmer
        gl.uniform1f(U("width"), Math.max(st.width, WORLD / this.canvas.width));
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    }
}
