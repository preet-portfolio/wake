// WebGL2 renderer: each step's segments are drawn as instanced quads into a
// buffer that is never cleared, so the wake accumulates on the GPU.
import { WORLD } from "./model";

const VS = `#version 300 es
layout(location=0) in vec2 corner;     // x: 0..1 along, y: -1..1 across
layout(location=1) in vec4 seg;        // x0 y0 x1 y1 in world units
uniform float width;                   // world units
uniform float world;
void main() {
    vec2 a = seg.xy, b = seg.zw;
    vec2 d = b - a;
    float len = length(d);
    vec2 dir = len > 0.0 ? d / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    vec2 p = mix(a - dir * width * 0.5, b + dir * width * 0.5, corner.x) + nrm * corner.y * width * 0.5;
    gl_Position = vec4(p.x / world * 2.0 - 1.0, 1.0 - p.y / world * 2.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
uniform vec4 color;
out vec4 outColor;
void main() { outColor = vec4(color.rgb * color.a, color.a); }`;

export class Renderer {
    readonly gl: WebGL2RenderingContext;
    private buf: WebGLBuffer;
    private cap = 0;
    private uColor: WebGLUniformLocation;
    private uWidth: WebGLUniformLocation;

    constructor(readonly canvas: HTMLCanvasElement) {
        const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: true, premultipliedAlpha: true });
        if (!gl) throw new Error("WebGL2 is not available in this browser");
        this.gl = gl;
        const prog = gl.createProgram()!;
        for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]] as const) {
            const sh = gl.createShader(type)!;
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader");
            gl.attachShader(prog, sh);
        }
        gl.linkProgram(prog);
        gl.useProgram(prog);
        gl.uniform1f(gl.getUniformLocation(prog, "world"), WORLD);
        this.uColor = gl.getUniformLocation(prog, "color")!;
        this.uWidth = gl.getUniformLocation(prog, "width")!;

        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        const quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        this.buf = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(1, 1);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    resize(px: number) {
        if (this.canvas.width !== px) {
            this.canvas.width = px;
            this.canvas.height = px;
        }
        this.gl.viewport(0, 0, px, px);
    }

    clear([r, g, b]: [number, number, number]) {
        this.gl.clearColor(r, g, b, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }

    draw(segs: Float32Array, count: number, rgb: [number, number, number], alpha: number, width: number) {
        if (!count) return;
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        const data = segs.subarray(0, count * 4);
        if (segs.length > this.cap) {
            this.cap = segs.length;
            gl.bufferData(gl.ARRAY_BUFFER, segs.byteLength, gl.DYNAMIC_DRAW);
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
        gl.uniform4f(this.uColor, rgb[0], rgb[1], rgb[2], alpha);
        // never thinner than one device pixel, or lines shimmer
        gl.uniform1f(this.uWidth, Math.max(width, WORLD / this.canvas.width));
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    }
}
