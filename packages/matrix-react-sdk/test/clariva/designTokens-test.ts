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
    CSS_DIR,
    DARK_HEADER,
    DARK_TOKENS,
    FRAUNCES_WOFF2,
    LIGHT_TOKENS,
    REPO_DIR,
    SDK_DIR,
    type CompiledRule,
    type GlassKind,
    type RGB,
    type RGBA,
    type Theme,
    backdrops,
    blockAt,
    blockOf,
    colorsIn,
    compileRules,
    contrast,
    customProps,
    fontFeatureTags,
    fontVerticalMetrics,
    glassOver,
    normalise,
    opaque,
    outranks,
    over,
    parseColor,
    readCss,
    readWoff2,
    specificity,
    themeTokens,
    wallpaperSweep,
    worstContrast,
} from "./glassTokens";
import { FLOATING_CHROME, floatingChromeProblems, rawGlassHits } from "./surfaceScan";

/**
 * Guards the "Clear Water" design tokens, materials and motion (docs/clariva/DESIGN-SYSTEM.md). jsdom applies no
 * stylesheet, so the CSS is read as text (and, where a selector matters, compiled with the webpack pipeline's postcss
 * plugins). The important part is the contrast section: a glass fill is translucent, so the colour behind a label is the
 * fill COMPOSITED over the backdrop, and the backdrop is the wallpaper after the material's `saturate()` boost. Every text
 * colour is checked against every material over EVERY point of the wallpaper (a full sweep, not a handful of named
 * points), not against the flat page colour. Floating chrome is also checked over arbitrary content (white, black,
 * saturated colours), because content, not just the aurora, scrolls under it.
 */

const TEXT = 4.5; // WCAG AA, normal text
const GRAPHIC = 3; // WCAG AA, UI components / focus ring / borders

const GLASS: readonly GlassKind[] = ["thin", "regular", "thick"];
const THEMES: Theme[] = ["light", "dark"];

const rawCss = (file: string): string => fs.readFileSync(path.join(CSS_DIR, file), "utf8");
const BRAND = readCss("_brand.pcss");
const GLASS_CSS = readCss("_glass.pcss");
const MOTION_CSS = readCss("_motion.pcss");
const FONTS_CSS = readCss("_fonts.pcss");
const A11Y_CSS = readCss("_a11y.pcss");
const DOC = fs.readFileSync(path.join(REPO_DIR, "docs/clariva/DESIGN-SYSTEM.md"), "utf8");
const WEBPACK = fs.readFileSync(path.join(REPO_DIR, "webpack.config.js"), "utf8");

const color = (theme: Theme, token: string): RGBA => {
    const value = themeTokens(theme)[token];
    if (!value) throw new Error(`${token} is not declared for the ${theme} theme`);
    return parseColor(value);
};

/** `token` painted over `under`. */
const on = (theme: Theme, token: string, under: RGB): RGB => over(color(theme, token), under);

function section(heading: RegExp, next: RegExp): string {
    const start = DOC.search(heading);
    const end = DOC.search(next);
    if (start < 0 || end < 0) throw new Error("design doc section not found");
    return DOC.slice(start, end);
}
const SECTION_2 = section(/^## 2\. /m, /^## 3\. /m);
const SECTION_3 = section(/^## 3\. /m, /^## 4\. /m);
const SECTION_5 = section(/^## 5\. /m, /^## 6\. /m);
const SECTION_6 = section(/^## 6\. /m, /^## 7\. /m);
const SECTION_11 = DOC.slice(DOC.search(/^## 11\. /m));

/** Prose with its line wrapping (and comment stars) removed, so a phrase can be matched across a wrapped line. */
const flat = (text: string): string => text.replace(/\n\s*(?:\*\s*)?/g, " ").replace(/\s+/g, " ");

// theme-invariant tokens: declared once (light block), not repeated in the dark block
const INVARIANT = /^--cg-(r|fs|z|blur|sat|font|display)-|^--cg-pane-wash-alpha$/;

describe("design tokens: --cg-* in _brand.pcss", () => {
    const documented = [...new Set(SECTION_2.match(/--cg-[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [])];

    it("the design doc names a sensible number of tokens", () => {
        expect(documented.length).toBeGreaterThan(60);
    });

    // tokens that live in another partial than _brand.pcss
    const elsewhere: Record<string, string> = {
        "--cg-font-display": FONTS_CSS,
        "--cg-font-ui": FONTS_CSS,
        "--cg-display-weight": FONTS_CSS,
        "--cg-display-soft": FONTS_CSS,
        "--cg-display-tracking": FONTS_CSS,
    };

    it.each(documented)("%s (named in DESIGN-SYSTEM.md section 2) is declared", (token) => {
        if (elsewhere[token]) {
            expect(elsewhere[token]).toContain(`${token}:`);
            return;
        }
        expect(LIGHT_TOKENS[token]).toBeDefined();
        if (!INVARIANT.test(token)) expect(DARK_TOKENS[token]).toBeDefined(); // both themes
    });

    it("every token _brand.pcss declares is documented in section 2 (the doc is complete)", () => {
        const declared = new Set([...Object.keys(LIGHT_TOKENS), ...Object.keys(DARK_TOKENS)]);
        expect([...declared].filter((t) => !documented.includes(t))).toEqual([]);
    });

    it("the dark block overrides only tokens the light block declares", () => {
        expect(Object.keys(DARK_TOKENS).filter((t) => !(t in LIGHT_TOKENS))).toEqual([]);
        expect(Object.keys(DARK_TOKENS).filter((t) => INVARIANT.test(t))).toEqual([]);
    });

    it("both theme blocks use the same selector mechanism as the older tokens (dark = the <body> theme class)", () => {
        expect(DARK_HEADER).toBe(':root[data-clariva] body[class*="cpd-theme-dark"]');
        // a11yContrast-test.ts slices the file at the FIRST of these; the new block must come after the old one
        expect(BRAND.indexOf('body[class*="cpd-theme-dark"]')).toBeLessThan(BRAND.indexOf(DARK_HEADER));
    });

    it("the value tables in the doc match the stylesheet (hex, rgba, px, rem, shadows)", () => {
        const mismatches: string[] = [];
        let checked = 0;
        for (const line of SECTION_2.split("\n")) {
            if (!line.startsWith("|")) continue;
            const cells = line
                .split("|")
                .slice(1, -1)
                .map((c) => c.trim());
            const token = cells[0]?.match(/^`(--cg-[\w-]+)`$/)?.[1];
            if (!token) continue;
            const quoted = (cell: string | undefined): string | undefined => cell?.match(/^`([^`]+)`$/)?.[1];
            const expectations: [string, string | undefined, string | undefined][] =
                cells.length >= 4 && quoted(cells[2])
                    ? [
                          ["light", quoted(cells[1]), LIGHT_TOKENS[token]],
                          ["dark", quoted(cells[2]), DARK_TOKENS[token]],
                      ]
                    : [["value", quoted(cells[1]), LIGHT_TOKENS[token] ?? elsewhereValue(token)]];
            for (const [which, docValue, cssValue] of expectations) {
                if (docValue === undefined) continue;
                checked++;
                if (cssValue === undefined || normalise(docValue) !== normalise(cssValue)) {
                    mismatches.push(`${token} (${which}): doc "${docValue}" vs css "${cssValue}"`);
                }
            }
        }
        expect(checked).toBeGreaterThan(80);
        expect(mismatches).toEqual([]);
    });

    function elsewhereValue(token: string): string | undefined {
        const css = elsewhere[token];
        return css ? css.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1].trim() : undefined;
    }

    it("the radius scale is 8 / 12 / 16 / 22 / 28 / pill and the type scale 12 / 13 / 15 / 17 / 20 / 28 / 36 / 48", () => {
        expect(["xs", "sm", "md", "lg", "xl"].map((k) => LIGHT_TOKENS[`--cg-r-${k}`])).toEqual([
            "8px",
            "12px",
            "16px",
            "22px",
            "28px",
        ]);
        expect(LIGHT_TOKENS["--cg-r-pill"]).toBe("999px");
        const px = (rem: string): number => parseFloat(rem) * 16;
        expect(
            ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"].map((k) => px(LIGHT_TOKENS[`--cg-fs-${k}`])),
        ).toEqual([12, 13, 15, 17, 20, 28, 36, 48]);
    });

    it("the z-scale is content 0 < chrome 10 < float 20 < menu 40 < dialog 60 < toast 80", () => {
        const z = ["content", "chrome", "float", "menu", "dialog", "toast"].map((k) => +LIGHT_TOKENS[`--cg-z-${k}`]);
        expect(z).toEqual([0, 10, 20, 40, 60, 80]);
    });

    it("shadows are tinted with Ink Navy (light) and never pure black", () => {
        for (const e of ["--cg-e1", "--cg-e2", "--cg-e3"]) {
            expect(LIGHT_TOKENS[e]).toContain("rgba(11, 31, 58,");
            expect(LIGHT_TOKENS[e]).not.toMatch(/rgba\(0,\s*0,\s*0/);
            expect(DARK_TOKENS[e]).not.toMatch(/rgba\(0,\s*0,\s*0/);
        }
    });

    it("the aurora is 3-4 soft radial gradients (no filter, no animation inside the token)", () => {
        for (const theme of THEMES) {
            const aurora = themeTokens(theme)["--cg-aurora"];
            expect((aurora.match(/radial-gradient\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
            expect((aurora.match(/radial-gradient\(/g) ?? []).length).toBeLessThanOrEqual(4);
            expect(aurora).not.toMatch(/filter|blur|animation/);
            // alpha ranges from the brief: light layers .24-.34 (+ amber <= .08), dark .22-.26 (+ amber <= .08)
            const alphas = colorsIn(aurora)
                .map((c) => c.a)
                .filter((a) => a > 0);
            expect(Math.max(...alphas)).toBeLessThanOrEqual(0.38);
            expect(alphas.filter((a) => a <= 0.08)).toHaveLength(1); // the barely-there amber corner
        }
    });

    it("the contrast nudges are in place (final values, see the notes next to each in _brand.pcss)", () => {
        expect(LIGHT_TOKENS["--cg-teal-text"]).toBe("#006f60");
        expect(DARK_TOKENS["--cg-teal-text"]).toBe("#2fd9c1");
        expect(DARK_TOKENS["--cg-coral-text"]).toBe("#ff8a8f");
        expect(DARK_TOKENS["--cg-amber-text"]).toBe("#f8c569");
        expect(LIGHT_TOKENS["--cg-focus-on-tint"]).toBe(LIGHT_TOKENS["--cg-on-tint"]);
        expect(DARK_TOKENS["--cg-focus-on-tint"]).toBe(DARK_TOKENS["--cg-on-tint"]);
    });

    it("the pane wash alpha is ONE token that both themes' --cg-pane-wash read", () => {
        // a light veil on purpose: the aurora must stay visible in the room / Home pane. Essential text on the bare pane
        // uses --cg-text / --cg-text-2 (asserted in a11yContrast-test), never Compound text-secondary.
        expect(+LIGHT_TOKENS["--cg-pane-wash-alpha"]).toBeGreaterThanOrEqual(0.25);
        expect(+LIGHT_TOKENS["--cg-pane-wash-alpha"]).toBeLessThanOrEqual(0.6);
        for (const wash of [LIGHT_TOKENS["--cg-pane-wash"], DARK_TOKENS["--cg-pane-wash"]]) {
            expect(wash).toMatch(/^rgba\(\d+, \d+, \d+, var\(--cg-pane-wash-alpha\)\)$/);
        }
        for (const theme of THEMES) {
            expect(color(theme, "--cg-pane-wash").a).toBe(+LIGHT_TOKENS["--cg-pane-wash-alpha"]);
        }
        // the alpha is not repeated as a literal anywhere else in the file
        expect(BRAND.match(/--cg-pane-wash-alpha:/g)).toHaveLength(1);
    });
});

/** The labels whose contrast ratio is below `min` (empty = all pass); the label says WHERE it failed. */
function below(measured: [string, number][], min: number): string[] {
    return measured.filter(([, ratio]) => ratio < min).map(([label, ratio]) => `${label}: ${ratio.toFixed(2)}:1`);
}

// ── which text colour may sit on which surface ───────────────────────────────────────────────────────────────────────

/** The surfaces a label can sit on, as a function of the wallpaper point behind the glass `kind`. */
const SURFACE_AT: Record<string, (theme: Theme, kind: GlassKind, wall: RGB) => RGB> = {
    "glass": (theme, kind, wall) => glassOver(theme, kind, wall),
    "inset tile": (theme, kind, wall) => on(theme, "--cg-fill-inset", glassOver(theme, kind, wall)),
    "amber wash on glass": (theme, kind, wall) => on(theme, "--cg-amber-wash", glassOver(theme, kind, wall)),
    "amber wash on an inset tile": (theme, kind, wall) =>
        on(theme, "--cg-amber-wash", on(theme, "--cg-fill-inset", glassOver(theme, kind, wall))),
};
const WASH = ["amber wash on glass", "amber wash on an inset tile"];

/** DESIGN-SYSTEM.md section 2, "Text colour by surface": what may be used where. Everything listed is tested at 4.5:1. */
const TEXT_ON: Record<string, string[]> = {
    "--cg-text": ["glass", "inset tile", ...WASH],
    "--cg-text-2": ["glass", "inset tile", ...WASH],
    "--cg-text-3": ["glass", "inset tile"], // NOT the amber wash
    "--cg-coral-text": ["glass", "inset tile"],
    "--cg-teal-text": ["glass", "inset tile"],
    "--cg-amber-text": ["glass", "inset tile", ...WASH],
};
const GROUPS: Record<string, string[]> = {
    "glass": ["glass"],
    "inset tile": ["inset tile"],
    "amber wash": WASH,
};

/** The lowest ratio of `token` over every wallpaper point, both themes and all three glass kinds, on `surfaces`. */
function matrixMinimum(token: string, surfaces: string[]): number {
    let min = Infinity;
    for (const theme of THEMES) {
        const walls = wallpaperSweep(theme);
        const fg = color(theme, token).rgb;
        for (const kind of GLASS) {
            for (const name of surfaces) {
                min = Math.min(min, worstContrast(walls, fg, (wall) => SURFACE_AT[name](theme, kind, wall)).ratio);
            }
        }
    }
    return min;
}

describe("contrast over the composited aurora (AA, worst case of every backdrop, saturate boost included)", () => {
    describe.each(THEMES)("%s theme", (theme) => {
        const walls = wallpaperSweep(theme);
        const fg = (token: string): RGB => color(theme, token).rgb;

        it("found the base, every layer's peak and the darkest and brightest rasterised point", () => {
            const named = backdrops(theme);
            expect(named.length).toBeGreaterThanOrEqual(6);
            expect(named.map((w) => w.name).join()).toMatch(/base.*layer 1 peak.*darkest.*brightest/);
            expect(walls.length).toBeGreaterThan(3000); // the sweep covers the whole box
        });

        describe.each(GLASS)("glass-%s", (kind) => {
            it.each(Object.keys(TEXT_ON))(
                "%s is >= 4.5:1 on every surface DESIGN-SYSTEM.md allows it on, over the whole wallpaper",
                (token) => {
                    const measured = TEXT_ON[token].map((name): [string, number] => {
                        const worst = worstContrast(walls, fg(token), (wall) => SURFACE_AT[name](theme, kind, wall));
                        return [`${name} @ ${worst.where}`, worst.ratio];
                    });
                    expect(below(measured, TEXT)).toEqual([]);
                },
            );

            it("the focus ring is >= 3:1 against the glass and an inset tile over the whole wallpaper", () => {
                const measured = ["glass", "inset tile"].map((name): [string, number] => {
                    const worst = worstContrast(walls, fg("--cg-focus"), (wall) => SURFACE_AT[name](theme, kind, wall));
                    return [`${name} @ ${worst.where}`, worst.ratio];
                });
                expect(below(measured, GRAPHIC)).toEqual([]);
            });

            it("the focus ring inside a cg-glass-tint scope (--cg-focus-on-tint) is also >= 3:1 on the glass around it", () => {
                const worst = worstContrast(walls, fg("--cg-focus-on-tint"), (wall) => glassOver(theme, kind, wall));
                expect(worst.ratio).toBeGreaterThanOrEqual(GRAPHIC);
            });
        });

        it("text and text-2 stay >= 4.5:1 on the BARE wallpaper (text-3 and the accent texts are for glass only)", () => {
            const measured: [string, number][] = [];
            for (const token of ["--cg-text", "--cg-text-2"]) {
                const worst = worstContrast(walls, fg(token), (wall) => wall);
                measured.push([`${token} @ ${worst.where}`, worst.ratio]);
            }
            expect(below(measured, TEXT)).toEqual([]);
        });

        it("the focus ring is >= 3:1 on the bare wallpaper", () => {
            expect(worstContrast(walls, fg("--cg-focus"), (wall) => wall).ratio).toBeGreaterThanOrEqual(GRAPHIC);
        });

        it("glass-tint: --cg-on-tint is >= 4.5:1 and --cg-focus-on-tint >= 3:1 on both gradient stops over every backdrop", () => {
            const stops = colorsIn(themeTokens(theme)["--cg-fill-tint"]);
            expect(stops).toHaveLength(2);
            const measured: [string, number][] = [];
            const ring: [string, number][] = [];
            stops.forEach((stop, i) => {
                const text = worstContrast(walls, fg("--cg-on-tint"), (wall) => over(stop, wall));
                measured.push([`stop ${i + 1} @ ${text.where}`, text.ratio]);
                const focus = worstContrast(walls, fg("--cg-focus-on-tint"), (wall) => over(stop, wall));
                ring.push([`stop ${i + 1} @ ${focus.where}`, focus.ratio]);
            });
            expect(below(measured, TEXT)).toEqual([]);
            expect(below(ring, GRAPHIC)).toEqual([]);
        });
    });

    it("the amber wash: the pairs DESIGN-SYSTEM.md bans there (text-3, coral-text, teal-text) really drop below 4.5:1", () => {
        for (const token of ["--cg-text-3", "--cg-coral-text", "--cg-teal-text"]) {
            expect({ token, banned: matrixMinimum(token, WASH) < TEXT }).toEqual({ token, banned: true });
            expect(TEXT_ON[token]).not.toContain(WASH[0]);
            expect(TEXT_ON[token]).not.toContain(WASH[1]);
        }
    });

    it("the accent texts are not for the bare wallpaper (teal-text and coral-text fall below 4.5:1 on the light one)", () => {
        const walls = wallpaperSweep("light");
        for (const token of ["--cg-teal-text", "--cg-coral-text"]) {
            expect(worstContrast(walls, color("light", token).rgb, (wall) => wall).ratio).toBeLessThan(TEXT);
        }
    });

    it("the focus ring colour on the LIGHT tint is only 1.86:1 (why --cg-focus-on-tint exists)", () => {
        const stops = colorsIn(themeTokens("light")["--cg-fill-tint"]);
        const ratios = stops.map(
            (stop) =>
                worstContrast(wallpaperSweep("light"), color("light", "--cg-focus").rgb, (wall) => over(stop, wall))
                    .ratio,
        );
        expect(Math.min(...ratios)).toBeLessThan(GRAPHIC);
        expect(Math.min(...ratios)).toBeCloseTo(1.86, 1);
    });

    describe("DESIGN-SYSTEM.md section 2 'Text colour by surface' states the measured minimums", () => {
        // rows like: | `--cg-text-2` | 7.3 | 6.2 | 4.5 |      "never" marks a surface the colour is banned on
        const rows = [...SECTION_2.matchAll(/^\|\s*`(--cg-[\w-]+)`\s*\|([^|]*)\|([^|]*)\|([^|]*)\|\s*$/gm)].filter(
            (m) => m[1] in TEXT_ON && /^\s*(\d|never)/.test(m[2]),
        );

        it("lists every text colour", () => {
            expect(rows.map((m) => m[1]).sort()).toEqual(Object.keys(TEXT_ON).sort());
        });

        it.each(rows.map((m) => [m[1], m[2].trim(), m[3].trim(), m[4].trim()]))(
            "%s: on glass %s, on an inset tile %s, on the amber wash %s",
            (token, ...cells) => {
                ["glass", "inset tile", "amber wash"].forEach((group, i) => {
                    const cell = cells[i];
                    if (cell === "never") {
                        expect({ group, banned: GROUPS[group].some((s) => !TEXT_ON[token].includes(s)) }).toEqual({
                            group,
                            banned: true,
                        });
                        return;
                    }
                    const measured = matrixMinimum(token, GROUPS[group]);
                    expect({ group, doc: +cell }).toEqual({ group, doc: Math.floor(measured * 10) / 10 });
                });
            },
        );
    });

    describe.each(THEMES)("solid colour pairs, %s theme", (theme) => {
        const fg = (token: string): RGB => color(theme, token).rgb;

        it("Deep Teal carries white text (AA)", () => {
            expect(contrast(fg("--cg-on-teal-deep"), fg("--cg-teal-deep"))).toBeGreaterThanOrEqual(TEXT);
        });

        it("Teal Deep is a FILL, not a text colour: as text it is below 4.5:1 on the bare wallpaper", () => {
            expect(worstContrast(wallpaperSweep(theme), fg("--cg-teal-deep"), (wall) => wall).ratio).toBeLessThan(TEXT);
        });

        it("Ink Navy on Amber Coin (AA)", () => {
            expect(contrast(fg("--cg-on-amber"), fg("--cg-amber"))).toBeGreaterThanOrEqual(TEXT);
            expect(contrast(fg("--cg-navy"), fg("--cg-amber"))).toBeGreaterThanOrEqual(TEXT);
        });

        it("Coral carries white text (AA); coral-text is AA on the page base", () => {
            expect(contrast(fg("--cg-on-coral"), fg("--cg-coral"))).toBeGreaterThanOrEqual(TEXT);
            expect(contrast(fg("--cg-coral-text"), fg("--cg-bg"))).toBeGreaterThanOrEqual(TEXT);
        });

        it("teal-text and amber-text are AA on the page base", () => {
            expect(contrast(fg("--cg-teal-text"), fg("--cg-bg"))).toBeGreaterThanOrEqual(TEXT);
            expect(contrast(fg("--cg-amber-text"), fg("--cg-bg"))).toBeGreaterThanOrEqual(TEXT);
        });

        it("the focus ring is >= 3:1 on the page base", () => {
            expect(contrast(fg("--cg-focus"), fg("--cg-bg"))).toBeGreaterThanOrEqual(GRAPHIC);
        });

        it("Clarity Teal is NOT a text colour: it fails 4.5:1 on the light base (the reason teal-text exists)", () => {
            if (theme === "light") expect(contrast(fg("--cg-teal"), fg("--cg-bg"))).toBeLessThan(TEXT);
        });
    });

    describe.each(THEMES)("opaque fallbacks (--cg-solid-*), %s theme", (theme) => {
        const solids = ["thin", "regular", "thick", "tint", "inset"] as const;
        const fg = (token: string): RGB => color(theme, token).rgb;

        it.each(solids)("--cg-solid-%s is an opaque 6-digit hex", (kind) => {
            expect(themeTokens(theme)[`--cg-solid-${kind}`]).toMatch(/^#[0-9a-f]{6}$/);
        });

        it.each(["thin", "regular", "thick", "inset"] as const)(
            "text, text-2, text-3, the accent texts and the focus ring pass on --cg-solid-%s",
            (kind) => {
                const solid = fg(`--cg-solid-${kind}`);
                for (const t of Object.keys(TEXT_ON)) {
                    expect({ t, ok: contrast(fg(t), solid) >= TEXT }).toEqual({ t, ok: true });
                }
                expect(contrast(fg("--cg-focus"), solid)).toBeGreaterThanOrEqual(GRAPHIC);
            },
        );

        it.each(solids)("the visible 1px border (--cg-line-strong) is >= 3:1 on --cg-solid-%s", (kind) => {
            const solid = fg(`--cg-solid-${kind}`);
            expect(contrast(on(theme, "--cg-line-strong", solid), solid)).toBeGreaterThanOrEqual(GRAPHIC);
        });

        it("--cg-on-tint is >= 4.5:1 and --cg-focus-on-tint >= 3:1 on --cg-solid-tint", () => {
            expect(contrast(fg("--cg-on-tint"), fg("--cg-solid-tint"))).toBeGreaterThanOrEqual(TEXT);
            expect(contrast(fg("--cg-focus-on-tint"), fg("--cg-solid-tint"))).toBeGreaterThanOrEqual(GRAPHIC);
        });
    });
});

describe("floating chrome over arbitrary content (DESIGN-SYSTEM.md section 3, rule 7)", () => {
    // Room header, composer, tab bar and the scroll-to-latest pill have photos, videos, bubbles and white documents scroll
    // under them, not just the aurora. The worst backdrops for --cg-text are the extremes: pure white (dark glass) and pure
    // black (light glass); the saturated colours are measured too.
    const CONTENT: Record<string, RGB> = {
        "white": [255, 255, 255],
        "black": [0, 0, 0],
        "mid grey": [128, 128, 128],
        "red": [255, 0, 0],
        "green": [0, 255, 0],
        "blue": [0, 0, 255],
        "yellow": [255, 255, 0],
        "cyan": [0, 255, 255],
        "ink navy": [11, 31, 58],
    };

    /** The glass over `content`, then (optionally) a ::before veil of `veil` alpha in the pane-wash colour on top of it. */
    function chrome(theme: Theme, kind: GlassKind, content: RGB, veil = 0): RGB {
        const glass = glassOver(theme, kind, content);
        return veil === 0 ? glass : over({ rgb: color(theme, "--cg-pane-wash").rgb, a: veil }, glass);
    }
    const ratio = (theme: Theme, token: string, surface: RGB): number => contrast(color(theme, token).rgb, surface);

    // Recorded worst cases (--cg-text on cg-glass-thick), the numbers quoted in _glass.pcss rule 7 and in the doc. Thick
    // passes at the existing fills, so no nudge of --cg-fill-thick was needed.
    const RECORDED: [Theme, string, number][] = [
        ["light", "black", 10.29],
        ["light", "white", 16.52],
        ["dark", "white", 5.6],
        ["dark", "black", 16.49],
    ];

    it.each(RECORDED)("%s theme, cg-glass-thick over pure %s content: --cg-text is %s:1", (theme, name, recorded) => {
        const measured = ratio(theme, "--cg-text", chrome(theme, "thick", CONTENT[name]));
        expect(measured).toBeCloseTo(recorded, 1);
        expect(measured).toBeGreaterThanOrEqual(TEXT);
    });

    it.each(THEMES)("%s theme: --cg-text on cg-glass-thick is >= 4.5:1 over every kind of content", (theme) => {
        const measured = Object.entries(CONTENT).map(([name, rgb]): [string, number] => [
            name,
            ratio(theme, "--cg-text", chrome(theme, "thick", rgb)),
        ]);
        expect(below(measured, TEXT)).toEqual([]);
    });

    it("why ONLY --cg-text: text-2 and text-3 fall below 4.5:1 on thick glass over white (dark) or black (light) content", () => {
        const worst = (token: string): number =>
            Math.min(
                ...THEMES.flatMap((theme) =>
                    Object.values(CONTENT).map((rgb) => ratio(theme, token, chrome(theme, "thick", rgb))),
                ),
            );
        expect(worst("--cg-text-2")).toBeLessThan(TEXT);
        expect(worst("--cg-text-3")).toBeLessThan(TEXT);
        expect(worst("--cg-coral-text")).toBeLessThan(TEXT);
    });

    it("why thick: bare regular and thin glass cannot carry --cg-text over white content in the dark theme (3.1:1 and 2.6:1)", () => {
        const regular = ratio("dark", "--cg-text", chrome("dark", "regular", CONTENT.white));
        const thin = ratio("dark", "--cg-text", chrome("dark", "thin", CONTENT.white));
        expect(regular).toBeCloseTo(3.14, 1);
        expect(thin).toBeCloseTo(2.64, 1);
        expect(regular).toBeLessThan(TEXT);
        expect(thin).toBeLessThan(TEXT);
    });

    it.each(["regular", "thin"] as const)(
        "why thick only: %s glass would need a >= 70 %% solid veil under the text to keep --cg-text >= 4.5:1",
        (kind) => {
            // the rule: a >= 70 % solid veil would have to sit UNDER the text (a ::before on the chrome), not the pane wash
            for (const theme of THEMES) {
                const measured = Object.entries(CONTENT).map(([name, rgb]): [string, number] => [
                    `${theme} ${name}`,
                    ratio(theme, "--cg-text", chrome(theme, kind, rgb, 0.7)),
                ]);
                expect(below(measured, TEXT)).toEqual([]);
            }
        },
    );

    describe("the rule is in the doc (sections 3 and 6) and in the stylesheet header", () => {
        it.each([
            ["section 3", SECTION_3],
            ["section 6", SECTION_6],
        ])("%s says floating chrome must be cg-glass-thick and carry --cg-text only", (_name, text) => {
            const prose = flat(text);
            expect(prose).toMatch(/cg-glass-thick/);
            expect(prose).toMatch(/(room header|header)[^.]*composer[^.]*tab bar/i);
            expect(prose).toMatch(/only[^.]*`--cg-text`|`--cg-text`[^.]*only/i);
            // the "why" (a regular fill would need a >= 70 % solid veil) lives in section 3 only
            if (_name === "section 3") expect(prose).toMatch(/70 ?%/);
        });

        it("_glass.pcss repeats it as rule 7 in its header", () => {
            const header = flat(rawCss("_glass.pcss").slice(0, rawCss("_glass.pcss").indexOf("HOW IT WORKS")));
            expect(header).toMatch(/7\. FLOATING CHROME SITS OVER ARBITRARY CONTENT/);
            expect(header).toMatch(/cg-glass-thick/);
            expect(header).toMatch(/--cg-text and nothing else/);
        });
    });

    describe("surface partials follow it (scanner)", () => {
        const veiled = ".mx_RoomHeader { @mixin cg-glass-regular; &::before { background: var(--cg-surface-pane); } }";
        it("flags floating chrome on thin / regular glass (a veil does not rescue it), accepts thick", () => {
            expect(floatingChromeProblems(".mx_RoomHeader { @mixin cg-glass-regular; }")).toHaveLength(1);
            expect(floatingChromeProblems(".mx_MessageComposer { @mixin cg-glass-thin; }")).toHaveLength(1);
            expect(floatingChromeProblems(".mx_ClarivaTabBar { @mixin cg-glass-regular; }")).toHaveLength(1);
            expect(floatingChromeProblems(".mx_RoomHeader { @mixin cg-glass-thick; }")).toEqual([]);
            expect(floatingChromeProblems(veiled)).toHaveLength(1);
            expect(floatingChromeProblems(".mx_ClarivaChatList { @mixin cg-glass-regular; }")).toEqual([]);
            expect(FLOATING_CHROME.test("mx_JumpToBottomButton")).toBe(true);
        });

        it.each(
            fs.readdirSync(CSS_DIR).filter((f) => f.endsWith(".pcss") && !["_glass.pcss", "_brand.pcss"].includes(f)),
        )("%s: no floating chrome on bare thin / regular glass", (file) => {
            expect(floatingChromeProblems(readCss(file))).toEqual([]);
        });
    });
});

describe("materials (_glass.pcss)", () => {
    const mixin = (name: string): string => blockOf(GLASS_CSS, `@define-mixin ${name}`);
    const GLASS_MIXINS = ["cg-glass-thin", "cg-glass-regular", "cg-glass-thick"];

    it.each([...GLASS_MIXINS, "cg-glass-tint", "cg-inset", "cg-scrim"])(
        "%s exists as a mixin AND a utility class",
        (name) => {
            expect(GLASS_CSS).toMatch(new RegExp(`@define-mixin ${name}\\s*\\{`));
            expect(GLASS_CSS).toMatch(new RegExp(`^\\.${name}\\s*\\{\\s*@mixin ${name};`, "m"));
        },
    );

    it.each(GLASS_MIXINS)(
        "%s blurs through the derived token, prefixed, with the saturate boost and a shadow",
        (name) => {
            const kind = name.replace("cg-glass-", "");
            const body = mixin(name);
            expect(body).toContain(`-webkit-backdrop-filter: var(--cg-backdrop-${kind});`);
            expect(body).toContain(`backdrop-filter: var(--cg-backdrop-${kind});`);
            expect(body).toContain(`background-color: var(--cg-surface-${kind});`);
            expect(body).toMatch(/box-shadow: var\(--cg-edge\), var\(--cg-e[123]\);/);
            // the fallbacks only work if a material never reads the raw fill or a literal blur
            expect(body).not.toMatch(/--cg-fill-|--cg-solid-|blur\(/);
            const derived = blockOf(GLASS_CSS, ":root[data-clariva] body");
            expect(derived).toMatch(
                new RegExp(`--cg-backdrop-${kind}:\\s*blur\\(var\\(--cg-blur-${kind}\\)\\)\\s*saturate`),
            );
        },
    );

    it("blur 14 / 24 / 36 px and saturate 170 / 180 / 190 % (scrim blur 6 px)", () => {
        expect(["thin", "regular", "thick", "scrim"].map((k) => LIGHT_TOKENS[`--cg-blur-${k}`])).toEqual([
            "14px",
            "24px",
            "36px",
            "6px",
        ]);
        expect(["thin", "regular", "thick"].map((k) => LIGHT_TOKENS[`--cg-sat-${k}`])).toEqual([
            "170%",
            "180%",
            "190%",
        ]);
    });

    it("fills match the brief: light .58 / .66 / .80 white, dark .46 / .52 / .70 of rgb(12, 32, 48)", () => {
        expect(["thin", "regular", "thick"].map((k) => parseColor(LIGHT_TOKENS[`--cg-fill-${k}`]).a)).toEqual([
            0.58, 0.66, 0.8,
        ]);
        expect(["thin", "regular", "thick"].map((k) => parseColor(DARK_TOKENS[`--cg-fill-${k}`]).a)).toEqual([
            0.46, 0.52, 0.7,
        ]);
        expect(parseColor(DARK_TOKENS["--cg-fill-thin"]).rgb).toEqual([12, 32, 48]);
        expect(parseColor(LIGHT_TOKENS["--cg-fill-inset"]).a).toBe(0.45);
        expect(parseColor(DARK_TOKENS["--cg-fill-inset"]).a).toBe(0.06);
    });

    it("NO backdrop-filter in the mixins used for tiles and bubbles (never nest, never one per row)", () => {
        for (const name of ["cg-glass-tint", "cg-inset"]) {
            expect(mixin(name)).not.toMatch(/backdrop-filter/);
            expect(mixin(name)).not.toMatch(/blur\(/);
        }
        // and the inset and tint recipes read the no-blur surface tokens
        expect(mixin("cg-inset")).toContain("var(--cg-surface-inset)");
        expect(mixin("cg-glass-tint")).toContain("var(--cg-surface-tint)");
    });

    it("the glass-tint recipe has its own colour (--cg-on-tint) so text on it is the checked pair", () => {
        expect(mixin("cg-glass-tint")).toContain("color: var(--cg-on-tint);");
    });

    it("the glass-tint scope re-points the focus ring (and Compound's) to --cg-focus-on-tint, which is not the plain ring", () => {
        const tint = mixin("cg-glass-tint");
        expect(tint).toContain("--cg-focus: var(--cg-focus-on-tint);");
        expect(tint).toContain("--cpd-color-border-focused: var(--cg-focus-on-tint);");
        for (const theme of THEMES) {
            expect(themeTokens(theme)["--cg-focus-on-tint"]).toBe(themeTokens(theme)["--cg-on-tint"]);
            expect(themeTokens(theme)["--cg-focus-on-tint"]).not.toBe(themeTokens(theme)["--cg-focus"]);
        }
        // the plain material mixins do not touch the ring
        for (const name of ["cg-glass-thin", "cg-glass-regular", "cg-glass-thick", "cg-inset"]) {
            expect(mixin(name)).not.toMatch(/--cg-focus|border-focused/);
        }
    });

    it("documents the never-nest rule at the top of the file", () => {
        const raw = rawCss("_glass.pcss");
        const note = raw.indexOf("NEVER NEST backdrop-filter");
        expect(note).toBeGreaterThan(-1);
        expect(note).toBeLessThan(raw.indexOf("{")); // before the first rule
    });

    describe("rules 6 and 7 (animated layers, floating chrome) are written down", () => {
        const header = flat(rawCss("_glass.pcss").slice(0, rawCss("_glass.pcss").indexOf("HOW IT WORKS")));

        it("_glass.pcss header: no animated layer under a backdrop-filter, with the two places the live aurora is allowed", () => {
            expect(header).toMatch(/6\. NO ANIMATED LAYER UNDER A backdrop-filter/);
            expect(header).toMatch(/\(a\) the sign-in page, behind ONE glass card/);
            expect(header).toMatch(
                /\(b\) the Home dashboard, ONLY as a decorative glow behind the greeting area that no glass card overlaps/,
            );
        });

        it("DESIGN-SYSTEM.md section 3 says the same", () => {
            expect(flat(SECTION_3)).toMatch(/Nothing with `backdrop-filter` may overlap an animated layer/);
            expect(flat(SECTION_3)).toMatch(/sign-in page[^.]*ONE glass card/);
            expect(flat(SECTION_3)).toMatch(/Home dashboard[^.]*ONLY as a decorative glow[^.]*no glass card overlaps/);
        });

        it("DESIGN-SYSTEM.md section 6 limits the Home dashboard's live aurora to the greeting glow", () => {
            expect(flat(SECTION_6)).toMatch(/Home dashboard/);
            expect(flat(SECTION_6)).toMatch(/glow behind the greeting[^.]*no glass card overlaps/);
        });
    });

    describe("fallbacks are declared once and switch every material to an opaque, bordered surface", () => {
        const solidTokens = mixin("cg-solid-tokens");

        it("cg-solid-tokens re-points every surface to --cg-solid-*, removes every blur, draws a visible border", () => {
            for (const kind of ["thin", "regular", "thick", "tint", "inset"]) {
                expect(solidTokens).toContain(`--cg-surface-${kind}: var(--cg-solid-${kind});`);
            }
            for (const kind of ["thin", "regular", "thick", "scrim"]) {
                expect(solidTokens).toContain(`--cg-backdrop-${kind}: none;`);
            }
            for (const edge of ["--cg-edge", "--cg-edge-flat", "--cg-edge-tint"]) {
                expect(solidTokens).toContain(`${edge}: inset 0 0 0 1px var(--cg-line-strong);`);
            }
        });

        it.each([
            ["@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))"],
            ["@media (prefers-reduced-transparency: reduce)"],
            ["@media (prefers-contrast: more)"],
        ])("%s applies it on body", (header) => {
            const block = blockOf(GLASS_CSS, header);
            expect(block).toMatch(/:root\[data-clariva\] body\s*\{\s*@mixin cg-solid-tokens;/);
        });

        it("each of the four is declared exactly once (one place), the High contrast theme included", () => {
            expect(GLASS_CSS.match(/@media \(prefers-reduced-transparency: reduce\)/g)).toHaveLength(1);
            expect(GLASS_CSS.match(/@media \(prefers-contrast: more\)/g)).toHaveLength(1);
            expect(GLASS_CSS.match(/@supports not \(/g)).toHaveLength(1);
            // the High contrast theme rule starts a line; the forced-colors selector list only restates it, indented
            expect(GLASS_CSS.match(/^:root\[data-clariva\] body\[class\*="-hc"\]\s*\{/gm)).toHaveLength(1);
            expect(GLASS_CSS).toMatch(/^:root\[data-clariva\] body\[class\*="-hc"\]\s*\{\s*@mixin cg-solid-tokens;/m);
        });

        it("forced-colors: system colours, no blur, no shadow, and every mixin restates its edge as an outline", () => {
            const forced = blockOf(GLASS_CSS, "@media (forced-colors: active)");
            expect(forced).toContain("@mixin cg-solid-tokens;");
            for (const sys of ["Canvas", "ButtonFace"]) expect(forced).toContain(sys);
            expect(forced).toContain("--cg-edge: 0 0 0 0 transparent;");
            const edge = mixin("cg-edge-forced");
            expect(edge).toContain("outline: 1px solid CanvasText;");
            expect(edge).toContain("&:focus-visible");
            for (const name of [...GLASS_MIXINS, "cg-glass-tint", "cg-inset"]) {
                expect(mixin(name)).toContain("@mixin cg-edge-forced;");
            }
        });

        it("the derived tokens are declared on body (so the dark overrides are in scope), not on the root", () => {
            const derived = blockOf(GLASS_CSS, ":root[data-clariva] body");
            for (const t of ["--cg-surface-thin", "--cg-backdrop-thick", "--cg-edge", "--cg-edge-tint"]) {
                expect(derived).toContain(`${t}:`);
            }
            expect(GLASS_CSS).not.toMatch(/^:root\[data-clariva\]\s*\{/m);
        });
    });

    describe("compiled fallbacks (mixins and nesting resolved the way webpack does)", () => {
        let rules: CompiledRule[];
        beforeAll(async () => {
            rules = await compileRules("_glass.pcss");
        });

        /** every rule with this selector (in this at-rule, or at top level), declarations merged, the last one wins */
        const find = (selector: string, condition?: string): CompiledRule | undefined => {
            const matching = rules.filter(
                (r) =>
                    r.selector === selector &&
                    (condition === undefined ? r.conditions.length === 0 : r.conditions.join(" ") === condition),
            );
            if (matching.length === 0) return undefined;
            return {
                ...matching[0],
                declarations: Object.assign({}, ...matching.map((r) => r.declarations)),
            };
        };
        const BODY = ":root[data-clariva] body";
        const HC = ':root[data-clariva] body[class*="-hc"]';

        it("selector specificity helper: (0,2,1) for the derived tokens, (0,3,1) for the High contrast theme", () => {
            expect(specificity(BODY)).toEqual([0, 2, 1]);
            expect(specificity(HC)).toEqual([0, 3, 1]);
            expect(specificity(".cg-aurora--live::before")).toEqual([0, 1, 1]);
            expect(outranks(HC, BODY)).toBe(true);
            expect(outranks(BODY, HC)).toBe(false);
        });

        it("the in-app High contrast themes get the solid tokens and no body wallpaper, and out-rank the derived tokens", () => {
            const hc = find(HC);
            expect(hc).toBeDefined();
            expect(hc!.declarations["--cg-surface-thin"]).toBe("var(--cg-solid-thin)");
            expect(hc!.declarations["--cg-surface-pane"]).toBe("var(--cpd-color-bg-canvas-default)");
            expect(hc!.declarations["--cg-backdrop-thick"]).toBe("none");
            expect(hc!.declarations["--cg-edge"]).toBe("inset 0 0 0 1px var(--cg-line-strong)");
            expect(hc!.declarations["background-image"]).toBe("none");
            // the rule that declares the derived tokens (and the wallpaper) is the plain `body` one
            const derived = find(BODY);
            expect(derived!.declarations["--cg-surface-thin"]).toBe("var(--cg-fill-thin)");
            expect(derived!.declarations["background-image"]).toBe("var(--cg-aurora)");
            expect(outranks(HC, BODY)).toBe(true);
        });

        it("under forced colours the High contrast selector is restated LATER at the same specificity, so Canvas wins", () => {
            const plain = rules.findIndex((r) => r.selector === HC && r.conditions.length === 0);
            const forced = rules.findIndex(
                (r) => r.selector === HC && r.conditions[0] === "@media (forced-colors: active)",
            );
            expect(plain).toBeGreaterThan(-1);
            expect(forced).toBeGreaterThan(plain);
            expect(rules[forced].declarations["--cg-surface-thin"]).toBe("Canvas");
            expect(find(BODY, "@media (forced-colors: active)")!.declarations["--cg-surface-thin"]).toBe("Canvas");
        });

        it.each([
            ["the High contrast theme", HC, undefined],
            ["prefers-contrast: more", BODY, "@media (prefers-contrast: more)"],
            ["prefers-reduced-transparency", BODY, "@media (prefers-reduced-transparency: reduce)"],
        ])(
            "%s switches the wallpaper LAYER off (flat --cg-bg, no drift), with enough specificity",
            (_n, parent, cond) => {
                const layer = find(`${parent} .cg-aurora`, cond);
                const before = find(`${parent} .cg-aurora--live::before`, cond);
                expect(layer?.declarations["background-image"]).toBe("none");
                expect(before?.declarations["background-image"]).toBe("none");
                expect(before?.declarations["animation"]).toBe("none");
                expect(before?.declarations["will-change"]).toBe("auto");
                // out-ranks every rule that paints or animates the layer (section 4 of the file)
                expect(outranks(`${parent} .cg-aurora--live::before`, ".cg-aurora--live::before")).toBe(true);
                expect(outranks(`${parent} .cg-aurora`, ".cg-aurora")).toBe(true);
            },
        );

        it("under forced colours the wallpaper layer is hidden and a skeleton block gets a 1px CanvasText outline", () => {
            expect(find(":root[data-clariva] .cg-aurora", "@media (forced-colors: active)")!.declarations.display).toBe(
                "none",
            );
            const skeleton = find(":root[data-clariva] .cg-skeleton", "@media (forced-colors: active)");
            expect(skeleton!.declarations.outline).toBe("1px solid CanvasText");
            expect(outranks(":root[data-clariva] .cg-skeleton", ".cg-skeleton")).toBe(true);
        });

        it("the live aurora only holds a compositor layer (will-change) while it animates", () => {
            const live = find(".cg-aurora--live::before")!;
            expect(live.declarations["will-change"]).toBe("transform");
            expect(live.declarations["animation"]).toMatch(/^cg-aurora-drift 72s /);
            expect(find(".cg-aurora--live.cg-paused::before")!.declarations).toMatchObject({
                "animation-play-state": "paused",
                "will-change": "auto",
            });
            // nothing else in the file asks for a compositor layer
            expect(
                rules.filter((r) => "will-change" in r.declarations && r.declarations["will-change"] !== "auto"),
            ).toHaveLength(1);
        });
    });

    describe("aurora wallpaper", () => {
        it("paints the app canvas (body) with the aurora over --cg-bg, static", () => {
            const derived = blockOf(GLASS_CSS, ":root[data-clariva] body");
            expect(derived).toContain("background-color: var(--cg-bg);");
            expect(derived).toContain("background-image: var(--cg-aurora);");
            expect(derived).not.toMatch(/animation|transition/);
        });

        it("the room / home pane lets it through behind a veil that falls back to the stock canvas", () => {
            expect(GLASS_CSS).toMatch(
                /:root\[data-clariva\] body \.mx_MatrixChat_wrapper \.mx_MatrixChat > \.mx_RoomView_wrapper\s*\{\s*background-color: var\(--cg-surface-pane\);/,
            );
            expect(blockOf(GLASS_CSS, "@define-mixin cg-solid-tokens")).toContain(
                "--cg-surface-pane: var(--cpd-color-bg-canvas-default);",
            );
        });

        it(".cg-aurora--live drifts ONE pseudo-element with transform only, 60-90 s, and can be paused", () => {
            const live = blockOf(GLASS_CSS, ".cg-aurora--live");
            expect(live).toMatch(/&::before\s*\{/);
            const duration = +live.match(/animation:\s*cg-aurora-drift\s+(\d+)s/)![1];
            expect(duration).toBeGreaterThanOrEqual(60);
            expect(duration).toBeLessThanOrEqual(90);
            expect(live).toMatch(/&\.cg-paused::before\s*\{\s*animation-play-state: paused;/);
            expect(live).not.toMatch(/filter|blur/);
            const keyframes = blockOf(MOTION_CSS, "@keyframes cg-aurora-drift");
            const props = [...keyframes.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
            expect([...new Set(props)]).toEqual(["transform"]);
        });

        it("a live aurora is switched off under prefers-reduced-motion (and its compositor layer released)", () => {
            const block = blockOf(MOTION_CSS, "@media (prefers-reduced-motion: reduce)");
            expect(block).toMatch(/\.cg-aurora--live::before\s*\{\s*animation: none;\s*will-change: auto;/);
        });
    });
});

describe("motion (_motion.pcss)", () => {
    const tokens = customProps(blockOf(MOTION_CSS, ":root[data-clariva]"));
    const mixin = (name: string): string => blockOf(MOTION_CSS, `@define-mixin ${name}`);

    it("declares the three easings, the spring (with an ease-out fallback) and the duration scale", () => {
        expect(tokens["--cg-ease-out"]).toBe("cubic-bezier(0.23, 1, 0.32, 1)");
        expect(tokens["--cg-ease-in-out"]).toBe("cubic-bezier(0.77, 0, 0.175, 1)");
        expect(tokens["--cg-ease-drawer"]).toBe("cubic-bezier(0.32, 0.72, 0, 1)");
        expect(tokens["--cg-spring"]).toBe("var(--cg-ease-out)"); // fallback
        expect(blockOf(MOTION_CSS, "@supports (transition-timing-function: linear(0, 1))")).toMatch(
            /--cg-spring:\s*linear\(\s*0,/,
        );
        expect(["press", "hover", "small", "medium", "sheet"].map((k) => tokens[`--cg-dur-${k}`])).toEqual([
            "120ms",
            "160ms",
            "180ms",
            "240ms",
            "380ms",
        ]);
    });

    it("exits are 60-70% of the matching enter", () => {
        for (const k of ["small", "medium", "sheet"]) {
            const enter = parseInt(tokens[`--cg-dur-${k}`]);
            const exit = parseInt(tokens[`--cg-dur-exit-${k}`]);
            expect(exit / enter).toBeGreaterThanOrEqual(0.6);
            expect(exit / enter).toBeLessThanOrEqual(0.7);
        }
    });

    it("every motion token the doc's section 5 names exists", () => {
        const named = [
            ...new Set(SECTION_5.match(/--cg-(?:ease|dur|spring|press|enter|exit|lift|transition)[a-z-]*/g) ?? []),
        ].filter((t) => !t.endsWith("-"));
        expect(named.length).toBeGreaterThan(10);
        expect(named).toContain("--cg-transition-extra");
        for (const token of named) expect(MOTION_CSS).toContain(`${token}:`);
    });

    it("press feedback: scale(.97) on :active, 120 ms ease-out, touch-action manipulation", () => {
        expect(tokens["--cg-press-scale"]).toBe("0.97");
        const press = mixin("cg-press");
        expect(press).toContain("touch-action: manipulation;");
        expect(press).toMatch(
            /&:active:not\(:disabled, \[aria-disabled="true"\]\)\s*\{\s*transform: scale\(var\(--cg-press-scale\)\)/,
        );
        expect(press).toContain("transform var(--cg-dur-press) var(--cg-ease-out)");
    });

    it("hover lift is gated by (hover: hover) and (pointer: fine), and moves with transform only", () => {
        const lift = mixin("cg-hover-lift");
        expect(lift).toContain("@media (hover: hover) and (pointer: fine)");
        expect(lift).toMatch(/transform: var\(--cg-lift\);/);
        expect(lift).not.toMatch(/(?<!-)top:|(?<!-)left:|margin|box-shadow/);
        expect(mixin("cg-pressable")).toContain("@media (hover: hover) and (pointer: fine)");
    });

    describe("the transition shorthand of cg-press / cg-hover-lift / cg-pressable can be composed", () => {
        it("--cg-transition-extra has a harmless default and is the LAST item of all three transition lists", () => {
            expect(tokens["--cg-transition-extra"]).toBe("color 0s");
            for (const name of ["cg-press", "cg-hover-lift", "cg-pressable"]) {
                expect(mixin(name)).toMatch(/transition:[^;]*,\s*var\(--cg-transition-extra\);/);
            }
        });

        it("the mixin comments say loudly that the shorthand clobbers a surface's own transition", () => {
            const raw = rawCss("_motion.pcss");
            expect(raw).toMatch(/COMPOSING TRANSITIONS/);
            expect(raw.match(/WARNING: [^\n]*(`transition` shorthand|`transition`)/g)?.length).toBeGreaterThanOrEqual(
                3,
            );
            expect(raw).toMatch(/CLOBBER/);
        });

        it("the doc says it in section 5 and in the mixin table", () => {
            expect(SECTION_5).toMatch(/clobber/i);
            expect(SECTION_5).toContain("--cg-transition-extra");
            expect(SECTION_11).toMatch(/clobber/i);
            expect(SECTION_11).toContain("--cg-transition-extra");
        });
    });

    it("enter / exit: opacity + translate/scale .96, exit shorter than enter, never scale(0)", () => {
        expect(tokens["--cg-enter-from"]).toMatch(/scale\(0\.96\)/);
        expect(tokens["--cg-exit-to"]).toMatch(/scale\(0\.96\)/);
        expect(mixin("cg-presence-hidden")).toContain("var(--cg-dur-exit-medium)");
        expect(mixin("cg-presence-shown")).toContain("var(--cg-dur-medium)");
        expect(mixin("cg-enter")).toContain("var(--cg-dur-medium)");
        expect(mixin("cg-exit")).toContain("var(--cg-dur-exit-medium)");
        for (const name of ["cg-enter", "cg-exit"]) {
            expect(blockOf(MOTION_CSS, `@keyframes ${name}`)).toMatch(/opacity/);
        }
    });

    it("cg-enter NEVER fills forwards / both (it would freeze transform and opacity against press and hover); cg-exit keeps both", () => {
        const offenders: string[] = [];
        for (const file of fs.readdirSync(CSS_DIR).filter((f) => f.endsWith(".pcss"))) {
            for (const m of readCss(file).matchAll(/animation(?:-name)?\s*:([^;}]*\bcg-enter\b[^;}]*)/g)) {
                if (/(?<![\w-])(both|forwards)(?![\w-])/.test(m[1])) offenders.push(`${file}: animation:${m[1]}`);
            }
            for (const m of readCss(file).matchAll(/animation-fill-mode\s*:\s*(both|forwards)/g)) {
                // a longhand next to cg-enter in the same rule would undo `backwards`
                offenders.push(`${file}: ${m[0]} (check it is not on a cg-enter element)`);
            }
        }
        expect(offenders).toEqual([]);
        expect(mixin("cg-enter")).toMatch(/animation: cg-enter [^;]*\bbackwards;/);
        expect(mixin("cg-exit")).toMatch(/animation: cg-exit [^;]*\bboth;/);
        // the .cg-coin__glint sweep is the one other filled animation; it is not an enter and starts from opacity 0
        expect(MOTION_CSS).toMatch(/\.cg-coin__glint\s*\{[^}]*animation: cg-glint [^;]*\bboth;/);
    });

    it("the pulse animates opacity only, on a 1.2 s loop", () => {
        const props = [...blockOf(MOTION_CSS, "@keyframes cg-pulse").matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
        expect([...new Set(props)]).toEqual(["opacity"]);
        expect(mixin("cg-pulse")).toContain("cg-pulse 1.2s");
        expect(MOTION_CSS).toMatch(/^\.cg-pulse\s*\{\s*@mixin cg-pulse;/m);
    });

    it("the wallet skeleton uses the shared pulse recipe, not a copy of it", () => {
        const wallet = readCss("_wallet.pcss");
        expect(wallet).not.toMatch(/@keyframes mx_ClarivaSkel_pulse/);
        expect(wallet).not.toMatch(/animation:\s*mx_ClarivaSkel_pulse/);
        expect(wallet).toMatch(/\.mx_ClarivaSkel\s*\{[^}]*@mixin cg-pulse;/);
    });

    it("exactly ONE prefers-reduced-motion block removes movement at the source", () => {
        expect(MOTION_CSS.match(/@media \(prefers-reduced-motion: reduce\)/g)).toHaveLength(1);
        const block = blockOf(MOTION_CSS, "@media (prefers-reduced-motion: reduce)");
        expect(block).toContain("--cg-enter-from: none;");
        expect(block).toContain("--cg-exit-to: none;");
        expect(block).toContain("--cg-lift: none;");
        expect(block).toContain("--cg-press-scale: 1;");
        expect(block).toMatch(/\.cg-pulse\s*\{\s*animation: none;/);
        expect(block).toMatch(/\.cg-coin__glint\s*\{\s*animation: none;/);
    });

    it("reduced motion is described as what it is: INSTANT (the _a11y.pcss blanket), movement neutralised at the source", () => {
        // the blanket really is zero-length and !important, so nothing is left to cross-fade
        expect(A11Y_CSS).toMatch(/transition-duration: 0\.01ms !important;/);
        expect(A11Y_CSS).toMatch(/animation-duration: 0\.01ms !important;/);
        const raw = flat(rawCss("_motion.pcss"));
        expect(raw).toMatch(/reduced motion is INSTANT/);
        expect(raw).toMatch(/neutralised at the source/);
        expect(flat(DOC)).toMatch(/Reduced motion is instant; movement tokens are also neutralised at the source/);
        for (const text of [raw, flat(DOC), flat(rawCss("_a11y.pcss"))]) {
            expect(text).not.toMatch(/gentl(e|er) cross-fade/i);
            expect(text).not.toMatch(/a cross-fade stays/i);
        }
    });

    it("the Clariva stylesheets never use `transition: all`, scale(0), a bare ease-in, or animate backdrop-filter", () => {
        const offenders: string[] = [];
        for (const file of fs.readdirSync(CSS_DIR).filter((f) => f.endsWith(".pcss"))) {
            const css = readCss(file);
            if (/transition\s*:\s*all\b/.test(css)) offenders.push(`${file}: transition: all`);
            if (/transition-property\s*:\s*all\b/.test(css)) offenders.push(`${file}: transition-property: all`);
            if (/scale\(\s*0\s*[,)]/.test(css)) offenders.push(`${file}: scale(0)`);
            if (/scale3d\(\s*0\s*,/.test(css)) offenders.push(`${file}: scale3d(0`);
            if (/(?<![\w-])ease-in(?![\w-])/.test(css)) offenders.push(`${file}: ease-in`);
            if (/transition[^;{}]*backdrop-filter/.test(css)) offenders.push(`${file}: transition on backdrop-filter`);
            for (const m of css.matchAll(/@keyframes\s+[\w-]+\s*\{/g)) {
                if (/backdrop-filter|blur\(/.test(blockAt(css, (m.index ?? 0) + m[0].length - 1))) {
                    offenders.push(`${file}: backdrop-filter / blur animated in a keyframe`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});

describe("display font (_fonts.pcss)", () => {
    const FONT_BYTES = fs.readFileSync(FRAUNCES_WOFF2);
    const FONT_TABLES = readWoff2(FRAUNCES_WOFF2);
    const mixin = (name: string): string => blockOf(FONTS_CSS, `@define-mixin ${name}`);
    const faces = [...FONTS_CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
    const fallbackFace = faces.find((f) => f.includes('"Fraunces Fallback"')) ?? "";

    it("ships a Latin-subset woff2 under 120 KiB (117.96 KiB, as the doc says) with its OFL licence", () => {
        expect(FONT_BYTES.subarray(0, 4).toString("latin1")).toBe("wOF2");
        expect(FONT_BYTES.length).toBeLessThan(120 * 1024);
        expect(DOC).toContain(`${(FONT_BYTES.length / 1024).toFixed(2)} KiB`);
        expect(rawCss("_fonts.pcss")).toContain(`${(FONT_BYTES.length / 1024).toFixed(2)} KiB`);
        const licence = fs.readFileSync(path.join(SDK_DIR, "res/fonts/clariva/OFL-Fraunces.txt"), "utf8");
        expect(licence).toContain("SIL OPEN FONT LICENSE Version 1.1");
        expect(licence).toContain("Fraunces");
    });

    it("@font-face: variable weight range, swap, latin unicode-range, woff2, file-loader-compatible url", () => {
        const face = blockOf(FONTS_CSS, "@font-face");
        expect(face).toContain("font-family: Fraunces;");
        expect(face).toContain("font-weight: 300 700;");
        expect(face).toContain("font-display: swap;");
        expect(face).toMatch(/unicode-range:\s*U\+0000-00FF/);
        expect(face).toContain('format("woff2")');
        const url = face.match(/url\("([^"]+)"\)/)![1];
        expect(url.startsWith("$(res)/fonts/clariva/")).toBe(true); // $(res) = the SDK's res dir in every theme entry
        expect(fs.existsSync(path.join(SDK_DIR, "res", url.slice("$(res)/".length)))).toBe(true);
    });

    it("the stacks put the metrics-matched fallback second, then Georgia (display), and keep the Inter stack (UI)", () => {
        expect(FONTS_CSS).toMatch(/--cg-font-display:\s*"Fraunces",\s*"Fraunces Fallback",\s*georgia,\s*serif;/i);
        expect(FONTS_CSS).toContain("--cg-font-ui: $font-family;");
    });

    describe("'Fraunces Fallback': a local Georgia scaled to Fraunces' metrics, so the font swap does not reflow", () => {
        const metrics = fontVerticalMetrics(FONT_TABLES);
        const pct = (descriptor: string): number => +fallbackFace.match(new RegExp(`${descriptor}:\\s*([\\d.]+)%`))![1];

        it("is a local() Georgia face whose weight range means no synthetic bold", () => {
            expect(fallbackFace).toMatch(/src:\s*local\("Georgia"\);/);
            expect(fallbackFace).toContain("font-weight: 300 700;");
            expect(fallbackFace).not.toMatch(/url\(/); // nothing to download
        });

        it("size-adjust is a plausible ~107 % (Fraunces display text is 105-108 % as wide as Georgia)", () => {
            expect(pct("size-adjust")).toBeGreaterThanOrEqual(105);
            expect(pct("size-adjust")).toBeLessThanOrEqual(108);
        });

        it("the overrides are Fraunces' own hhea metrics divided by size-adjust (the UA scales them by it again)", () => {
            expect(metrics).toEqual({ unitsPerEm: 2000, ascent: 1956, descent: 510, lineGap: 0 });
            const adjust = pct("size-adjust") / 100;
            expect(pct("ascent-override")).toBeCloseTo((metrics.ascent / metrics.unitsPerEm / adjust) * 100, 1);
            expect(pct("descent-override")).toBeCloseTo((metrics.descent / metrics.unitsPerEm / adjust) * 100, 1);
            expect(pct("line-gap-override")).toBeCloseTo((metrics.lineGap / metrics.unitsPerEm / adjust) * 100, 1);
        });
    });

    it('never writes the invalid `"opsz" auto`; the optical size comes from font-optical-sizing', () => {
        expect(FONTS_CSS).not.toMatch(/"opsz"\s+auto/);
        expect(mixin("cg-display")).toContain("font-optical-sizing: auto;");
        expect(mixin("cg-display")).toContain('"SOFT" var(--cg-display-soft)');
    });

    describe("numerals: Fraunces has no tnum / lnum / pnum, so money in a column uses the UI face", () => {
        it("the shipped Fraunces subset declares NO figure-style feature (if this fails, the subset changed: revisit cg-numerals)", () => {
            const tags = fontFeatureTags(FONT_TABLES);
            expect(tags).toEqual(expect.arrayContaining(["kern", "liga"]));
            for (const tag of ["tnum", "lnum", "pnum", "onum"]) expect(tags).not.toContain(tag);
        });

        it("cg-numerals switches to the UI face (Inter has tnum) and asks for tabular lining figures", () => {
            const numerals = mixin("cg-numerals");
            expect(numerals).toContain("font-family: var(--cg-font-ui);");
            expect(numerals).toMatch(/font-variant-numeric:\s*tabular-nums lining-nums;/);
            expect(numerals).not.toContain("--cg-font-display");
        });

        it("the doc and the stylesheet say Fraunces numerals are proportional and fine for a hero balance only", () => {
            const prose = flat(DOC);
            expect(prose).not.toMatch(/Money numerals are tabular in Fraunces/);
            expect(prose).toMatch(/Fraunces numerals are proportional/);
            expect(prose).toMatch(/hero balance/);
            expect(prose).toMatch(/column or list of amounts[^.]*`cg-numerals`/);
            expect(rawCss("_fonts.pcss")).toMatch(/PROPORTIONAL/);
        });
    });

    describe("display tracking only at sizes >= 28px", () => {
        it("cg-display keeps the -0.02em tracking token; cg-display-sm is the same face with NO negative tracking", () => {
            expect(mixin("cg-display")).toContain("letter-spacing: var(--cg-display-tracking);");
            const small = mixin("cg-display-sm");
            expect(small).toContain("letter-spacing: 0;");
            expect(small).not.toContain("--cg-display-tracking");
            for (const part of [
                "font-family: var(--cg-font-display);",
                "font-optical-sizing: auto;",
                "font-weight: var(--cg-display-weight);",
            ]) {
                expect(small).toContain(part);
            }
            expect(FONTS_CSS).toMatch(/^\.cg-display-sm\s*\{\s*@mixin cg-display-sm;/m);
        });

        it("the doc tells the surface agents which one to use", () => {
            expect(DOC).toContain("`cg-display-sm`");
            expect(DOC).toMatch(/28px/);
            expect(SECTION_11).toMatch(/`cg-display`[^\n]*28px/);
        });
    });

    it("the page CSP lets the font load from 'self' and webpack emits woff2 referenced from CSS", () => {
        const html = fs.readFileSync(path.join(REPO_DIR, "src/vector/index.html"), "utf8");
        expect(html).toMatch(/font-src[^;]*'self'/);
        expect(WEBPACK).toMatch(/test:\s*\/\\\.\(gif\|png\|ttf\|woff\|woff2\|xml\|ico\)\$\//);
    });

    it("webpack preloads the Fraunces woff2 next to Inter, as a font with crossorigin (a Clariva edit)", () => {
        const start = WEBPACK.indexOf("new HtmlWebpackInjectPreload");
        const preload = WEBPACK.slice(start, WEBPACK.indexOf("Upload to sentry", start));
        expect(start).toBeGreaterThan(-1);
        expect(preload).toContain("match: /.*Inter.*\\.woff2$/");
        expect(preload).toContain("match: /.*Fraunces.*\\.woff2$/");
        expect(preload).toMatch(/CLARIVA:/);
        expect(preload).toMatch(/as: "font"/);
        expect(preload).toMatch(/type: "font\/woff2"/);
        expect(preload).toMatch(/crossorigin: true/);
        // and the pattern really selects the emitted file name (fonts/clariva/Fraunces-VF-latin.<hash>.woff2)
        expect(/.*Fraunces.*\.woff2$/.test("fonts/clariva/Fraunces-VF-latin.1a2b3c4.woff2")).toBe(true);
        expect(/.*Fraunces.*\.woff2$/.test("fonts/Inter/Inter-Regular.6cc68d6.woff2")).toBe(false);
    });
});

describe("focus ring (_a11y.pcss)", () => {
    it("the fallback ring uses --cg-focus, 2px solid, offset 2px", () => {
        expect(A11Y_CSS).toMatch(
            /:focus-visible\s*\{\s*outline: 2px solid var\(--cg-focus, var\(--cpd-color-border-focused\)\);\s*outline-offset: 2px;/,
        );
    });

    it("Compound's own rings follow --cg-focus in the normal themes and keep their colour in the -hc themes", () => {
        const block = blockOf(A11Y_CSS, ':root[data-clariva] body:not([class*="-hc"])');
        expect(block).toContain("--cpd-color-border-focused: var(--cg-focus);");
    });
});

describe("the foundation API in the doc is true", () => {
    const FOUNDATION = ["_glass.pcss", "_motion.pcss", "_fonts.pcss"];
    const mixins = FOUNDATION.flatMap((f) => [...readCss(f).matchAll(/@define-mixin ([\w-]+)/g)].map((m) => m[1]));
    const classes = FOUNDATION.flatMap((f) =>
        [...readCss(f).matchAll(/^\.([\w-]+)\s*\{\s*@mixin ([\w-]+);/gm)].filter((m) => m[1] === m[2]).map((m) => m[1]),
    );
    const mixinOnly = mixins.filter((m) => !classes.includes(m));

    it("not every mixin has a utility class, and the doc does not claim so", () => {
        expect(mixinOnly.length).toBeGreaterThan(3);
        expect(DOC).not.toMatch(/Every mixin has a utility class/);
    });

    it("the doc lists every mixin-only name (no utility class) in section 11", () => {
        // the sentence starts a line and may wrap; it ends at the blank line
        const line = SECTION_11.match(/^Mixin-only[\s\S]*?\n\n/m)?.[0] ?? "";
        expect(line).not.toBe("");
        const named = [...line.matchAll(/`(cg-[\w-]+)`/g)].map((m) => m[1]);
        expect(mixinOnly.filter((m) => !named.includes(m))).toEqual([]);
        expect(named.filter((m) => !mixins.includes(m))).toEqual([]);
    });

    it("every utility class the doc names exists", () => {
        for (const name of [
            "cg-glass-thin",
            "cg-glass-regular",
            "cg-glass-thick",
            "cg-glass-tint",
            "cg-inset",
            "cg-scrim",
            "cg-pressable",
            "cg-enter",
            "cg-exit",
            "cg-pulse",
            "cg-display",
            "cg-display-sm",
            "cg-numerals",
        ]) {
            expect(classes).toContain(name);
        }
    });
});

describe("surface partials do not write glass by hand", () => {
    // The foundation owns the recipes. A surface that writes `backdrop-filter`, `blur(` or the raw --cg-fill-* /
    // --cg-solid-* tokens keeps its blur and translucency under reduced transparency, more contrast and forced colours.
    // The allow-list is EXPLICIT (file + selector + what) so it can only shrink; it is EMPTY now (the sign-in logo tile was
    // its last entry and became an opaque paper tile), and a new entry has to be argued for in review.
    const ALLOWED: { file: string; selector: string; kinds: string[] }[] = [];
    const SURFACE_FILES = fs
        .readdirSync(CSS_DIR)
        .filter((f) => f.endsWith(".pcss") && f !== "_glass.pcss" && f !== "_brand.pcss");

    it("scans every other partial, including the foundation's _motion / _fonts / _a11y", () => {
        expect(SURFACE_FILES).toEqual(
            expect.arrayContaining(["_motion.pcss", "_fonts.pcss", "_a11y.pcss", "_wallet.pcss", "_chats.pcss"]),
        );
        expect(SURFACE_FILES).not.toContain("_glass.pcss");
        expect(SURFACE_FILES).not.toContain("_brand.pcss");
    });

    it("the scanner finds hand-written glass in a fixture (and lets `backdrop-filter: none` through)", () => {
        const fixture = `
            .a { backdrop-filter: blur(8px); }
            .b { -webkit-backdrop-filter: saturate(2); background: var(--cg-fill-thin); }
            .c { .d { color: var(--cg-solid-thick); } }
            .e { backdrop-filter: none; }
            .f { @mixin cg-glass-regular; }
        `;
        const hits = rawGlassHits(fixture).map((h) => `${h.kind} in ${h.chain.join(" > ")}`);
        expect(hits).toEqual(
            expect.arrayContaining([
                "backdrop-filter in .a",
                "blur( in .a",
                "backdrop-filter in .b",
                "--cg-fill- in .b",
                "--cg-solid- in .c > .d",
            ]),
        );
        expect(hits.filter((h) => h.endsWith(".e") || h.endsWith(".f"))).toEqual([]);
    });

    it("the allow-list is empty (it can only shrink)", () => {
        expect(ALLOWED).toEqual([]);
    });

    it("no partial writes raw blur / backdrop-filter / --cg-fill-* / --cg-solid-* (nothing is allow-listed)", () => {
        const offenders: string[] = [];
        const used = new Set<string>();
        for (const file of SURFACE_FILES) {
            for (const hit of rawGlassHits(readCss(file))) {
                const entry = ALLOWED.find(
                    (a) => a.file === file && hit.chain.includes(a.selector) && a.kinds.includes(hit.kind),
                );
                if (entry) used.add(`${entry.file} ${entry.selector}`);
                else offenders.push(`${file}: ${hit.kind} (${hit.text}) in ${hit.chain.join(" > ")}`);
            }
        }
        expect(offenders).toEqual([]);
        // a stale entry must be deleted, not left around to excuse a future regression
        expect([...used]).toEqual(ALLOWED.map((a) => `${a.file} ${a.selector}`));
    });
});

describe("_clariva.pcss import order", () => {
    const imports = [...readCss("_clariva.pcss").matchAll(/@import "\.\/([\w.-]+)";/g)].map((m) => m[1]);
    const FOUNDATION_ORDER = ["_brand.pcss", "_fonts.pcss", "_glass.pcss", "_motion.pcss"];

    it("starts with brand, fonts, glass, motion (tokens and mixins before anyone uses them)", () => {
        expect(imports.slice(0, 4)).toEqual(FOUNDATION_ORDER);
    });

    it("ends with _a11y.pcss, which must out-rank every surface partial", () => {
        expect(imports[imports.length - 1]).toBe("_a11y.pcss");
    });

    it("the surface partials sit between them, each imported exactly once, and every partial is imported", () => {
        const surfaces = imports.slice(4, -1);
        expect(surfaces.length).toBeGreaterThanOrEqual(8);
        for (const name of surfaces) expect([...FOUNDATION_ORDER, "_a11y.pcss", "_clariva.pcss"]).not.toContain(name);
        expect(new Set(imports).size).toBe(imports.length);
        const files = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith(".pcss") && f !== "_clariva.pcss");
        expect([...imports].sort()).toEqual([...files].sort());
    });
});

describe("test helper sanity", () => {
    it("compositing: 50% white over black is mid grey; opaque colours are unchanged", () => {
        expect(over({ rgb: [255, 255, 255], a: 0.5 }, [0, 0, 0])).toEqual([127.5, 127.5, 127.5]);
        expect(over(opaque([10, 20, 30]), [200, 200, 200])).toEqual([10, 20, 30]);
        expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    });
});
