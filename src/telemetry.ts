// Frame-time reporting from real visitors, one event per visit, through
// Vercel Web Analytics (cookieless; no personal data): the device class, the
// GPU class, how many line-heads the device settled on and its frame time.
// Off on localhost and in tests.
import { inject, track } from "@vercel/analytics";

const enabled = location.hostname.endsWith(".vercel.app") && !navigator.webdriver;
if (enabled) inject();

let sent = false;

export function deviceClass(): "phone" | "tablet" | "desktop" {
    if (!matchMedia("(pointer: coarse)").matches) return "desktop";
    return Math.min(screen.width, screen.height) >= 700 ? "tablet" : "phone";
}

export function report(p: { particles: number; frameMs: number; renderer: string }) {
    if (!enabled || sent) return;
    sent = true;
    const software = /swiftshader|llvmpipe|software|basic render/i.test(p.renderer);
    track("perf", {
        device: deviceClass(),
        gpu: software ? "software" : "hardware",
        particles: p.particles,
        // bucketed, so events group into useful rows
        frameMs: Math.round(p.frameMs / 2) * 2,
        fps: Math.min(120, Math.round(1000 / p.frameMs / 5) * 5),
    });
}
