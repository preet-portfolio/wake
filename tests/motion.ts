import type { Page } from "@playwright/test";
import { PNG } from "pngjs";

/** Share of canvas pixels that changed noticeably between two screenshots. */
export function changed(a: Buffer, b: Buffer): number {
    const A = PNG.sync.read(a), B = PNG.sync.read(b);
    let n = 0;
    for (let i = 0; i < A.data.length; i += 4) {
        if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 24) n++;
    }
    return n / (A.width * A.height);
}

export const shot = (page: Page) => page.locator("#art").screenshot();
