// Minimal types for the one KaTeX function wake uses.
declare module "katex" {
    const katex: { renderToString(tex: string, options?: Record<string, unknown>): string };
    export default katex;
}
