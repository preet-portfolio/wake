// Gray–Scott reaction–diffusion on the GPU: two float textures, ping-pong.
// Same equations and constants as the CPU reference in science/grayscott.ts
// (3×3 Laplacian: centre −1, edges 0.2, corners 0.05; Du = 1, Dv = 0.5; dt = 1),
// which the tests compare it against.
import { program } from "./gl";
import { DU, DV, initialField } from "./science/grayscott";
import type { Palette } from "./model";

const VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 uv;
void main() { uv = P[gl_VertexID] * 0.5 + 0.5; gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`;

const STEP = `#version 300 es
precision highp float;
uniform highp sampler2D state;
uniform float F, k;
uniform vec3 brush;        // x, y in cells, radius (0 = none)
out vec4 o;
vec2 at(ivec2 p, ivec2 size) { return texelFetch(state, (p + size) % size, 0).xy; }
void main() {
    ivec2 size = textureSize(state, 0), p = ivec2(gl_FragCoord.xy);
    vec2 c = at(p, size);
    vec2 lap = -c
        + 0.2 * (at(p + ivec2(1, 0), size) + at(p - ivec2(1, 0), size) + at(p + ivec2(0, 1), size) + at(p - ivec2(0, 1), size))
        + 0.05 * (at(p + ivec2(1, 1), size) + at(p + ivec2(-1, 1), size) + at(p + ivec2(1, -1), size) + at(p - ivec2(1, 1), size));
    float u = c.x, v = c.y, r = u * v * v;
    u += ${DU.toFixed(1)} * lap.x - r + F * (1.0 - u);
    v += ${DV.toFixed(1)} * lap.y + r - (F + k) * v;
    if (brush.z > 0.0 && distance(gl_FragCoord.xy, brush.xy) < brush.z) { u = 0.5; v = 0.25; }
    o = vec4(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0), 0.0, 1.0);
}`;

const SHOW = `#version 300 es
precision highp float;
in vec2 uv;
uniform highp sampler2D state;
uniform vec3 ground, ink;
uniform bool usePalette;
uniform vec3 pa, pb, pc, pd;
uniform float shift;
out vec4 o;
void main() {
    float v = texture(state, uv).y;
    vec3 col = usePalette ? clamp(pa + pb * cos(6.2831853 * (pc * (v * 2.0 + shift) + pd)), 0.0, 1.0) : ink;
    o = vec4(mix(ground, col, smoothstep(0.08, 0.32, v)), 1.0);
}`;

export class GrayScottGL {
    private step: ReturnType<typeof program>;
    private show: ReturnType<typeof program>;
    private tex: WebGLTexture[] = [];
    private fbo: WebGLFramebuffer[] = [];
    private vao: WebGLVertexArrayObject;
    private cur = 0;
    private smooth: boolean;
    w = 0;
    h = 0;

    constructor(private gl: WebGL2RenderingContext) {
        if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("this GPU can't render to float textures");
        this.step = program(gl, VS, STEP);
        this.show = program(gl, VS, SHOW);
        this.vao = gl.createVertexArray()!;
        this.smooth = !!gl.getExtension("OES_texture_float_linear");
    }

    /** New field of w × h cells, from the same starting field as the CPU reference. */
    reset(w: number, h: number, seed: number, spots = Math.max(8, Math.round((w * h) / 2500))) {
        const gl = this.gl;
        this.tex.forEach(t => gl.deleteTexture(t)); this.fbo.forEach(f => gl.deleteFramebuffer(f));
        this.tex = []; this.fbo = [];
        this.w = w; this.h = h;
        const init = initialField(w, h, seed, spots);
        const data = new Float32Array(w * h * 4);
        for (let i = 0; i < w * h; i++) { data[4 * i] = init.u[i]; data[4 * i + 1] = init.v[i]; data[4 * i + 3] = 1; }
        for (let i = 0; i < 2; i++) {
            const t = gl.createTexture()!;
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, i === 0 ? data : null);
            for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.REPEAT], [gl.TEXTURE_WRAP_T, gl.REPEAT]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
            const f = gl.createFramebuffer()!;
            gl.bindFramebuffer(gl.FRAMEBUFFER, f);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
            this.tex.push(t); this.fbo.push(f);
        }
        this.cur = 0;
    }

    /** Advance n steps. brush: cell coordinates and radius, or null. */
    run(n: number, F: number, k: number, brush: [number, number, number] | null = null) {
        const gl = this.gl;
        gl.disable(gl.BLEND);
        gl.useProgram(this.step.prog);
        gl.bindVertexArray(this.vao);
        gl.viewport(0, 0, this.w, this.h);
        gl.uniform1f(this.step.u("F"), F);
        gl.uniform1f(this.step.u("k"), k);
        gl.uniform1i(this.step.u("state"), 0);
        gl.activeTexture(gl.TEXTURE0);
        for (let i = 0; i < n; i++) {
            gl.uniform3fv(this.step.u("brush"), i === 0 && brush ? brush : [0, 0, 0]);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[1 - this.cur]);
            gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            this.cur = 1 - this.cur;
        }
    }

    /** Draw the field to the canvas: the second chemical, coloured over the ground. */
    present(width: number, height: number, ground: number[], ink: number[], palette: Palette | null, shift: number) {
        const gl = this.gl, U = this.show.u;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        gl.useProgram(this.show.prog);
        gl.bindVertexArray(this.vao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
        // smooth when shown (the update itself reads exact cells with texelFetch)
        const f = this.smooth ? gl.LINEAR : gl.NEAREST;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
        gl.uniform1i(U("state"), 0);
        gl.uniform3fv(U("ground"), ground);
        gl.uniform3fv(U("ink"), ink);
        gl.uniform1i(U("usePalette"), palette ? 1 : 0);
        if (palette) {
            gl.uniform3f(U("pa"), palette[0], palette[1], palette[2]); gl.uniform3f(U("pb"), palette[3], palette[4], palette[5]);
            gl.uniform3f(U("pc"), palette[6], palette[7], palette[8]); gl.uniform3f(U("pd"), palette[9], palette[10], palette[11]);
        }
        gl.uniform1f(U("shift"), shift);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /** The second chemical, read back (for the GPU-vs-CPU test). */
    readV(): Float32Array {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[this.cur]);
        const px = new Float32Array(this.w * this.h * 4);
        gl.readPixels(0, 0, this.w, this.h, gl.RGBA, gl.FLOAT, px);
        const v = new Float32Array(this.w * this.h);
        for (let i = 0; i < v.length; i++) v[i] = px[4 * i + 1];
        return v;
    }
}
