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
uniform vec2 view;                     // world units visible across x and y (1000 on the shorter side)
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
    // world centre (500, 500) sits at the centre of the target, at any aspect ratio
    gl_Position = vec4((p.x - 500.0) / (view.x * 0.5), -(p.y - 500.0) / (view.y * 0.5), 0.0, 1.0);
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

const BG_LIB = `
uniform vec3 c0, c1;
uniform vec2 aspect;   // target size / shorter side, so the gradient stays round
uniform float grain;
uniform float seed;
float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423) + seed); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
vec3 ground(vec2 uv) {
    float r = clamp(length((uv - 0.5) * aspect) * 1.35, 0.0, 1.0);
    return mix(c0, c1, r * r) + (hash(floor(uv * 2048.0)) - 0.5) * grain * 0.22;
}`;

const BG_FS = `#version 300 es
precision highp float;
in vec2 uv;
${BG_LIB}
out vec4 outColor;
void main() { outColor = vec4(ground(uv), 1.0); }`;

// trail fade: last frame moves a little toward the ground; the dither lets
// 8-bit buffers reach the ground exactly instead of leaving ghosts
const FADE_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D prev;
uniform float fade;
uniform float frame;
${BG_LIB}
out vec4 outColor;
void main() {
    vec3 p = texture(prev, uv).rgb;
    vec3 c = mix(p, ground(uv), fade);
    float d = fract(sin(dot(gl_FragCoord.xy + frame, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    outColor = vec4(c + d / 255.0, 1.0);
}`;

const PRESENT_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D tex;
uniform bool rolloff;
out vec4 outColor;
void main() {
    vec3 c = texture(tex, uv).rgb;
    // light piles up past 1.0 in the half-float trails: roll highlights off
    // smoothly (identity below ~0.6) instead of clipping to flat white
    if (rolloff) c = mix(c, 1.0 - 0.4 * exp(-(c - 0.6) / 0.4), step(0.6, c));
    outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
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
    private fade: ReturnType<typeof program>;
    private present: ReturnType<typeof program>;
    private tex: WebGLTexture[] = [];
    private fbo: WebGLFramebuffer[] = [];
    private cur = 0;
    private trailW = 0;
    private trailH = 0;
    private view: [number, number] = [WORLD, WORLD];
    /** the world rectangle the current target shows */
    get bounds() {
        const [vx, vy] = this.view;
        return { x0: WORLD / 2 - vx / 2, x1: WORLD / 2 + vx / 2, y0: WORLD / 2 - vy / 2, y1: WORLD / 2 + vy / 2 };
    }
    private probe: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null;
    /** half-float trail buffers where the GPU can render to them (smoother fades), else 8-bit */
    readonly floatTrails: boolean;

    constructor(readonly canvas: HTMLCanvasElement) {
        const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: true, premultipliedAlpha: true });
        if (!gl) throw new Error("WebGL2 is not available in this browser");
        this.gl = gl;
        this.line = program(gl, LINE_VS, LINE_FS);
        this.bg = program(gl, BG_VS, BG_FS);
        this.fade = program(gl, BG_VS, FADE_FS);
        this.present = program(gl, BG_VS, PRESENT_FS);
        this.floatTrails = !!gl.getExtension("EXT_color_buffer_float");


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

    /** Size the canvas in device pixels; the world (1000 units) spans its shorter side. */
    resize(w: number, h = w) {
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
        const m = Math.min(w, h);
        this.view = [(WORLD * w) / m, (WORLD * h) / m];
        this.bindCanvas();
    }

    /** Paint the background: a radial gradient from c0 (centre) to c1 (edge), plus grain. */
    clear(c0: [number, number, number], c1: [number, number, number] = c0, grain = 0, seed = 0) {
        const gl = this.gl;
        gl.disable(gl.BLEND);
        gl.useProgram(this.bg.prog);
        gl.bindVertexArray(this.bgVao);
        this.groundUniforms(this.bg, c0, c1, grain, seed);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    private groundUniforms(p: ReturnType<typeof program>, c0: number[], c1: number[], grain: number, seed: number) {
        const gl = this.gl;
        gl.uniform3fv(p.u("c0"), c0);
        gl.uniform3fv(p.u("c1"), c1);
        gl.uniform2f(p.u("aspect"), this.view[0] / WORLD, this.view[1] / WORLD);
        gl.uniform1f(p.u("grain"), grain);
        gl.uniform1f(p.u("seed"), (seed % 1000) / 1000);
    }

    // ---------- trails (live simulation) ----------

    /** (Re)create the two trail buffers at w × h and fill them with the ground. */
    trailsReset(w: number, h: number, c0: [number, number, number], c1: [number, number, number], grain: number, seed: number) {
        const gl = this.gl;
        if (w !== this.trailW || h !== this.trailH) {
            this.tex.forEach(t => gl.deleteTexture(t));
            this.fbo.forEach(f => gl.deleteFramebuffer(f));
            this.tex = []; this.fbo = [];
            for (let i = 0; i < 2; i++) {
                const t = gl.createTexture()!;
                gl.bindTexture(gl.TEXTURE_2D, t);
                if (this.floatTrails) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
                else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                const f = gl.createFramebuffer()!;
                gl.bindFramebuffer(gl.FRAMEBUFFER, f);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
                this.tex.push(t); this.fbo.push(f);
            }
            this.trailW = w;
            this.trailH = h;
        }
        for (const f of this.fbo) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, f);
            gl.viewport(0, 0, w, h);
            this.clear(c0, c1, grain, seed);
        }
        this.cur = 0;
    }

    /** Fade the trails one frame toward the ground, then leave the fresh buffer bound for drawing. */
    trailsFade(fade: number, c0: [number, number, number], c1: [number, number, number], grain: number, seed: number, frame: number) {
        const gl = this.gl, next = 1 - this.cur;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[next]);
        gl.viewport(0, 0, this.trailW, this.trailH);
        gl.disable(gl.BLEND);
        gl.useProgram(this.fade.prog);
        gl.bindVertexArray(this.bgVao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
        gl.uniform1i(this.fade.u("prev"), 0);
        gl.uniform1f(this.fade.u("fade"), fade);
        gl.uniform1f(this.fade.u("frame"), frame % 997);
        this.groundUniforms(this.fade, c0, c1, grain, seed);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.cur = next;
    }

    /** Copy the trails to the visible canvas. */
    trailsPresent(rolloff: boolean) {
        const gl = this.gl;
        this.rolloff = rolloff;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.blit();
    }

    private rolloff = false;

    private blit() {
        const gl = this.gl;
        gl.disable(gl.BLEND);
        gl.useProgram(this.present.prog);
        gl.uniform1i(this.present.u("rolloff"), this.rolloff ? 1 : 0);
        gl.bindVertexArray(this.bgVao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
        gl.uniform1i(this.present.u("tex"), 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /** Luminance of a 32 × 32 version of the trails, for automatic exposure. */
    trailsProbe(): Uint8Array {
        const gl = this.gl, S = 32;
        if (!this.probe) {
            const tex = gl.createTexture()!;
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            const fbo = gl.createFramebuffer()!;
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
            this.probe = { fbo, tex };
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.probe.fbo);
        gl.viewport(0, 0, S, S);
        this.blit();
        const px = new Uint8Array(S * S * 4);
        gl.readPixels(0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const lum = new Uint8Array(S * S);
        for (let i = 0; i < S * S; i++) lum[i] = (px[4 * i] * 54 + px[4 * i + 1] * 183 + px[4 * i + 2] * 19) >> 8;
        return lum;
    }

    /** Bind the visible canvas as the drawing target (still mode). */
    bindCanvas() {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
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
        // never thinner than one pixel of the current target, or lines shimmer
        const target = gl.getParameter(gl.FRAMEBUFFER_BINDING) ? Math.min(this.trailW, this.trailH) : Math.min(this.canvas.width, this.canvas.height);
        gl.uniform1f(U("width"), Math.max(st.width, WORLD / target));
        gl.uniform2f(U("view"), this.view[0], this.view[1]);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    }
}
