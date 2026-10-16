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
    contrast,
    luminance,
    over,
    parseColor,
    readCss,
    themeTokens,
    type CompiledRule,
    type RGB,
    type Theme,
} from "./glassTokens";
import { rawGlassHits } from "./surfaceScan";

/**
 * Guards the calls stylesheet (res/css/clariva/_calls.pcss): jsdom applies no stylesheet, so a rule that is deleted,
 * reworded or moved onto the wrong element would otherwise go unnoticed until somebody looked at the screen. The partial
 * is compiled the way webpack does (postcss-mixins + postcss-nested, with the foundation mixins it uses) and the compiled
 * rules are asserted; the colour pairs are measured from the real tokens.
 */

/** The partials compiled the way webpack does (mixins, then nesting), one entry per selector of every rule. */
async function compile(files: string[]): Promise<CompiledRule[]> {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const postcss = require("postcss");
    const mixins = require("postcss-mixins");
    const nested = require("postcss-nested");
    const scss = require("postcss-scss");
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const source = files.map((file) => fs.readFileSync(path.join(CSS_DIR, file), "utf8")).join("\n");
    const result = await postcss([mixins(), nested()]).process(source, { from: undefined, parser: scss });
    const compiled: CompiledRule[] = [];
    result.root.walkRules((rule: any) => {
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
            compiled.push({ selector: selector.replace(/\s+/g, " ").trim(), conditions, declarations });
        }
    });
    return compiled;
}

const FOUNDATION = ["_glass.pcss", "_motion.pcss", "_fonts.pcss"];

const CALLS = readCss("_calls.pcss");
const ROOT = ":root[data-clariva]";

/** Foundation + calls (the calls' mixins need the foundation's), and the calls' own rules alone. */
let rules: CompiledRule[] = [];
let callsOnly: CompiledRule[] = [];
beforeAll(async () => {
    const foundation = await compile(FOUNDATION);
    rules = await compile([...FOUNDATION, "_calls.pcss"]);
    callsOnly = rules.slice(foundation.length);
});

/** Every rule for exactly this selector, outside any at-rule unless `conditions` says which. */
const find = (selector: string, conditions: string[] = []): CompiledRule[] =>
    rules.filter((r) => r.selector === selector && r.conditions.join("|") === conditions.join("|"));

/** The declarations of the rules for a selector, merged in source order (the last one wins, as in the browser). */
function styleOf(selector: string, conditions: string[] = []): Record<string, string> {
    const matching = find(selector, conditions);
    expect(matching.length).toBeGreaterThan(0);
    return Object.assign({}, ...matching.map((r) => r.declarations));
}

const SHEET = `${ROOT} .mx_ToastContainer .mx_Toast_toast.mx_ClarivaIncomingCallToast`;
const RING = `${ROOT} .mx_ClarivaIncomingCall .mx_ClarivaIncomingCall_ring`;

describe("calls stylesheet: foundation rules", () => {
    it("compiles (every mixin it uses is defined by the foundation or by the file itself)", () => {
        expect(rules.length).toBeGreaterThan(100);
    });

    it("writes no glass by hand: no backdrop-filter, blur(, --cg-fill-* or --cg-solid-* (the mixins carry the fallbacks)", () => {
        expect(rawGlassHits(CALLS)).toEqual([]);
    });

    it("has no `transition: all`, scale(0) or bare ease-in, and never animates a blur", () => {
        expect(CALLS).not.toMatch(/transition\s*:\s*all\b/);
        expect(CALLS).not.toMatch(/scale\(\s*0\s*[,)]/);
        expect(CALLS).not.toMatch(/(?<![\w-])ease-in(?![\w-])/);
        expect(CALLS).not.toMatch(/animation-fill-mode\s*:\s*(both|forwards)/);
    });

    it("every selector starts with :root[data-clariva] (so it out-ranks the stock and the older Clariva rules), bar the timeline wrapper and the room-list summary it already had", () => {
        const loose = callsOnly
            .filter((r) => !r.selector.startsWith(ROOT))
            .map((r) => r.selector)
            .filter((s) => !s.startsWith(".mx_ClarivaCallStarted_wrapper") && !s.startsWith(".mx_LiveContentSummary"));
        expect(loose).toEqual([]);
    });
});

describe("calls stylesheet: the ring toast", () => {
    it("the toast shell is ONE thick glass sheet: 22px radius, 320px at most, 16px padding, picked by what it holds", () => {
        const sheet = styleOf(SHEET);
        expect(sheet["background-color"]).toBe("var(--cg-surface-thick)");
        expect(sheet["backdrop-filter"]).toBe("var(--cg-backdrop-thick)");
        expect(sheet["box-shadow"]).toBe("var(--cg-edge), var(--cg-e3)");
        expect(sheet["border-radius"]).toBe("var(--cg-r-lg)"); // 22px
        expect(sheet["max-width"]).toBe("320px");
        expect(sheet["padding"]).toBe("var(--cpd-space-4x)");
        expect(sheet["border"]).toBe("0");
        expect(sheet["color"]).toBe("var(--cg-text)");
    });

    it("nothing INSIDE the sheet blurs again (rule 1): the body and its children have no backdrop-filter", () => {
        const inside = rules.filter((r) => r.selector.includes(".mx_ClarivaIncomingCall") && r.selector !== SHEET);
        expect(inside.length).toBeGreaterThan(10);
        for (const rule of inside) expect(Object.keys(rule.declarations)).not.toContain("backdrop-filter");
    });

    it("enters in 240ms (the medium token), ease-out, from translateY(-8px) + scale(.98); it fills backwards, never both", () => {
        const sheet = styleOf(SHEET);
        expect(sheet["animation"]).toBe("cg-enter var(--cg-dur-medium) var(--cg-ease-out) backwards");
        expect(sheet["--cg-enter-from"]).toBe("translate3d(0, -8px, 0) scale(0.98)");
        const motion = fs.readFileSync(path.join(CSS_DIR, "_motion.pcss"), "utf8");
        expect(motion).toMatch(/--cg-dur-medium: 240ms;/);
    });

    it("the ONLY text colour on the sheet is --cg-text (rule 7: a toast floats over arbitrary content)", () => {
        const onSheet = callsOnly.filter(
            (r) => r.selector.includes(".mx_ClarivaIncomingCall") && r.conditions.length === 0,
        );
        expect(onSheet.length).toBeGreaterThan(10);
        for (const rule of onSheet) {
            const { color } = rule.declarations;
            if (color !== undefined) {
                expect(["var(--cg-text)", "var(--cg-on-teal-deep)", "var(--cg-on-coral)", "inherit"]).toContain(color);
            }
            for (const value of Object.values(rule.declarations)) expect(value).not.toMatch(/--cg-text-[23]/);
        }
    });

    it("the name is the display face at 20px with an ellipsis; the label is the UI face at 13px", () => {
        const name = styleOf(`${ROOT} .mx_ClarivaIncomingCall .mx_ClarivaIncomingCall_name`);
        expect(name["font-family"]).toBe("var(--cg-font-display)"); // cg-display-sm
        expect(name["letter-spacing"]).toBe("0"); // display text under 28px is not tightened
        expect(name["font-size"]).toBe("var(--cg-fs-xl)"); // 20px
        expect(name["overflow"]).toBe("hidden");
        expect(name["text-overflow"]).toBe("ellipsis");
        expect(name["white-space"]).toBe("nowrap");
        const label = styleOf(`${ROOT} .mx_ClarivaIncomingCall .mx_ClarivaIncomingCall_label`);
        expect(label["font-family"]).toBe("var(--cg-font-ui)");
        expect(label["font-size"]).toBe("var(--cg-fs-sm)"); // 13px
    });

    it("the avatar is 56px; two rings sit behind it (the face is above them)", () => {
        const avatar = styleOf(`${ROOT} .mx_ClarivaIncomingCall .mx_ClarivaIncomingCall_avatar`);
        expect(avatar["inline-size"]).toBe("56px");
        expect(avatar["block-size"]).toBe("56px");
        expect(avatar["position"]).toBe("relative");
        const face = styleOf(`${ROOT} .mx_ClarivaIncomingCall .mx_ClarivaIncomingCall_face`);
        expect(face["position"]).toBe("relative");
        expect(face["z-index"]).toBe("1");
        const ring = styleOf(RING);
        expect(ring["position"]).toBe("absolute");
        expect(ring["pointer-events"]).toBe("none");
        expect(ring["border"]).toBe("2px solid var(--cg-teal)");
    });

    describe("the rings", () => {
        it("loop for 2s, on the compositor (transform + opacity only), the second ring 0.6s behind", () => {
            const ring = styleOf(RING);
            expect(ring["animation"]).toMatch(/mx_ClarivaRingGrow 2s var\(--cg-ease-out\) infinite backwards/);
            expect(ring["animation"]).toMatch(/mx_ClarivaRingFade 2s linear infinite backwards/);
            expect(styleOf(`${RING}_second`)["animation-delay"]).toBe("0.6s");

            // exactly two keyframes, each animating one compositor property
            const keyframes = [...CALLS.matchAll(/@keyframes\s+(mx_ClarivaRing\w+)\s*\{([\s\S]*?\n\})/g)];
            expect(keyframes.map((m) => m[1]).sort()).toEqual(["mx_ClarivaRingFade", "mx_ClarivaRingGrow"]);
            const props = (name: string): string[] => [
                ...new Set([...keyframes.find((m) => m[1] === name)![2].matchAll(/([\w-]+)\s*:/g)].map((m) => m[1])),
            ];
            expect(props("mx_ClarivaRingGrow")).toEqual(["transform"]);
            expect(props("mx_ClarivaRingFade")).toEqual(["opacity"]);
            expect(keyframes.map((m) => m[2]).join()).not.toMatch(/blur|backdrop|filter|width|height|top|left/);
        });

        it("rest as two soft halos (what reduced motion shows), so the loop's first frame is not a jump", () => {
            expect(styleOf(RING)["opacity"]).toBe("0.32");
            expect(styleOf(RING)["transform"]).toBe("scale(1.2)");
            expect(styleOf(`${RING}_second`)["opacity"]).toBe("0.16");
            expect(styleOf(`${RING}_second`)["transform"]).toBe("scale(1.4)");
        });

        it("are paused while the tab is hidden (the avatar carries cg-paused)", () => {
            const paused = styleOf(
                `${ROOT} .mx_ClarivaIncomingCall .mx_ClarivaIncomingCall_avatar.cg-paused .mx_ClarivaIncomingCall_ring`,
            );
            expect(paused["animation-play-state"]).toBe("paused");
        });

        it("stop under prefers-reduced-motion (the halos stay)", () => {
            const reduced = styleOf(RING, ["@media (prefers-reduced-motion: reduce)"]);
            expect(reduced["animation"]).toBe("none");
            expect(reduced["opacity"]).toBeUndefined(); // the resting halo is untouched
        });

        it("keep clear of the shell's clip: the rings grow 50 % of 56px = 14px past the avatar, the sheet pads 16px", () => {
            const grow = CALLS.match(/@keyframes mx_ClarivaRingGrow[\s\S]*?to\s*\{\s*transform:\s*scale\(([\d.]+)\)/);
            const scale = parseFloat(grow![1]);
            const overshoot = (56 * (scale - 1)) / 2;
            expect(overshoot).toBeLessThanOrEqual(16);
            expect(styleOf(SHEET)["padding"]).toBe("var(--cpd-space-4x)"); // 16px
        });
    });

    describe("Accept and Reject", () => {
        it("Accept is Deep Teal with white text, Reject is coral with white text", () => {
            const accept = styleOf(`${ROOT} .mx_ClarivaIncomingCall .mx_ClarivaIncomingCall_accept`);
            expect(accept["background-color"]).toBe("var(--cg-teal-deep)");
            expect(accept["color"]).toBe("var(--cg-on-teal-deep)");
            const reject = styleOf(`${ROOT} .mx_ClarivaIncomingCall .mx_ClarivaIncomingCall_reject`);
            expect(reject["background-color"]).toBe("var(--cg-coral)");
            expect(reject["color"]).toBe("var(--cg-on-coral)");
        });

        it("are 48px tall, 120px wide at least: the shared size rule comes AFTER both pill rules, which are 44px", () => {
            const base = `${ROOT} .mx_ClarivaIncomingCall .mx_ClarivaIncomingCall_`;
            const sized = styleOf(`${base}button`);
            expect(sized["min-height"]).toBe("48px");
            expect(sized["min-width"]).toBe("120px");
            expect(sized["flex"]).toBe("1 1 0");
            // equal specificity: the later rule wins, so the size rule has to be the last of the three
            const order = callsOnly.map((r) => r.selector);
            for (const kind of ["accept", "reject"]) {
                expect(styleOf(`${base}${kind}`)["min-height"]).toBe("var(--clariva-tap, 44px)");
                expect(order.lastIndexOf(`${base}button`)).toBeGreaterThan(order.lastIndexOf(`${base}${kind}`));
            }
        });

        it("are pills with press feedback and a focus ring", () => {
            for (const kind of ["accept", "reject"]) {
                const button = styleOf(`${ROOT} .mx_ClarivaIncomingCall .mx_ClarivaIncomingCall_${kind}`);
                expect(button["border-radius"]).toBe("var(--cg-r-pill)");
                const selector = `${ROOT} .mx_ClarivaIncomingCall .mx_ClarivaIncomingCall_${kind}`;
                expect(find(`${selector}:active:not(:disabled, [aria-disabled="true"])`)[0].declarations).toMatchObject(
                    {
                        transform: "scale(var(--cg-press-scale))",
                    },
                );
                expect(find(`${selector}:focus-visible`)[0].declarations).toMatchObject({
                    "outline": "2px solid var(--cg-focus)",
                    "outline-offset": "2px",
                });
                // hover is only for a real pointer
                expect(
                    find(`${selector}:hover:not([aria-disabled="true"])`, [
                        "@media (hover: hover) and (pointer: fine)",
                    ]),
                ).toHaveLength(1);
            }
        });

        it("two fit side by side down to a 256px toast (2 x 120 + the 12px gap)", () => {
            expect(2 * 120 + 12).toBeLessThanOrEqual(256);
            expect(styleOf(`${ROOT} .mx_ClarivaIncomingCall .mx_ClarivaIncomingCall_buttons`)["gap"]).toBe(
                "var(--cpd-space-3x)",
            );
        });

        it("white text on the fills passes AA in both themes, on the hover and pressed shades too", () => {
            const mix = (a: RGB, b: RGB, share: number): RGB =>
                a.map((channel, i) => Math.round(channel * share + b[i] * (1 - share))) as RGB;
            for (const theme of ["light", "dark"] as Theme[]) {
                const tokens = themeTokens(theme);
                const white = parseColor(tokens["--cg-on-teal-deep"]).rgb;
                expect(parseColor(tokens["--cg-on-coral"]).rgb).toEqual(white);
                for (const fill of ["--cg-teal-deep", "--cg-coral"]) {
                    const base = parseColor(tokens[fill]).rgb;
                    // the stylesheet darkens towards black by 14 % (hover) and 22 % (pressed): contrast only goes up
                    for (const share of [1, 0.86, 0.78]) {
                        expect(contrast(white, mix(base, [0, 0, 0], share))).toBeGreaterThanOrEqual(4.5);
                    }
                }
            }
            expect(CALLS).toMatch(/color-mix\(in srgb, var\(--cg-teal-deep\) 86%, black\)/);
            expect(CALLS).toMatch(/color-mix\(in srgb, var\(--cg-coral\) 78%, black\)/);
        });
    });

    it("the sound hint is an inset tile (no blur), 13px, the LAST child: no margin of its own", () => {
        const hint = styleOf(`${ROOT} .mx_ClarivaIncomingCall .mx_ClarivaIncomingCall_soundHint`);
        expect(hint["background-color"]).toBe("var(--cg-surface-inset)");
        expect(hint["font-size"]).toBe("var(--cg-fs-sm)");
        expect(hint["color"]).toBe("var(--cg-text)");
        expect(hint["margin"]).toBeUndefined();
        expect(hint["backdrop-filter"]).toBeUndefined();
        // the content's gap spaces it, so it comes and goes without moving the buttons
        expect(styleOf(`${ROOT} .mx_ClarivaIncomingCall .mx_ClarivaIncomingCall_content`)["gap"]).toBe(
            "var(--cpd-space-4x)",
        );
    });

    it("the body is a fixed 288px, clamped to the toast on a phone", () => {
        const body = styleOf(`${ROOT} .mx_ClarivaIncomingCall`);
        expect(body["width"]).toBe("288px");
        expect(body["max-width"]).toBe("100%");
        expect(body["pointer-events"]).toBe("initial");
    });

    it("the 'couldn't join' toast takes the same sheet and a coral-text title icon", () => {
        const failed = `${ROOT} .mx_ToastContainer .mx_Toast_toast.mx_ClarivaJoinFailedToast`;
        const sheet = styleOf(failed);
        expect(sheet["backdrop-filter"]).toBe("var(--cg-backdrop-thick)");
        expect(sheet["border-radius"]).toBe("var(--cg-r-lg)");
        expect(sheet["animation"]).toBe(styleOf(SHEET)["animation"]);
        const icon = styleOf(`${failed} .mx_Toast_title::before`);
        expect(icon["background-color"]).toBe("var(--cg-coral-text)");
        expect(icon["mask-image"]).toContain("icons/error.svg");
    });
});

describe("calls stylesheet: the 'Call started' tile", () => {
    const TILE = `${ROOT} .mx_ClarivaCallStarted`;

    it("is an inset tile (hairline, no blur) with a 16px radius; the stock border is gone", () => {
        const tile = styleOf(TILE);
        expect(tile["background-color"]).toBe("var(--cg-surface-inset)");
        expect(tile["box-shadow"]).toBe("var(--cg-edge-flat)");
        expect(tile["border-radius"]).toBe("var(--cg-r-md)");
        expect(tile["border"]).toBe("0");
        expect(tile["backdrop-filter"]).toBeUndefined();
    });

    it("text: the name is --cg-text, 'Call started' and the time are --cg-text-2", () => {
        expect(styleOf(`${TILE} .mx_ClarivaCallStarted_name`)["color"]).toBe("var(--cg-text)");
        expect(styleOf(`${TILE} .mx_ClarivaCallStarted_title`)["color"]).toBe("var(--cg-text-2)");
        expect(styleOf(`${TILE} .mx_ClarivaCallStarted_time`)["color"]).toBe("var(--cg-text-2)");
    });

    it("history is quiet; the live tile has a teal edge and a teal icon", () => {
        expect(styleOf(`${TILE}.mx_ClarivaCallStarted_history .mx_ClarivaCallStarted_name`)).toMatchObject({
            "color": "var(--cg-text-2)",
            "font-weight": "500",
        });
        const edge = styleOf(`${TILE}.mx_ClarivaCallStarted_live::before`);
        expect(edge["box-shadow"]).toContain("var(--cg-teal)");
        expect(edge["pointer-events"]).toBe("none");
        expect(styleOf(`${TILE}.mx_ClarivaCallStarted_live .mx_ClarivaCallStarted_icon`)["color"]).toBe(
            "var(--cg-teal-text)",
        );
    });

    it("Join is the Deep Teal pill (the element is in the selector: it must out-rank Compound's small + icon padding)", () => {
        const join = styleOf(`${TILE} button.mx_ClarivaCallStarted_join`);
        expect(join["background-color"]).toBe("var(--cg-teal-deep)");
        expect(join["color"]).toBe("var(--cg-on-teal-deep)");
        expect(join["border-radius"]).toBe("var(--cg-r-pill)");
        expect(join["min-height"]).toBe("var(--clariva-tap, 44px)");
    });
});

describe("calls stylesheet: the header controls", () => {
    const HEADER = `${ROOT} .mx_RoomHeader`;
    const ICON_BUTTONS = ["start", "toggle", "close"].map((kind) => `${HEADER} button.mx_ClarivaCallControl_${kind}`);

    it.each(ICON_BUTTONS)("%s: a 44px round inset tile, never a second blur inside the thick header", (selector) => {
        const button = styleOf(selector);
        expect(button["inline-size"]).toBe("var(--clariva-tap, 44px)");
        expect(button["block-size"]).toBe("var(--clariva-tap, 44px)");
        expect(button["border-radius"]).toBe("var(--cg-r-pill)");
        expect(button["background-color"]).toBe("var(--cg-surface-inset)");
        expect(button["box-shadow"]).toBe("var(--cg-edge-flat)");
        expect(button["backdrop-filter"]).toBeUndefined();
        expect(button["color"]).toBe("var(--cg-text)"); // floating chrome: --cg-text only
    });

    it.each(ICON_BUTTONS)("%s: lifts and presses (fine pointers only), keeps a focus ring", (selector) => {
        expect(
            find(`${selector}:hover:not(:disabled, [aria-disabled="true"])`, [
                "@media (hover: hover) and (pointer: fine)",
            ]),
        ).toHaveLength(1);
        expect(find(`${selector}:active:not(:disabled, [aria-disabled="true"])`)).toHaveLength(1);
        expect(find(`${selector}:focus-visible`)[0].declarations["outline"]).toBe("2px solid var(--cg-focus)");
    });

    it.each(ICON_BUTTONS)("%s: disabled is a bare, half-faded glyph with a not-allowed cursor", (selector) => {
        const off = styleOf(`${selector}[aria-disabled="true"]`);
        expect(off["background-color"]).toBe("transparent");
        expect(off["opacity"]).toBe("0.5");
        expect(off["cursor"]).toBe("not-allowed");
        expect(off["box-shadow"]).toBe("none");
    });

    it("Start rests with a soft teal wash over its tile (the one action of the header), deepens it on hover, has none when disabled", () => {
        const start = `${HEADER} button.mx_ClarivaCallControl_start`;
        const rest = styleOf(start);
        expect(rest["--clariva-call-rest"]).toBe("color-mix(in srgb, var(--cg-teal) 16%, transparent)");
        expect(rest["background-image"]).toBe("linear-gradient(var(--clariva-call-rest), var(--clariva-call-rest))");
        // the wash is a layer over the inset mixin's fill and edge: the opaque fallbacks still show their border
        expect(rest["background-color"]).toBe("var(--cg-surface-inset)");
        expect(rest["box-shadow"]).toBe("var(--cg-edge-flat)");
        expect(rest["color"]).toBe("var(--cg-text)");
        expect(styleOf(`${start}[aria-disabled="true"]`)["background-image"]).toBe("none");
        const hover = Object.assign(
            {},
            ...find(`${start}:hover:not([aria-disabled="true"])`, ["@media (hover: hover) and (pointer: fine)"]).map(
                (r) => r.declarations,
            ),
        );
        expect(hover["--clariva-call-wash"]).toBe("color-mix(in srgb, var(--cg-teal) 28%, transparent)");
        expect(hover["background-image"]).toBe("linear-gradient(var(--clariva-call-wash), var(--clariva-call-wash))");
        // the bare tiles beside it (maximise / close) rest without a wash
        for (const kind of ["toggle", "close"]) {
            expect(styleOf(`${HEADER} button.mx_ClarivaCallControl_${kind}`)["background-image"]).toBeUndefined();
        }
    });

    it("the connected toggle is a Deep Teal disc with a white glyph", () => {
        const live = styleOf(`${HEADER} button.mx_ClarivaCallControl_live`);
        expect(live["background-color"]).toBe("var(--cg-teal-deep)");
        expect(live["color"]).toBe("var(--cg-on-teal-deep)");
    });

    it("Join is the Deep Teal pill; disabled it falls back to an inset tile with --cg-text (Compound's !important is out-ranked)", () => {
        const join = styleOf(`${HEADER} button.mx_ClarivaCallControl_join`);
        expect(join["background-color"]).toBe("var(--cg-teal-deep)");
        expect(join["color"]).toBe("var(--cg-on-teal-deep)");
        expect(join["border-radius"]).toBe("var(--cg-r-pill)");
        const off = styleOf(`${HEADER} button.mx_ClarivaCallControl_join[aria-disabled="true"]`);
        expect(off["background-color"]).toBe("var(--cg-surface-inset)");
        expect(off["color"]).toBe("var(--cg-text)");
        expect(off["opacity"]).toBe("0.55");
        // Compound forces its disabled colours with !important: so does this
        expect(CALLS).toMatch(/background-color: var\(--cg-surface-inset\) !important;/);
        expect(CALLS).toMatch(/color: var\(--cg-text\) !important;/);
    });

    it("uses no glass-thin / glass-regular anywhere in a selector that names the room header (rule 7 and rule 1)", () => {
        for (const rule of rules.filter(
            (r) => r.selector.includes("RoomHeader") || r.selector.includes("mx_RoomHeader"),
        )) {
            expect(Object.keys(rule.declarations)).not.toContain("backdrop-filter");
        }
    });
});

describe("calls stylesheet: the chooser", () => {
    const CHOOSER = `${ROOT} .mx_ClarivaCallChooser`;

    it("the options are 64px inset tiles with a 16px radius, hover / keyboard focus lift them with a teal edge", () => {
        const option = styleOf(`${CHOOSER} .mx_ClarivaCallChooser_option`);
        expect(option["min-height"]).toBe("64px");
        expect(option["border-radius"]).toBe("var(--cg-r-md)");
        expect(option["background-color"]).toBe("var(--cg-surface-inset)");
        expect(option["backdrop-filter"]).toBeUndefined();
        const focus = find(`${CHOOSER} .mx_ClarivaCallChooser_option:focus-visible`);
        const outline = Object.assign({}, ...focus.map((r) => r.declarations));
        expect(outline["outline"]).toBe("2px solid var(--cg-focus)");
        expect(outline["box-shadow"]).toContain("var(--cg-teal)");
        const hover = find(`${CHOOSER} .mx_ClarivaCallChooser_option:hover`, [
            "@media (hover: hover) and (pointer: fine)",
        ]);
        expect(hover).toHaveLength(1);
        expect(hover[0].declarations["box-shadow"]).toContain("var(--cg-teal)");
    });

    it("the icon is a 40px teal-tinted disc with a teal-text glyph; Cancel is the quiet 44px pill", () => {
        const icon = styleOf(`${CHOOSER} .mx_ClarivaCallChooser_icon`);
        expect(icon["inline-size"]).toBe("40px");
        expect(icon["border-radius"]).toBe("50%");
        expect(icon["color"]).toBe("var(--cg-teal-text)");
        const cancel = styleOf(`${CHOOSER} .mx_ClarivaCallChooser_cancel`);
        expect(cancel["min-height"]).toBe("var(--clariva-tap, 44px)");
        expect(cancel["background-color"]).toBe("transparent");
        expect(cancel["border-radius"]).toBe("var(--cg-r-pill)");
    });

    it("the body text is --cg-text-2 (a dialog sits on a scrim, not on arbitrary content)", () => {
        expect(styleOf(`${CHOOSER} .mx_ClarivaCallChooser_body`)["color"]).toBe("var(--cg-text-2)");
    });
});

describe("calls stylesheet: the call view frame and the minimised card", () => {
    it("the frame is made of the placeholder (radius + shadow), the widget body (radius) and a specular edge over it", () => {
        const placeholder = styleOf(`${ROOT} .mx_CallView .mx_AppTile`);
        expect(placeholder["border-radius"]).toBe("var(--cg-r-lg)"); // 22px
        expect(placeholder["box-shadow"]).toBe("var(--cg-e3)");
        expect(styleOf(`${ROOT} .mx_CallView`)["background-color"]).toBe("transparent");

        const body = `${ROOT} .mx_AppTileBody.mx_AppTileBody--call.mx_AppTileBody--large`;
        expect(styleOf(body)["border-radius"]).toBe("var(--cg-r-lg)");
        const edge = styleOf(`${body}::after`);
        expect(edge["box-shadow"]).toBe("var(--cg-edge)"); // 1px hairline + the specular top edge, fallbacks included
        expect(edge["pointer-events"]).toBe("none"); // the iframe stays clickable
        expect(edge["border-radius"]).toBe("inherit");
    });

    it("the call view hangs under the header: a gap above the strip, and the in-flow header of a call is inset like the floating one", () => {
        const view = styleOf(`${ROOT} .mx_CallView`);
        expect(view["padding"].startsWith("var(--cpd-space-2x) var(--cpd-space-2x) calc(")).toBe(true);
        const desktop = styleOf(`${ROOT} .mx_CallView`, ["@media (min-width: 769px)"]);
        expect(desktop["padding"]).toBe("var(--cpd-space-3x) var(--cpd-space-4x) var(--cpd-space-4x)");
        const header = styleOf(`${ROOT} .mx_RoomView_body.mx_MainSplit_call > .mx_RoomHeader`);
        expect(header["margin"]).toBe("var(--clariva-room-top, 0) var(--clariva-room-side, 0) 0");
    });

    it("NOTHING blurred overlaps the call video (rule 6): no backdrop-filter on the frame, the widget body or the card", () => {
        const overVideo = rules.filter((r) =>
            /mx_CallView(?!Title)|mx_AppTileBody|mx_WidgetPip|mx_AppTile\b/.test(r.selector),
        );
        expect(overVideo.length).toBeGreaterThan(10);
        for (const rule of overVideo) expect(Object.keys(rule.declarations)).not.toContain("backdrop-filter");
    });

    it("the title strip is thin glass in the flow ABOVE the widget (never positioned over it), --cg-text for the name", () => {
        const strip = styleOf(`${ROOT} .mx_ClarivaCallViewTitle`);
        expect(strip["backdrop-filter"]).toBe("var(--cg-backdrop-thin)");
        expect(strip["position"]).toBeUndefined();
        expect(strip["flex"]).toBe("0 0 auto");
        expect(strip["border-radius"]).toBe("var(--cg-r-md)");
        expect(strip["color"]).toBe("var(--cg-text)");
        const media = styleOf(`${ROOT} .mx_ClarivaCallViewTitle .mx_ClarivaCallViewTitle_media`);
        expect(media["background-color"]).toBe("var(--cg-surface-inset)"); // inside glass: inset, not a second blur
        expect(media["backdrop-filter"]).toBeUndefined();
    });

    it("the minimised card is 16px with a shadow; its controls are always visible and 44px", () => {
        expect(styleOf(`${ROOT} .mx_WidgetPip`)).toMatchObject({
            "border-radius": "var(--cg-r-md)",
            "box-shadow": "var(--cg-e3)",
        });
        expect(styleOf(`${ROOT} .mx_AppTileBody.mx_AppTileBody--call.mx_AppTileBody--mini`)["border-radius"]).toBe(
            "var(--cg-r-md)",
        );
        const overlay = `${ROOT} .mx_WidgetPip_overlay`;
        expect(styleOf(overlay)["border-radius"]).toBe("var(--cg-r-md)");
        expect(styleOf(overlay)["box-shadow"]).toBe("var(--cg-edge)");
        // stock fades both bars out unless hovered (a phone has no hover): they stay at opacity 1
        expect(styleOf(`${overlay} .mx_WidgetPip_header`)["opacity"]).toBe("1");
        expect(styleOf(`${overlay} .mx_WidgetPip_footer`)["opacity"]).toBe("1");
        // restore (the pill with the name) and close (the coral disc) are 44px
        expect(styleOf(`${overlay} .mx_WidgetPip_backButton`)["block-size"]).toBe("var(--clariva-tap, 44px)");
        const close = styleOf(`${overlay} .mx_WidgetPip_footer .mx_AccessibleButton`);
        expect(close["inline-size"]).toBe("var(--clariva-tap, 44px)");
        expect(close["block-size"]).toBe("var(--clariva-tap, 44px)");
        expect(close["background-color"]).toBe("var(--cg-coral)");
        expect(close["color"]).toBe("var(--cg-on-coral)");
    });

    it("the restore pill and the scrim keep white text readable over ANY video frame, in both themes", () => {
        const chip = CALLS.match(
            /\.mx_WidgetPip_backButton \{[\s\S]*?background-color: rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/,
        )!;
        const rgba = { rgb: [+chip[1], +chip[2], +chip[3]] as RGB, a: +chip[4] };
        for (const frame of [
            [255, 255, 255],
            [0, 0, 0],
            [255, 214, 0],
            [0, 255, 0],
        ] as RGB[]) {
            const behind = over(rgba, frame);
            expect(luminance(behind)).toBeLessThan(0.2);
            expect(contrast([255, 255, 255], behind)).toBeGreaterThanOrEqual(4.5);
        }
    });

    it("the focus ring over a video is white with a dark halo (no theme colour is guaranteed there)", () => {
        const focus = styleOf(`${ROOT} .mx_WidgetPip_overlay .mx_WidgetPip_backButton:focus-visible`);
        expect(focus["outline"]).toBe("2px solid #ffffff");
        expect(focus["box-shadow"]).toMatch(/0 0 0 5px rgba\(11, 31, 58, 0\.85\)/);
    });
});

describe("calls stylesheet: forced colours and reduced motion", () => {
    const FORCED = ["@media (forced-colors: active)"];
    const PILLS = `${ROOT}[data-clariva] :is(`;

    it("every pill gets a system-colour border in forced-colors mode (the fill is replaced), and a visible hover and focus", () => {
        const base = callsOnly.find(
            (r) => r.conditions.join() === FORCED.join() && r.selector.startsWith(PILLS) && r.selector.endsWith(")"),
        );
        expect(base).toBeDefined();
        expect(base!.declarations).toMatchObject({ border: "2px solid ButtonText", color: "ButtonText" });
        for (const target of [
            ".mx_ClarivaIncomingCall_button",
            "button.mx_ClarivaCallStarted_join",
            "button.mx_ClarivaCallControl_join",
            ".mx_WidgetPip_backButton",
            ".mx_WidgetPip_footer .mx_AccessibleButton",
        ]) {
            expect(base!.selector).toContain(target);
        }
        const focus = callsOnly.find(
            (r) =>
                r.conditions.join() === FORCED.join() &&
                r.selector.startsWith(PILLS) &&
                r.selector.endsWith(":focus-visible"),
        );
        expect(focus!.declarations["outline"]).toBe("2px solid Highlight");
        const hover = callsOnly.find(
            (r) =>
                r.conditions.join() === FORCED.join() && r.selector.startsWith(PILLS) && r.selector.endsWith(":hover"),
        );
        expect(hover!.declarations["border-color"]).toBe("Highlight");
    });

    it("reduced motion: ONE explicit stop (the ring loop); everything else is the foundation's token layer", () => {
        expect(CALLS.match(/@media \(prefers-reduced-motion: reduce\)/g)).toHaveLength(1);
        const stop = callsOnly.filter((r) => r.conditions.join() === "@media (prefers-reduced-motion: reduce)");
        expect(stop.map((r) => r.selector)).toEqual([RING]);
    });
});
