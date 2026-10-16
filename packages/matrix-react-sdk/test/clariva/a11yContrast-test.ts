/*
Copyright 2026 The Clariva Authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import fs from "node:fs";
import path from "node:path";

import {
    glassOver,
    over as overColour,
    parseColor as parseGlassColour,
    themeTokens as glassTokens,
    wallpaperSweep,
} from "./glassTokens";

/**
 * WCAG contrast guard for the colour pairs the Clariva stylesheets (res/css/clariva) rely on. It reads the REAL Compound
 * token values, resolves them for the light and dark theme and checks text >= 4.5:1 and icons / borders >= 3:1, so a
 * token bump or a new pair in a partial cannot silently regress accessibility. The mix shares used for text on the
 * landing-page gradient are read from _brand.pcss, so changing them there is checked here. The "Clear Water" glass tokens
 * (--cg-*) are measured against these Compound surfaces at the end; their own pairs are in designTokens-test.ts.
 */

type RGB = [number, number, number];
type Theme = "light" | "dark";

const TOKENS_DIR = path.join(__dirname, "../../../../node_modules/@vector-im/compound-design-tokens/assets/web/css");
const BRAND_PCSS = path.join(__dirname, "../../res/css/clariva/_brand.pcss");

function parseTokens(file: string): Record<string, string> {
    const css = fs.readFileSync(path.join(TOKENS_DIR, file), "utf8");
    const out: Record<string, string> = {};
    for (const m of css.matchAll(/(--cpd-[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
    return out;
}

function hslToRgb(h: number, s: number, l: number): RGB {
    const sat = s / 100;
    const light = l / 100;
    const k = (n: number): number => (n + h / 30) % 12;
    const a = sat * Math.min(light, 1 - light);
    const f = (n: number): number => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function parseColor(value: string): { rgb: RGB; alpha: number } | null {
    const hex = value.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
        const n = parseInt(hex[1], 16);
        return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
    }
    const hsl = value.match(/^hsla?\(\s*([\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)$/);
    if (hsl) return { rgb: hslToRgb(+hsl[1], +hsl[2], +hsl[3]), alpha: hsl[4] === undefined ? 1 : +hsl[4] };
    return null;
}

const tokenCache: Partial<Record<Theme, Record<string, string>>> = {};
function tokens(theme: Theme): Record<string, string> {
    return (tokenCache[theme] ??= {
        ...parseTokens("cpd-common-base.css"),
        ...parseTokens(`cpd-theme-${theme}-base.css`),
        ...parseTokens("cpd-common-semantic.css"),
        ...parseTokens(`cpd-theme-${theme}-semantic.css`),
    });
}

/** Resolve `--cpd-color-<name>` (following var() chains) to an opaque colour, compositing alpha over `under`. */
function color(theme: Theme, name: string, under?: RGB): RGB {
    let value = tokens(theme)[`--cpd-color-${name}`];
    for (let i = 0; i < 20 && value?.startsWith("var("); i++) value = tokens(theme)[value.slice(4, -1)];
    const parsed = value ? parseColor(value) : null;
    if (!parsed) throw new Error(`cannot resolve --cpd-color-${name} (${theme})`);
    if (parsed.alpha >= 1 || !under) return parsed.rgb;
    return parsed.rgb.map((c, i) => c * parsed.alpha + under[i] * (1 - parsed.alpha)) as RGB;
}

const luminance = ([r, g, b]: RGB): number => {
    const lin = (c: number): number => {
        const x = c / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

function contrast(a: RGB, b: RGB): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/** color-mix(in srgb, a share%, b) */
const mix = (a: RGB, b: RGB, share: number): RGB => a.map((c, i) => c * share + b[i] * (1 - share)) as RGB;

const hex = (value: string): RGB => parseColor(value)!.rgb;

describe("Clariva colour contrast (WCAG 2.1 AA, Compound tokens)", () => {
    // [foreground token, background token, minimum ratio, where it is used]
    const pairs: [string, string, number, string][] = [
        ["text-primary", "bg-canvas-default", 4.5, "all body text"],
        ["text-secondary", "bg-canvas-default", 4.5, "previews, captions, system events"],
        ["text-secondary", "bg-subtle-secondary", 4.5, "search hint, date pill, banner body, composer placeholder"],
        ["text-action-accent", "bg-canvas-default", 4.5, "unread time"],
        ["text-action-accent", "bg-subtle-secondary", 4.5, "unread time on a hovered row"],
        ["text-success-primary", "bg-canvas-default", 4.5, "credit amounts, availability"],
        ["text-success-primary", "bg-success-subtle", 4.5, "notices, status chips"],
        ["text-critical-primary", "bg-canvas-default", 4.5, "debit amounts, errors"],
        ["text-critical-primary", "bg-critical-subtle", 4.5, "error cards, Refund pill"],
        ["text-on-solid-primary", "bg-accent-rest", 4.5, "FAB, send button, badges, Accept"],
        ["text-on-solid-primary", "bg-action-primary-rest", 4.5, "selected chips / pills, toast"],
        ["text-on-solid-primary", "bg-critical-primary", 4.5, "Reject, error toast, mention badge"],
        ["border-interactive-primary", "bg-canvas-default", 3, "input and composer borders"],
        ["border-focused", "bg-canvas-default", 3, "focus ring"],
        ["border-focused", "bg-subtle-secondary", 3, "focus ring on hovered rows"],
        ["border-focused", "bg-subtle-primary", 3, "focus ring on the selected row"],
        ["icon-secondary", "bg-subtle-secondary", 3, "search icon"],
        ["icon-accent-primary", "bg-canvas-default", 3, "unread marker, mention ring"],
        ["icon-success-primary", "bg-success-subtle", 3, "credit icon"],
        ["icon-critical-primary", "bg-critical-subtle", 3, "debit icon"],
        ["bg-accent-rest", "bg-canvas-default", 3, "switch on, selected-row bar"],
    ];

    describe.each<Theme>(["light", "dark"])("%s theme", (theme) => {
        it.each(pairs)("%s on %s >= %s:1 (%s)", (fg, bg, min) => {
            const canvas = color(theme, "bg-canvas-default");
            const background = color(theme, bg, canvas);
            expect(contrast(color(theme, fg, background), background)).toBeGreaterThanOrEqual(min);
        });

        it("brand navy on brand teal (wallet icon chip) is >= 3:1", () => {
            expect(contrast(hex("#0b1c3d"), hex("#00bfa5"))).toBeGreaterThanOrEqual(3);
        });

        it("message bubbles: text, timestamps and links are >= 4.5:1 on both fills", () => {
            // _chatroom.pcss: out = gray-400 (light) / gray-500 (dark), in = gray-300 / gray-400; meta and link are one
            // step darker / lighter than the fill (and _a11y.pcss re-points text-secondary inside a bubble to meta)
            const fills = theme === "light" ? ["gray-400", "gray-300"] : ["gray-500", "gray-400"];
            const meta = theme === "light" ? "gray-1000" : "gray-1100";
            const link = theme === "light" ? "blue-1000" : "blue-1100";
            for (const fill of fills) {
                const bg = color(theme, fill);
                expect(contrast(color(theme, "text-primary"), bg)).toBeGreaterThanOrEqual(4.5);
                expect(contrast(color(theme, meta), bg)).toBeGreaterThanOrEqual(4.5);
                expect(contrast(color(theme, link), bg)).toBeGreaterThanOrEqual(4.5);
            }
        });

        it("selected / pressed chat row: the darker mix passes where plain text-secondary does not", () => {
            // _chats.pcss --clariva-row-secondary / --clariva-row-accent (70% of the token, 30% text-primary)
            const bg = color(theme, "bg-subtle-primary");
            const primary = color(theme, "text-primary");
            expect(contrast(color(theme, "text-secondary"), bg)).toBeLessThan(4.5); // why the override exists
            expect(contrast(mix(color(theme, "text-secondary"), primary, 0.7), bg)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(mix(color(theme, "text-action-accent"), primary, 0.7), bg)).toBeGreaterThanOrEqual(4.5);
        });

        it("placeholder: text-placeholder is below 4.5:1, so _a11y.pcss uses text-secondary", () => {
            const bg = color(theme, "bg-canvas-default");
            expect(contrast(color(theme, "text-placeholder"), bg)).toBeLessThan(4.5);
            expect(contrast(color(theme, "text-secondary"), bg)).toBeGreaterThanOrEqual(4.5);
        });
    });

    describe("landing page text over the gradient (_brand.pcss shares)", () => {
        const brand = fs.readFileSync(BRAND_PCSS, "utf8");
        const rootBlock = brand.slice(brand.indexOf(":root {"), brand.indexOf('body[class*="cpd-theme-dark"]'));
        const darkBlock = brand.slice(brand.indexOf('body[class*="cpd-theme-dark"]'));
        const share = (block: string, name: string): number => {
            const m = block.match(new RegExp(`--clariva-auth-${name}:\\s*(\\d+)%`));
            if (!m) throw new Error(`--clariva-auth-${name} missing`);
            return +m[1] / 100;
        };
        // _auth.pcss / _brand.pcss: the vertical gradient stops of each theme
        const stops: Record<Theme, string[]> = {
            light: ["#eaf8f3", "#74d2bc", "#e2f6ef", "#9fe2d3", "#f4fbf9"],
            dark: ["#0b1622", "#0f5a50", "#0d1f2c", "#10463f", "#0a1420"],
        };

        it.each<[Theme, string]>([
            ["light", "text-secondary"],
            ["light", "text-critical-primary"],
            ["light", "text-success-primary"],
            ["dark", "text-secondary"],
            ["dark", "text-critical-primary"],
            ["dark", "text-success-primary"],
        ])("%s: mix of %s and text-primary is >= 4.5:1 over every stop", (theme, token) => {
            const name = token === "text-secondary" ? "muted" : token.includes("critical") ? "critical" : "success";
            const s = share(theme === "light" ? rootBlock : darkBlock, name);
            const fg = mix(color(theme, token), color(theme, "text-primary"), s);
            for (const stop of stops[theme]) expect(contrast(fg, hex(stop))).toBeGreaterThanOrEqual(4.5);
        });

        it.each<Theme>(["light", "dark"])("%s: text-primary (title, links) is >= 4.5:1 over every stop", (theme) => {
            for (const stop of stops[theme]) {
                expect(contrast(color(theme, "text-primary"), hex(stop))).toBeGreaterThanOrEqual(4.5);
            }
        });
    });

    describe("Clear Water glass tokens (_brand.pcss) against the Compound tokens they sit next to", () => {
        describe.each<Theme>(["light", "dark"])("%s theme", (theme) => {
            const cg = (token: string): RGB => parseGlassColour(glassTokens(theme)[token]).rgb;

            it.each(["bg-canvas-default", "bg-subtle-secondary", "bg-subtle-primary"])(
                "the unified focus ring (--cg-focus) is >= 3:1 on Compound %s",
                (surface) => {
                    const background = color(theme, surface, color(theme, "bg-canvas-default"));
                    expect(contrast(cg("--cg-focus"), background)).toBeGreaterThanOrEqual(3);
                },
            );

            it("the room / home pane veil keeps --cg-text and --cg-text-2 >= 4.5:1 over every backdrop", () => {
                // --cg-pane-wash-alpha is the ONE knob for this veil (a light one: the aurora must show). Essential text on
                // the bare pane therefore uses OUR tokens, which are tuned against the worst aurora point; Compound's
                // text-secondary is not guaranteed there (DESIGN-SYSTEM.md, "Text colour by surface").
                const wash = parseGlassColour(glassTokens(theme)["--cg-pane-wash"]);
                const failing: string[] = [];
                for (const wall of wallpaperSweep(theme)) {
                    const surface = overColour(wash, wall.rgb);
                    for (const token of ["--cg-text", "--cg-text-2"]) {
                        const ratio = contrast(cg(token), surface);
                        if (ratio < 4.5) failing.push(`${token} on ${wall.name}: ${ratio.toFixed(2)}:1`);
                    }
                }
                expect(failing).toEqual([]);
            });
        });

        it.each<[Theme, number]>([
            ["light", 4.48],
            ["dark", 3.52],
        ])(
            "why --cg-text-* exist (%s): Compound text-secondary drops to %s:1 on the thinnest glass at the worst aurora point",
            (theme, recorded) => {
                // the glass as painted: the backdrop saturate() boost first, then the translucent fill (the figures the doc quotes)
                const ratios = wallpaperSweep(theme).map((wall) => {
                    const surface = glassOver(theme, "thin", wall.rgb);
                    return contrast(color(theme, "text-secondary", surface), surface);
                });
                expect(Math.min(...ratios)).toBeLessThan(4.5);
                expect(Math.min(...ratios)).toBeCloseTo(recorded, 1);
            },
        );
    });
});
