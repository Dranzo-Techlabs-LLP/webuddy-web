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
import zlib from "node:zlib";

/**
 * Test helpers for the "Clear Water" design tokens (res/css/clariva/_brand.pcss, _glass.pcss, _motion.pcss): read a
 * stylesheet as text, pull the custom properties of a theme out of it, and composite translucent colours (a glass fill
 * over the aurora) so contrast is measured on what the screen really shows, not on the flat page colour. Used by
 * designTokens-test.ts and a11yContrast-test.ts. jsdom applies no stylesheet, so the CSS is parsed here.
 *
 * The backdrop model of a glass material is what the browser paints: the content behind the element, blurred, run through
 * `saturate()` (the --cg-sat-* boost of backdrop-filter), THEN the translucent fill over it. `glassOver` is that model.
 */

export type RGB = [number, number, number];
export interface RGBA {
    rgb: RGB;
    a: number;
}
export type Theme = "light" | "dark";

export const SDK_DIR = path.join(__dirname, "../..");
export const REPO_DIR = path.join(SDK_DIR, "../..");
export const CSS_DIR = path.join(SDK_DIR, "res/css/clariva");

export const LIGHT_HEADER = ":root[data-clariva]";
export const DARK_HEADER = ':root[data-clariva] body[class*="cpd-theme-dark"]';

/** A Clariva partial with its comments removed (comments mention the very patterns the tests forbid). */
export function readCss(file: string): string {
    return fs.readFileSync(path.join(CSS_DIR, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Everything between the braces that open at `openIndex` (nested blocks included). */
export function blockAt(css: string, openIndex: number): string {
    let depth = 0;
    for (let i = openIndex; i < css.length; i++) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}" && --depth === 0) return css.slice(openIndex + 1, i);
    }
    throw new Error("unbalanced braces");
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The body of the first rule / at-rule whose header is exactly `header` (it starts a line). */
export function blockOf(css: string, header: string): string {
    const match = new RegExp(`^\\s*${escapeRegExp(header)}\\s*\\{`, "m").exec(css);
    if (!match) throw new Error(`block "${header}" not found`);
    return blockAt(css, match.index + match[0].length - 1);
}

/** The custom properties declared directly in `block` (--name: value;), values trimmed. */
export function customProps(block: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].replace(/\s+/g, " ").trim();
    return out;
}

/** Value normalised for comparison with the design doc: lower case, no spaces, ".5" for "0.5". */
export const normalise = (value: string): string =>
    value
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/(^|[^\d])0\./g, "$1.");

const brandCss = readCss("_brand.pcss");
export const LIGHT_TOKENS: Record<string, string> = customProps(blockOf(brandCss, LIGHT_HEADER));
export const DARK_TOKENS: Record<string, string> = customProps(blockOf(brandCss, DARK_HEADER));

/** `var(--name)` references (no fallback) replaced by the token's value, so `rgba(.., var(--cg-pane-wash-alpha))` parses. */
function resolveVars(tokens: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, raw] of Object.entries(tokens)) {
        let value = raw;
        for (let pass = 0; pass < 5 && value.includes("var("); pass++) {
            value = value.replace(/var\((--[\w-]+)\)/g, (whole, ref: string) => tokens[ref] ?? whole);
        }
        out[name] = value;
    }
    return out;
}

const themeCache: Partial<Record<Theme, Record<string, string>>> = {};

/**
 * The tokens a surface sees in `theme`: the light/invariant block, overridden by the dark block in the dark theme, with
 * `var()` references between tokens resolved. LIGHT_TOKENS / DARK_TOKENS stay the raw text of the stylesheet.
 */
export function themeTokens(theme: Theme): Record<string, string> {
    return (themeCache[theme] ??= resolveVars(theme === "light" ? LIGHT_TOKENS : { ...LIGHT_TOKENS, ...DARK_TOKENS }));
}

export function parseColor(value: string): RGBA {
    const text = value.trim();
    const hex = text.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
        const n = parseInt(hex[1], 16);
        return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], a: 1 };
    }
    const fn = text.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
    if (fn) return { rgb: [+fn[1], +fn[2], +fn[3]], a: fn[4] === undefined ? 1 : +fn[4] };
    throw new Error(`cannot parse colour "${value}"`);
}

/** Every #rrggbb / rgb() / rgba() colour in a value, in order (the stops of a gradient). */
export function colorsIn(value: string): RGBA[] {
    return [...value.matchAll(/#[0-9a-f]{6}\b|rgba?\([^)]*\)/gi)].map((m) => parseColor(m[0]));
}

/** `fg` (with its alpha) painted over the opaque colour `bg`. */
export function over(fg: RGBA, bg: RGB): RGB {
    return fg.rgb.map((c, i) => c * fg.a + bg[i] * (1 - fg.a)) as RGB;
}

export const opaque = (rgb: RGB): RGBA => ({ rgb, a: 1 });

export function luminance([r, g, b]: RGB): number {
    const lin = (c: number): number => {
        const x = c / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: RGB, b: RGB): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

// ── the aurora wallpaper ─────────────────────────────────────────────────────────────────────────────────────────

/** One `radial-gradient(RX% RY% at CX% CY%, colour, transparent END%)`, all lengths as fractions of the box. */
export interface AuroraLayer {
    color: RGBA;
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    end: number;
}

export function parseAurora(value: string): AuroraLayer[] {
    const layers: AuroraLayer[] = [];
    const re =
        /radial-gradient\(\s*([\d.]+)%\s+([\d.]+)%\s+at\s+([\d.]+)%\s+([\d.]+)%\s*,\s*(rgba?\([^)]*\))\s*,\s*rgba?\([^)]*\)\s+([\d.]+)%\s*\)/g;
    for (const m of value.matchAll(re)) {
        layers.push({
            rx: +m[1] / 100,
            ry: +m[2] / 100,
            cx: +m[3] / 100,
            cy: +m[4] / 100,
            color: parseColor(m[5]),
            end: +m[6] / 100,
        });
    }
    return layers;
}

/** The wallpaper colour at (u, v) in 0..1 box coordinates: the layers painted over `bg`, first layer on top. */
export function auroraAt(layers: AuroraLayer[], bg: RGB, u: number, v: number): RGB {
    let pixel = bg;
    for (let i = layers.length - 1; i >= 0; i--) {
        const l = layers[i];
        const t = Math.hypot((u - l.cx) / l.rx, (v - l.cy) / l.ry);
        const alpha = l.color.a * Math.max(0, 1 - t / l.end);
        pixel = over({ rgb: l.color.rgb, a: alpha }, pixel);
    }
    return pixel;
}

export interface Backdrop {
    name: string;
    rgb: RGB;
}

/**
 * The backdrops a material can sit on, which is what its text must survive: the flat base, every layer on its own at
 * its peak (the most saturated points), and the darkest and brightest point of the whole rasterised wallpaper (where
 * layers overlap). Percent-based radii make the picture independent of the viewport aspect ratio, so one grid is enough.
 */
export function backdrops(theme: Theme): Backdrop[] {
    const tokens = themeTokens(theme);
    // --cg-aurora is declared in BOTH blocks; the dark block's value is the one the dark theme paints
    const layers = parseAurora(tokens["--cg-aurora"]);
    const bg = parseColor(tokens["--cg-bg"]).rgb;
    const found: Backdrop[] = [{ name: "base", rgb: bg }];
    layers.forEach((l, i) => found.push({ name: `layer ${i + 1} peak`, rgb: over(l.color, bg) }));

    let darkest: Backdrop | undefined;
    let brightest: Backdrop | undefined;
    const points: [number, number][] = layers.map((l): [number, number] => [l.cx, l.cy]);
    for (let i = 0; i <= 60; i++) for (let j = 0; j <= 40; j++) points.push([i / 60, j / 40]);
    for (const [u, v] of points) {
        const rgb = auroraAt(layers, bg, u, v);
        const lum = luminance(rgb);
        if (!darkest || lum < luminance(darkest.rgb)) darkest = { name: `darkest point (${u}, ${v})`, rgb };
        if (!brightest || lum > luminance(brightest.rgb)) brightest = { name: `brightest point (${u}, ${v})`, rgb };
    }
    return [...found, darkest!, brightest!];
}

// ── backdrop-filter: saturate(), the glass model and a full wallpaper sweep ───────────────────────────────────────────

export type GlassKind = "thin" | "regular" | "thick";

const clamp255 = (x: number): number => Math.max(0, Math.min(255, x));

/** CSS `saturate(amount)` (Filter Effects 1, the sRGB matrix). Greys are unchanged; a coloured backdrop gets more chroma. */
export function saturate([r, g, b]: RGB, amount: number): RGB {
    const s = amount;
    return [
        clamp255((0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b),
        clamp255((0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b),
        clamp255((0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b),
    ];
}

/** The `--cg-sat-<kind>` boost of a material as a factor (170% -> 1.7). */
export function saturation(theme: Theme, kind: GlassKind): number {
    return parseFloat(themeTokens(theme)[`--cg-sat-${kind}`]) / 100;
}

/** The glass material `kind` as painted over `backdrop`: saturate() of the backdrop first, then the translucent fill. */
export function glassOver(theme: Theme, kind: GlassKind, backdrop: RGB): RGB {
    return over(parseColor(themeTokens(theme)[`--cg-fill-${kind}`]), saturate(backdrop, saturation(theme, kind)));
}

const sweepCache: Partial<Record<Theme, Backdrop[]>> = {};

/**
 * EVERY wallpaper point worth measuring: the flat base, each layer's peak and centre, and an 81 x 41 grid over the whole
 * box. The named points of `backdrops()` are picked by the luminance of the RAW wallpaper; once a material saturates the
 * backdrop the worst point can move, so a contrast claim is checked against all of them instead.
 */
export function wallpaperSweep(theme: Theme): Backdrop[] {
    const cached = sweepCache[theme];
    if (cached) return cached;
    const tokens = themeTokens(theme);
    const layers = parseAurora(tokens["--cg-aurora"]);
    const bg = parseColor(tokens["--cg-bg"]).rgb;
    const points: Backdrop[] = [{ name: "base", rgb: bg }];
    layers.forEach((l, i) => {
        points.push({ name: `layer ${i + 1} peak`, rgb: over(l.color, bg) });
        points.push({ name: `layer ${i + 1} centre`, rgb: auroraAt(layers, bg, l.cx, l.cy) });
    });
    for (let i = 0; i <= 80; i++) {
        for (let j = 0; j <= 40; j++) {
            points.push({ name: `(${i / 80}, ${j / 40})`, rgb: auroraAt(layers, bg, i / 80, j / 40) });
        }
    }
    return (sweepCache[theme] = points);
}

export interface Worst {
    ratio: number;
    /** the wallpaper point where it happens */
    where: string;
}

/** The lowest contrast of `fg` against `surfaceAt(wallpaper point)` over `walls`, and where it happens. */
export function worstContrast(walls: Backdrop[], fg: RGB, surfaceAt: (wall: RGB) => RGB): Worst {
    let worst: Worst = { ratio: Infinity, where: "" };
    for (const wall of walls) {
        const ratio = contrast(fg, surfaceAt(wall.rgb));
        if (ratio < worst.ratio) worst = { ratio, where: wall.name };
    }
    return worst;
}

// ── WOFF2 (the Fraunces display face) ────────────────────────────────────────────────────────────────────────────────

// prettier-ignore
const WOFF2_KNOWN_TAGS = [
    "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ",
    "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS",
    "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc",
    "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop",
    "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

export const FRAUNCES_WOFF2 = path.join(SDK_DIR, "res/fonts/clariva/Fraunces-VF-latin.woff2");

/** The decompressed tables of a WOFF2 file by tag (glyf / loca stay in their transformed form: we never read them). */
export function readWoff2(file: string): Record<string, Buffer> {
    const buf = fs.readFileSync(file);
    if (buf.subarray(0, 4).toString("latin1") !== "wOF2") throw new Error(`${file} is not a WOFF2 file`);
    const numTables = buf.readUInt16BE(12);
    const compressedSize = buf.readUInt32BE(20);
    let offset = 48;
    const base128 = (): number => {
        let value = 0;
        for (let i = 0; i < 5; i++) {
            const byte = buf[offset++];
            value = value * 128 + (byte & 0x7f);
            if (!(byte & 0x80)) return value;
        }
        throw new Error("bad UIntBase128");
    };
    const entries: { tag: string; length: number }[] = [];
    for (let i = 0; i < numTables; i++) {
        const flags = buf[offset++];
        const index = flags & 0x3f;
        let tag: string;
        if (index === 63) {
            tag = buf.toString("latin1", offset, offset + 4);
            offset += 4;
        } else {
            tag = WOFF2_KNOWN_TAGS[index];
        }
        const version = flags >> 6;
        const originalLength = base128();
        const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
        entries.push({ tag, length: transformed ? base128() : originalLength });
    }
    const data = zlib.brotliDecompressSync(buf.subarray(offset, offset + compressedSize));
    const tables: Record<string, Buffer> = {};
    let cursor = 0;
    for (const entry of entries) {
        tables[entry.tag] = data.subarray(cursor, cursor + entry.length);
        cursor += entry.length;
    }
    return tables;
}

/** The OpenType feature tags a font's GSUB and GPOS tables declare ("liga", "tnum", ...). */
export function fontFeatureTags(tables: Record<string, Buffer>): string[] {
    const tags = new Set<string>();
    for (const name of ["GSUB", "GPOS"]) {
        const table = tables[name];
        if (!table) continue;
        const featureList = table.readUInt16BE(6);
        const count = table.readUInt16BE(featureList);
        for (let i = 0; i < count; i++) {
            tags.add(table.toString("latin1", featureList + 2 + i * 6, featureList + 6 + i * 6));
        }
    }
    return [...tags].sort();
}

/** unitsPerEm (head) and the horizontal-header ascent / descent / lineGap (hhea), descent as a positive number. */
export function fontVerticalMetrics(tables: Record<string, Buffer>): {
    unitsPerEm: number;
    ascent: number;
    descent: number;
    lineGap: number;
} {
    return {
        unitsPerEm: tables["head"].readUInt16BE(18),
        ascent: tables["hhea"].readInt16BE(4),
        descent: -tables["hhea"].readInt16BE(6),
        lineGap: tables["hhea"].readInt16BE(8),
    };
}

// ── compiled CSS ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** CSS specificity (a, b, c) of ONE selector made of type, class, attribute and pseudo parts (no :is / :where / :not). */
export function specificity(selector: string): [number, number, number] {
    let rest = selector;
    let b = 0;
    let c = 0;
    rest = rest.replace(/\[[^\]]*\]/g, () => (b++, ""));
    rest = rest.replace(/::[\w-]+/g, () => (c++, ""));
    rest = rest.replace(/:[\w-]+/g, () => (b++, ""));
    rest = rest.replace(/\.[\w-]+/g, () => (b++, ""));
    rest = rest.replace(/[A-Za-z][\w-]*/g, () => (c++, ""));
    return [0, b, c];
}

/** `a` out-ranks `b` (strictly higher specificity). */
export function outranks(a: string, b: string): boolean {
    const [x, y] = [specificity(a), specificity(b)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
}

export interface CompiledRule {
    /** one selector of the rule's list, fully expanded (mixins and nesting resolved) */
    selector: string;
    /** the at-rule conditions around it, outermost first (e.g. "@media (prefers-contrast: more)") */
    conditions: string[];
    declarations: Record<string, string>;
}

/**
 * A partial compiled the way webpack does (postcss-scss parser, postcss-mixins, then postcss-nested; the other plugins of
 * the real pipeline do not change selectors), flattened into one entry per selector so a test can say "this selector
 * exists, in this media query, with this declaration" without re-implementing nesting.
 */
export async function compileRules(file: string): Promise<CompiledRule[]> {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const postcss = require("postcss");
    const mixins = require("postcss-mixins");
    const nested = require("postcss-nested");
    const scss = require("postcss-scss");
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const source = fs.readFileSync(path.join(CSS_DIR, file), "utf8");
    const result = await postcss([mixins(), nested()]).process(source, { from: undefined, parser: scss });
    const rules: CompiledRule[] = [];
    result.root.walkRules((rule: any) => {
        // keyframe steps are rules too; they are not selectors a surface can hit
        if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
        const conditions: string[] = [];
        for (let node = rule.parent; node && node.type !== "root"; node = node.parent) {
            if (node.type === "atrule") conditions.unshift(`@${node.name} ${node.params}`.trim());
        }
        const declarations: Record<string, string> = {};
        rule.each((child: any) => {
            if (child.type === "decl") declarations[child.prop] = child.value;
        });
        for (const selector of rule.selectors as string[]) {
            rules.push({ selector: selector.replace(/\s+/g, " ").trim(), conditions, declarations });
        }
    });
    return rules;
}
