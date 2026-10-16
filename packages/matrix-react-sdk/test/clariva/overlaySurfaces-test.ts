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

import { CSS_DIR, readCss } from "./glassTokens";

/**
 * Guards the "Clear Water" overlay surfaces (res/css/clariva/_dialogs.pcss, _auth.pcss, _wallet.pcss, _qr.pcss): the
 * invariants of docs/clariva/DESIGN-SYSTEM.md that a stylesheet can lose silently (jsdom applies no CSS). The partials are
 * compiled the way webpack does (postcss-mixins, then postcss-nested) together with the foundation they use, so the
 * assertions are about the declarations the browser would see: "this selector is thick glass", "that hover is gated", "the
 * logo tile has no blur". The contrast numbers themselves are guarded in designTokens-test.ts; here we pin WHICH material
 * and WHICH token a surface uses.
 */

const MINE = ["_dialogs.pcss", "_auth.pcss", "_wallet.pcss", "_qr.pcss"] as const;
const FOUNDATION = ["_glass.pcss", "_motion.pcss", "_fonts.pcss"] as const;

interface Rule {
    /** one selector of the rule's list, fully expanded */
    selector: string;
    /** the at-rule conditions around it, outermost first ("@media (hover: hover) and (pointer: fine)", "@starting-style") */
    conditions: string[];
    declarations: Record<string, string>;
    /** the partial the rule was written in (a mixin's rules belong to the file that defines the mixin) */
    file: string;
}

async function compile(): Promise<Rule[]> {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const postcss = require("postcss");
    const mixins = require("postcss-mixins");
    const nested = require("postcss-nested");
    const scss = require("postcss-scss");
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const files = [...FOUNDATION, ...MINE];
    // A marker at-rule in front of each partial says which file the rules after it belong to. postcss-mixins gives the
    // rules a mixin call expands into the source position of the MIXIN (a foundation mixin called from a dialog rule
    // would count as the foundation's) or none at all, so line numbers cannot attribute them; the document order can: a
    // rule, and every fragment its mixin calls produce, sits after the marker of the file that wrote it.
    const chunks = files.map((name) => `@clariva-file ${name};\n${fs.readFileSync(path.join(CSS_DIR, name), "utf8")}`);
    const result = await postcss([mixins(), nested()]).process(chunks.join("\n"), { from: undefined, parser: scss });
    const rules: Rule[] = [];
    let file = "?";
    result.root.walk((visited: any) => {
        if (visited.type === "atrule" && visited.name === "clariva-file") file = visited.params;
        if (visited.type !== "rule") return;
        const rule = visited;
        if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
        const conditions: string[] = [];
        for (let node = rule.parent; node && node.type !== "root"; node = node.parent) {
            if (node.type === "atrule") conditions.unshift(`@${node.name} ${node.params}`.trim());
        }
        const declarations: Record<string, string> = {};
        rule.each((child: any) => {
            // postcss keeps `!important` out of the value: put it back, the stylesheet's weight is part of what is asserted
            if (child.type === "decl") declarations[child.prop] = child.value + (child.important ? " !important" : "");
        });
        for (const selector of rule.selectors as string[]) {
            rules.push({
                selector: selector.replace(/\s+/g, " ").trim(),
                conditions,
                declarations,
                file,
            });
        }
    });
    return rules;
}

let RULES: Rule[] = [];
beforeAll(async () => {
    RULES = await compile();
});

/** Rules whose selector contains / matches `needle` (and, optionally, sit under a condition containing `cond`). */
function find(needle: string | RegExp, cond?: string): Rule[] {
    return RULES.filter(
        (r) =>
            (typeof needle === "string" ? r.selector.includes(needle) : needle.test(r.selector)) &&
            (cond === undefined || r.conditions.some((c) => c.includes(cond))),
    );
}

/** The declarations of the (single) rule that ends with `selector` exactly, after the `:root[data-clariva] ` prefix. */
function rule(selector: string, cond?: string): Record<string, string> {
    // the base state of a selector: no @media / @starting-style around it, unless the caller names the condition it wants
    const hits = RULES.filter(
        (r) =>
            (r.selector === selector || r.selector === `:root[data-clariva] ${selector}`) &&
            (cond === undefined ? r.conditions.length === 0 : r.conditions.some((c) => c.includes(cond))),
    );
    if (hits.length === 0) throw new Error(`no rule for ${selector}`);
    // several rules may share a selector (a state split over two blocks): merge them, later wins
    return Object.assign({}, ...hits.map((h) => h.declarations));
}

const GATE = "(hover: hover) and (pointer: fine)";

describe("overlay surfaces: the rules of the design system hold in every partial", () => {
    it("compiles (every mixin they use exists)", () => {
        expect(RULES.length).toBeGreaterThan(300);
        for (const file of MINE) expect(RULES.some((r) => r.file === file)).toBe(true);
    });

    it("every :hover rule sits behind (hover: hover) and (pointer: fine) (no sticky hover on touch)", () => {
        const offenders = RULES.filter(
            (r) =>
                MINE.includes(r.file as (typeof MINE)[number]) &&
                /:hover/.test(r.selector) &&
                !r.conditions.some((c) => c.includes(GATE)),
        ).map((r) => `${r.file}: ${r.selector}`);
        expect(offenders).toEqual([]);
    });

    it("no partial blurs by hand, transitions `all`, scales from 0 or eases in (the foundation test scans too)", () => {
        for (const file of MINE) {
            const css = readCss(file);
            expect(css).not.toMatch(/backdrop-filter\s*:\s*(?!none)/);
            expect(css).not.toMatch(/(?<![\w-])blur\(/);
            expect(css).not.toMatch(/transition\s*:\s*all\b/);
            expect(css).not.toMatch(/scale\(\s*0\s*[,)]/);
            expect(css).not.toMatch(/(?<![\w-])ease-in(?![\w-])/);
            // a filled-forwards animation would freeze transform / opacity against press and hover
            expect(css).not.toMatch(/animation-fill-mode\s*:\s*(both|forwards)/);
        }
    });

    it("the only reduced-motion rule left in the four partials is none: the blanket in _a11y.pcss does it", () => {
        for (const file of MINE) expect(readCss(file)).not.toMatch(/prefers-reduced-motion/);
    });

    it("every interactive target the partials size is at least 44px", () => {
        const cancel = rule(
            ".mx_Dialog_wrapper:not(.mx_Dialog_lightbox):not(.mx_Dialog_spinner) .mx_Dialog .mx_Dialog_cancelButton",
        );
        expect(cancel["width"]).toBe("36px"); // the circle; its ::after hit area is 44px
        const hit = rule(
            ".mx_Dialog_wrapper:not(.mx_Dialog_lightbox):not(.mx_Dialog_spinner) .mx_Dialog .mx_Dialog_cancelButton::after",
        );
        expect(hit["inset"]).toBe("-4px");
        const input = rule(".mx_ClarivaAuth_inputRow");
        expect(input["min-height"]).toBe("52px");
        expect(rule(".mx_ClarivaAuth_linkButton")["min-height"]).toBe("44px");
        expect(rule(".mx_ClarivaAuth_toggle")["min-height"]).toBe("44px");
        expect(rule(".mx_ClarivaAuth_eye")["width"]).toBe("44px");
        expect(rule(".mx_ClarivaRechargeDialog .mx_ClarivaRecharge_chip")["min-height"]).toBe("var(--clariva-tap)");
        expect(rule(".mx_UserSettingsDialog .mx_TabbedView_tabLabel")["min-block-size"]).toBe("44px");
    });
});

describe("dialogs (_dialogs.pcss)", () => {
    const BOX = ".mx_Dialog_wrapper:not(.mx_Dialog_lightbox):not(.mx_Dialog_spinner) .mx_Dialog_border > .mx_Dialog";

    it("the dialog box is thick glass with a 28px radius and the text colour of the system", () => {
        const box = rule(BOX);
        expect(box["background-color"]).toBe("var(--cg-surface-thick)");
        expect(box["backdrop-filter"]).toBe("var(--cg-backdrop-thick)");
        expect(box["-webkit-backdrop-filter"]).toBe("var(--cg-backdrop-thick)");
        expect(box["box-shadow"]).toBe("var(--cg-edge), var(--cg-e3)");
        expect(box["border-radius"]).toBe("var(--cg-r-xl)");
        expect(box["color"]).toBe("var(--cg-text)");
        // Compound's secondary text is re-pointed to the measured pair inside the dialog
        expect(box["--cpd-color-text-secondary"]).toBe("var(--cg-text-2)");
    });

    it("the scrim is the cg-scrim recipe (token alpha + the 6px blur): the only other blurred layer", () => {
        const scrim = rule(
            ".mx_Dialog_wrapper:not(.mx_Dialog_lightbox):not(.mx_Dialog_spinner) > .mx_Dialog_background",
        );
        expect(scrim["background-color"]).toBe("var(--cg-scrim)");
        expect(scrim["backdrop-filter"]).toBe("var(--cg-backdrop-scrim)");
    });

    it("enters in 220 ms from scale(.96) + opacity 0 as a transition (an @starting-style), not a keyframe", () => {
        const box = rule(BOX);
        expect(box["transition"]).toContain("opacity 220ms var(--cg-ease-out)");
        expect(box["transition"]).toContain("transform 220ms var(--cg-ease-out)");
        expect(box["animation"]).toBeUndefined();
        const start = find(".mx_Dialog_border > .mx_Dialog", "@starting-style").filter(
            (r) => "opacity" in r.declarations,
        );
        expect(start.length).toBeGreaterThan(0);
        expect(start[0].declarations["opacity"]).toBe("0");
        expect(start[0].declarations["transform"]).toBe("scale(0.96)");
    });

    it("the opacity animates on the glass element itself (an ancestor with opacity < 1 would be a backdrop root)", () => {
        const border = rule(".mx_Dialog_wrapper:not(.mx_Dialog_lightbox):not(.mx_Dialog_spinner) .mx_Dialog_border");
        expect(border["opacity"]).toBeUndefined();
        expect(border["animation"]).toBeUndefined();
        expect(border["transition"]).toBeUndefined();
        expect(border["backdrop-filter"]).toBeUndefined();
    });

    it("a phone gets a bottom sheet: bottom-aligned, 28px top corners, safe-area padding and a drag handle that only draws", () => {
        const sheet =
            ".mx_Dialog_wrapper:not(.mx_Dialog_lightbox):not(.mx_Dialog_spinner):not(.mx_SpotlightDialog_wrapper)";
        const wrapper = rule(sheet, "(max-width: 600px)");
        expect(wrapper["align-items"]).toBe("flex-end");
        const box = rule(`${sheet} .mx_Dialog_border > .mx_Dialog`, "(max-width: 600px)");
        expect(box["border-radius"]).toBe("var(--cg-r-xl) var(--cg-r-xl) 0 0");
        expect(box["padding-block-end"]).toContain("env(safe-area-inset-bottom)");
        const handle = rule(`${sheet} .mx_Dialog_border::before`, "(max-width: 600px)");
        expect(handle["pointer-events"]).toBe("none");
        expect(handle["width"]).toBe("36px");
        expect(handle["height"]).toBe("4px");
    });

    it("the title is Inter 20/600, never the display face", () => {
        const title = rule(
            ".mx_Dialog_wrapper:not(.mx_Dialog_lightbox):not(.mx_Dialog_spinner) .mx_Dialog .mx_Dialog_title",
        );
        expect(title["font-family"]).toBe("var(--cg-font-ui)");
        expect(title["font-size"]).toBe("var(--cg-fs-xl)");
        expect(title["font-weight"]).toBe("600");
    });

    it("the close button is an inset circle, not a nested blur", () => {
        const close = rule(
            ".mx_Dialog_wrapper:not(.mx_Dialog_lightbox):not(.mx_Dialog_spinner) .mx_Dialog .mx_Dialog_cancelButton",
        );
        expect(close["background-color"]).toBe("var(--cg-surface-inset)");
        expect(close["backdrop-filter"]).toBeUndefined();
        expect(close["border-radius"]).toBe("50%");
    });

    describe("buttons", () => {
        const legacy = (suffix: string): Rule[] =>
            RULES.filter(
                (r) =>
                    r.file === "_dialogs.pcss" &&
                    r.selector.startsWith(':root[data-clariva] .mx_Dialog :is(button, input[type="submit"])') &&
                    r.selector.endsWith(suffix),
            );

        it("the legacy dialog button chain is repeated behind the root marker (it out-ranks upstream without !important)", () => {
            const primary = legacy(".mx_Dialog_primary");
            expect(primary.length).toBeGreaterThan(0);
            for (const r of primary) {
                expect(r.selector).toContain(":not(.mx_Dialog_nonDialogButton)");
                expect(r.selector).toContain(":not(.mx_UnpinAllDialog button)");
            }
        });

        it("primary is an Ink Navy pill (mist with navy text in the dark theme) with the teal specular rim", () => {
            const primary = Object.assign({}, ...legacy(".mx_Dialog_primary").map((r) => r.declarations));
            expect(primary["background"]).toBe("var(--cg-text)");
            expect(primary["color"]).toBe("var(--cg-bg)");
            expect(primary["border-radius"]).toBe("var(--cg-r-pill)");
            expect(primary["min-height"]).toBe("44px");
            expect(primary["box-shadow"]).toContain("var(--cg-btn-edge)");
            expect(primary["touch-action"]).toBe("manipulation");
        });

        it("press scales the pill (cg-press), hover brightens it only where hover is real", () => {
            const pressed = RULES.filter(
                (r) => r.selector.includes(".mx_Dialog_primary:active") && "transform" in r.declarations,
            );
            expect(pressed.length).toBeGreaterThan(0);
            expect(pressed[0].declarations["transform"]).toBe("scale(var(--cg-press-scale))");
            const hovered = RULES.filter(
                (r) => r.file === "_dialogs.pcss" && r.selector.includes(".mx_Dialog_primary:hover"),
            );
            expect(hovered.length).toBeGreaterThan(0);
            for (const h of hovered) expect(h.conditions.join(" ")).toContain(GATE);
        });

        it("danger is a coral fill with white text; disabled is a quiet flat pill that answers Compound's !important", () => {
            const danger = Object.assign({}, ...legacy(".danger").map((r) => r.declarations));
            expect(danger["background"]).toBe("var(--cg-coral)");
            expect(danger["color"]).toBe("var(--cg-on-coral)");
            const disabled = Object.assign({}, ...legacy(":disabled").map((r) => r.declarations));
            expect(disabled["background"]).toBe("var(--cg-line) !important");
            expect(disabled["color"]).toBe("var(--cg-text-3) !important");
            expect(disabled["cursor"]).toBe("not-allowed");
        });

        it("secondary is an inset pill (never a second blur on the glass)", () => {
            const secondary = RULES.filter(
                (r) => r.file === "_dialogs.pcss" && r.selector.includes(":not(.mx_Dialog_primary, .danger, .warning)"),
            );
            const merged = Object.assign({}, ...secondary.map((r) => r.declarations));
            expect(merged["background-color"]).toBe("var(--cg-surface-inset)");
            expect(merged["backdrop-filter"]).toBeUndefined();
            expect(merged["min-height"]).toBe("44px");
        });

        it("Compound buttons get the same three pills (primary, destructive, secondary) inside dialogs, toasts and sign-in", () => {
            // a mixin call splits its rule into fragments with the same selector: merge them
            const settled = (needle: string): { selector: string; declarations: Record<string, string> } => {
                const hits = find(needle).filter((r) => r.file === "_dialogs.pcss" && r.conditions.length === 0);
                expect(hits.length).toBeGreaterThan(0);
                const selector = hits[0].selector;
                return {
                    selector,
                    declarations: Object.assign(
                        {},
                        ...hits.filter((r) => r.selector === selector).map((r) => r.declarations),
                    ),
                };
            };
            const primary = settled('button[data-kind="primary"]:not([class*="_destructive_"])');
            expect(primary.selector).toContain(".mx_ClarivaAuth");
            expect(primary.declarations["background"]).toBe("var(--cg-text)");
            const destructive = settled('button[data-kind="primary"][class*="_destructive_"]');
            expect(destructive.declarations["background"]).toBe("var(--cg-coral)");
            const secondary = settled('button[data-kind="secondary"]');
            expect(secondary.declarations["background-color"]).toBe("var(--cg-surface-inset)");
        });
    });

    describe("menus, tooltips, toasts", () => {
        it("the context menu is thick glass that grows from its trigger with the individual `scale` property", () => {
            const menu = rule(".mx_ContextualMenu");
            expect(menu["background-color"]).toBe("var(--cg-surface-thick)");
            expect(menu["backdrop-filter"]).toBe("var(--cg-backdrop-thick)");
            expect(menu["scale"]).toBe("1");
            expect(menu["transform"]).toBeUndefined(); // ContextualMenu positions itself with transform: translate(-100%)
            expect(menu["transition"]).toContain("opacity var(--cg-dur-small)");
            expect(menu["transition"]).toContain("scale var(--cg-dur-small)");
            const start = find(".mx_ContextualMenu", "@starting-style")[0];
            expect(start.declarations["scale"]).toBe("0.96");
            expect(start.declarations["opacity"]).toBe("0");
        });

        it("the origin follows the alignment of the menu", () => {
            expect(rule(".mx_ContextualMenu")["transform-origin"]).toBe("top left");
            expect(rule(".mx_ContextualMenu.mx_ContextualMenu_rightAligned")["transform-origin"]).toBe("top right");
            expect(rule(".mx_ContextualMenu.mx_ContextualMenu_bottomAligned")["transform-origin"]).toBe("bottom left");
            expect(
                rule(".mx_ContextualMenu.mx_ContextualMenu_rightAligned.mx_ContextualMenu_bottomAligned")[
                    "transform-origin"
                ],
            ).toBe("bottom right");
        });

        it("menu items are 44px with an inset hover, dividers are the hairline token", () => {
            const item = rule(
                ".mx_IconizedContextMenu .mx_IconizedContextMenu_optionList .mx_IconizedContextMenu_item.mx_IconizedContextMenu_item",
            );
            expect(item["min-block-size"]).toBe("44px");
            expect(item["color"]).toBe("var(--cg-text)");
            const hover = find(".mx_IconizedContextMenu_item.mx_IconizedContextMenu_item:hover", GATE);
            expect(hover[0].declarations["background-color"]).toBe("var(--cg-hover-tint)");
            const divider = find(".mx_IconizedContextMenu_optionList:nth-child(n + 2)")[0];
            expect(divider.declarations["border-top"]).toBe("1px solid var(--cg-line)");
        });

        it("a floating menu / tooltip / toast carries --cg-text only (rule 7), never text-2 or text-3", () => {
            for (const sel of [".mx_ContextualMenu", '[role="tooltip"]', ".mx_ToastContainer .mx_Toast_toast"]) {
                const decls = rule(sel);
                expect(decls["color"]).toBe("var(--cg-text)");
            }
            const desc = rule(".mx_ToastContainer .mx_Toast_toast .mx_Toast_description");
            expect(desc["color"]).toBe("var(--cg-text)");
        });

        it("a tooltip is a small thick-glass lens without an arrow", () => {
            const tip = rule('[role="tooltip"]');
            expect(tip["background-color"]).toBe("var(--cg-surface-thick)");
            expect(tip["backdrop-filter"]).toBe("var(--cg-backdrop-thick)");
            expect(rule('[role="tooltip"] > svg[aria-hidden="true"]')["display"]).toBe("none");
        });

        it("a tooltip fades and grows in 160 ms from an @starting-style, with a card's shadow rather than a sheet's", () => {
            const tip = rule('[role="tooltip"]');
            expect(tip["transition"]).toContain("opacity var(--cg-dur-hover)");
            expect(tip["transition"]).toContain("scale var(--cg-dur-hover)");
            expect(tip["box-shadow"]).toBe("var(--cg-edge), var(--cg-e2)");
            const start = find('[role="tooltip"]', "@starting-style")[0];
            expect(start.declarations["opacity"]).toBe("0");
            expect(start.declarations["scale"]).toBe("0.96");
        });

        it("a copyable value in a dialog is an inset tile with a 44px copy button and no opaque patch", () => {
            const box = rule(".mx_Dialog .mx_CopyableText.mx_CopyableText_border");
            expect(box["background-color"]).toBe("var(--cg-surface-inset)");
            expect(box["backdrop-filter"]).toBeUndefined();
            expect(box["border-radius"]).toBe("var(--cg-r-md)");
            expect(box["box-shadow"]).toBe("inset 0 0 0 1px var(--cg-field-edge)");
            const copy = rule(".mx_Dialog .mx_CopyableText.mx_CopyableText_border .mx_CopyableText_copyButton");
            expect([copy["width"], copy["height"]]).toEqual(["44px", "44px"]);
            expect(copy["background-color"]).toBe("transparent");
        });

        it("a toast and the stacked pseudo-card behind it are the same thick glass", () => {
            const toast = rule(".mx_ToastContainer .mx_Toast_toast");
            expect(toast["background-color"]).toBe("var(--cg-surface-thick)");
            expect(toast["backdrop-filter"]).toBe("var(--cg-backdrop-thick)");
            const stacked = rule(".mx_ToastContainer.mx_ToastContainer_stacked::before");
            expect(stacked["background-color"]).toBe("var(--cg-surface-thick)");
            expect(stacked["backdrop-filter"]).toBe("var(--cg-backdrop-thick)");
            const start = find(".mx_ToastContainer .mx_Toast_toast", "@starting-style")[0];
            expect(start.declarations["opacity"]).toBe("0");
        });

        it("the call ring toast is the calls surface's: nothing here names it", () => {
            expect(readCss("_dialogs.pcss")).not.toContain("mx_ClarivaIncomingCall");
        });
    });

    describe("settings dialog", () => {
        it("the selected tab is an inset tile with a teal edge and a teal-text label (and a weight change)", () => {
            const active = rule(".mx_UserSettingsDialog .mx_TabbedView_tabsOnLeft .mx_TabbedView_tabLabel_active");
            expect(active["box-shadow"]).toBe("inset 0 0 0 1.5px var(--cg-teal)");
            expect(active["color"]).toBe("var(--cg-teal-text)");
            expect(active["font"]).toBe("var(--cpd-font-body-md-semibold)");
        });

        it("a phone gets a full-screen page, not a sheet, with a scrolling tab bar of pills", () => {
            const wrapper = rule(
                ".mx_Dialog_wrapper:not(.mx_Dialog_lightbox):not(.mx_Dialog_spinner):has(.mx_UserSettingsDialog)",
                "(max-width: 768px)",
            );
            expect(wrapper["padding"]).toBe("0");
            const pill = rule(".mx_UserSettingsDialog .mx_TabbedView_tabLabel", "(max-width: 768px)");
            expect(pill["border-radius"]).toBe("var(--cg-r-pill)");
            expect(pill["white-space"]).toBe("nowrap");
        });
    });

    describe("refund UI", () => {
        it("the pill is an inset tag with a coral edge and coral-text", () => {
            const pill = rule(".mx_ClarivaRefundPill");
            expect(pill["background-color"]).toBe("var(--cg-surface-inset)");
            expect(pill["backdrop-filter"]).toBeUndefined();
            expect(pill["box-shadow"]).toBe("inset 0 0 0 1px var(--cg-coral)");
            expect(pill["color"]).toBe("var(--cg-coral-text)");
        });

        it("the approve dialog's error is coral-text with a glyph, its input an inset tile with a visible edge", () => {
            const error = rule(
                ".mx_ClarivaApproveRefundDialog .mx_ClarivaApproveRefund_support.mx_ClarivaApproveRefund_support_error",
            );
            expect(error["color"]).toBe("var(--cg-coral-text)");
            const glyph = rule(
                ".mx_ClarivaApproveRefundDialog .mx_ClarivaApproveRefund_support.mx_ClarivaApproveRefund_support_error::before",
            );
            expect(glyph["mask-image"]).toContain("error.svg");
            const input = rule(".mx_ClarivaApproveRefundDialog .mx_ClarivaApproveRefund_input");
            expect(input["background-color"]).toBe("var(--cg-surface-inset)");
            expect(input["box-shadow"]).toBe("inset 0 0 0 1px var(--cg-field-edge)");
        });

        it("the banner and the chat toasts are the room's (_chat.pcss, tested in roomStyles-test): no second material here", () => {
            // two partials used to style the same selector with different materials (thin here, regular there); the later
            // one won by accident. One owner now: this file must not paint either element.
            const own = RULES.filter(
                (r) =>
                    r.file === "_dialogs.pcss" &&
                    /mx_ClarivaRefundBanner|mx_ClarivaRefundToast/.test(r.selector) &&
                    !/:is\(/.test(r.selector),
            );
            expect(own.map((r) => r.selector)).toEqual([]);
        });
    });
});

describe("sign-in (_auth.pcss): the signature page", () => {
    it("the glass card is the ONLY material of the page (thick, 28px radius)", () => {
        const css = readCss("_auth.pcss");
        const materials = [...css.matchAll(/@mixin (cg-glass-(?:thin|regular|thick|tint))\b/g)].map((m) => m[1]);
        expect(materials).toEqual(["cg-glass-thick"]);
        const card = rule(".mx_ClarivaAuth_card");
        expect(card["background-color"]).toBe("var(--cg-surface-thick)");
        expect(card["backdrop-filter"]).toBe("var(--cg-backdrop-thick)");
        expect(card["border-radius"]).toBe("var(--cg-r-xl)");
    });

    it("nothing else blurs on the page, and the logo tile is an opaque paper tile (no backdrop-filter, no blur)", () => {
        const blurred = RULES.filter(
            (r) =>
                r.file === "_auth.pcss" &&
                ("backdrop-filter" in r.declarations || "-webkit-backdrop-filter" in r.declarations),
        ).map((r) => r.selector);
        expect(blurred).toEqual([".mx_ClarivaAuth_card"]);
        const tile = rule(".mx_ClarivaAuth_logoTile");
        expect(tile["backdrop-filter"]).toBeUndefined();
        expect(tile["background"]).toContain("linear-gradient");
    });

    it("the aurora layer fills the viewport (not the scroll height) and pauses while a dialog is open over the page", () => {
        expect(rule(".mx_ClarivaAuth > .cg-aurora")["position"]).toBe("fixed");
        const pause = RULES.find((r) =>
            r.selector.includes(":has(.mx_Dialog_wrapper) .mx_ClarivaAuth .cg-aurora--live::before"),
        );
        expect(pause?.declarations["animation-play-state"]).toBe("paused");
        expect(pause?.declarations["will-change"]).toBe("auto");
        expect(rule(".mx_ClarivaAuth")["isolation"]).toBe("isolate");
    });

    it("the logo tile surfaces once: 500 ms opacity + scale .94 -> 1 + a brightness settle, as a transition", () => {
        const tile = rule(".mx_ClarivaAuth_logoTile");
        expect(tile["transition"]).toContain("opacity 500ms var(--cg-ease-out)");
        expect(tile["transition"]).toContain("transform 500ms var(--cg-ease-out)");
        expect(tile["transition"]).toContain("filter 500ms var(--cg-ease-out)");
        const start = find(".mx_ClarivaAuth_logoTile", "@starting-style")[0];
        expect(start.declarations["opacity"]).toBe("0");
        expect(start.declarations["transform"]).toBe("scale(0.94)");
        expect(start.declarations["filter"]).toMatch(/^brightness\(1\.\d+\)$/);
    });

    it("the headline is Fraunces (cg-display at 28px and up), the tagline Inter 15 in text-2", () => {
        const title = rule(".mx_ClarivaAuth_title");
        expect(title["font-family"]).toBe("var(--cg-font-display)");
        expect(title["letter-spacing"]).toBe("var(--cg-display-tracking)");
        expect(title["font-size"]).toBe("clamp(var(--cg-fs-2xl), 7vw, 2rem)");
        const tagline = rule(".mx_ClarivaAuth_tagline");
        expect(tagline["color"]).toBe("var(--cg-text-2)");
        expect(tagline["font-size"]).toBe("var(--cg-fs-md)");
    });

    it("inputs are inset tiles 52px tall with a visible edge and the 2px focus ring; the label stays above them", () => {
        const row = rule(".mx_ClarivaAuth_inputRow");
        expect(row["background-color"]).toBe("var(--cg-surface-inset)");
        expect(row["min-height"]).toBe("52px");
        expect(row["box-shadow"]).toBe("inset 0 0 0 1px var(--cg-field-edge)");
        expect(row["border-radius"]).toBe("var(--cg-r-md)");
        const focus = rule(".mx_ClarivaAuth_inputRow:focus-within");
        expect(focus["outline"]).toBe("2px solid var(--cg-focus)");
        expect(rule(".mx_ClarivaAuth_field")["flex-direction"]).toBe("column");
        expect(rule(".mx_ClarivaAuth_label")["color"]).toBe("var(--cg-text-2)");
        const input = rule(".mx_ClarivaAuth_input");
        expect(input["font-size"]).toBe("var(--cg-fs-lg)"); // 17px: no zoom on focus on a phone
    });

    it("an error is coral-text with an icon and a coral edge; helper text is text-2", () => {
        expect(rule(".mx_ClarivaAuth_support_error")["color"]).toBe("var(--cg-coral-text)");
        expect(rule(".mx_ClarivaAuth_support")["color"]).toBe("var(--cg-text-2)");
        expect(rule(".mx_ClarivaAuth_inputRow.mx_ClarivaAuth_inputRow_error")["box-shadow"]).toBe(
            "inset 0 0 0 2px var(--cg-coral)",
        );
        expect(rule(".mx_ClarivaAuth_dialogError::before")["mask-image"]).toContain("error.svg");
    });

    it("the Google notice and the dev hint are inset tiles with a coral rail, never glass", () => {
        const notice = rule(".mx_ClarivaAuth_googleNotice");
        expect(notice["background-color"]).toBe("var(--cg-surface-inset)");
        expect(notice["box-shadow"]).toContain("inset 3px 0 0 var(--cg-coral)");
        expect(rule(".mx_ClarivaAuth_googleNoticeTitle")["color"]).toBe("var(--cg-coral-text)");
        expect(rule(".mx_ClarivaAuth_googleDevOrigin")["background-color"]).toBe("var(--cg-surface-inset)");
    });

    it("the legal links are Inter 13 in text-2 with 44px targets", () => {
        const link = rule(".mx_ClarivaAuth_legal a");
        expect(link["font-size"]).toBe("var(--cg-fs-sm)");
        expect(link["color"]).toBe("var(--cg-text-2)");
        expect(link["min-height"]).toBe("44px");
    });

    describe("fits an 800px-high window and scrolls on a shorter one", () => {
        /** One CSS length from the stylesheet as pixels: px, a Compound space step (4px grid) or a --cg-fs-* step (16px root). */
        const px = (value: string | undefined): number => {
            const v = (value ?? "").trim();
            let m = v.match(/^(-?\d+(?:\.\d+)?)px$/);
            if (m) return Number(m[1]);
            m = v.match(/^var\(--cpd-space-(\d+)(?:-(\d+))?x\)$/);
            if (m) return (Number(m[1]) + (m[2] ? Number(`0.${m[2]}`) : 0)) * 4;
            m = v.match(/^max\((var\(--cpd-space-[\d-]+x\)),/);
            if (m) return px(m[1]);
            const fs: Record<string, number> = { "xs": 12, "sm": 13, "md": 15, "lg": 17, "xl": 20, "2xl": 28 };
            m = v.match(/^var\(--cg-fs-(\w+)\)$/);
            if (m) return fs[m[1]];
            if (v === "var(--clariva-tap)") return 44;
            throw new Error(`cannot read "${v}" as a length`);
        };

        it("the page scrolls (the aurora is fixed behind it) and centres the card only while it fits", () => {
            const page = rule(".mx_ClarivaAuth");
            expect(page["overflow-y"]).toBe("auto");
            expect(page["overscroll-behavior"]).toBe("contain");
            const scroll = rule(".mx_ClarivaAuth_scroll");
            expect(scroll["min-height"]).toBe("100%");
            expect(scroll["align-items"]).toBe("center");
            // 16px of page padding above and below the card (more only for a notch / home indicator)
            expect(scroll["padding"]).toContain("max(var(--cpd-space-4x), env(safe-area-inset-top))");
            expect(scroll["padding"]).toContain("max(var(--cpd-space-4x), env(safe-area-inset-bottom))");
        });

        it("the signature page is tight: a 72px tile, a 28-32px headline, 12px between fields", () => {
            const tile = rule(".mx_ClarivaAuth_logoTile");
            expect([tile["width"], tile["height"]]).toEqual(["72px", "72px"]);
            expect(rule(".mx_ClarivaAuth_title")["font-size"]).toBe("clamp(var(--cg-fs-2xl), 7vw, 2rem)");
            expect(rule(".mx_ClarivaAuth_form")["gap"]).toBe("var(--cpd-space-3x)");
        });

        it("the sign-in card, with the Google button and the developer hint, is shorter than 800px (the budget)", () => {
            const card = rule(".mx_ClarivaAuth_card")["padding"].split(/\s+(?=var)/);
            const labelLine = px(rule(".mx_ClarivaAuth_label")["font-size"]) * 1.3;
            const field =
                labelLine +
                px(rule(".mx_ClarivaAuth_field")["gap"]) +
                px(rule(".mx_ClarivaAuth_inputRow")["min-height"]);
            const forgot = rule(".mx_ClarivaAuth_forgotRow")["margin-block"].split(/\s+(?=calc)/);
            const forgotMargins = forgot.map((c) => -px(c.replace(/^calc\(-1 \* (.*)\)$/, "$1")));
            const tagline = rule(".mx_ClarivaAuth_tagline")["margin"].split(/\s+/);
            const or = rule(".mx_ClarivaAuth_or")["margin"].split(/\s+/);
            const footer = rule(".mx_ClarivaAuth_footer");
            const heights = {
                pageTop: 16,
                cardTop: px(card[0]),
                tile:
                    px(rule(".mx_ClarivaAuth_logoTile")["height"]) +
                    px(rule(".mx_ClarivaAuth_logoTile")["margin-bottom"]),
                title: px(rule(".mx_ClarivaAuth_title")["font-size"].includes("2rem") ? "32px" : "28px") * 1.1,
                tagline: px(tagline[0]) + 2 * px(rule(".mx_ClarivaAuth_tagline")["font-size"]) * 1.5 + px(tagline[2]),
                fields: 2 * field,
                formGaps: 3 * px(rule(".mx_ClarivaAuth_form")["gap"]),
                forgot: 44 + forgotMargins[0] + forgotMargins[1],
                submit: px(
                    rule('.mx_ClarivaAuth_card .mx_ClarivaAuth_form button.mx_ClarivaAuth_submit[data-kind="primary"]')[
                        "min-height"
                    ],
                ),
                or: 2 * px(or[0]) + px(rule(".mx_ClarivaAuth_or")["font-size"]) * 1.5,
                google: px(rule(".mx_ClarivaAuth_googleWrap")["min-height"]),
                devHint: px(rule(".mx_ClarivaAuth_googleDevHint")["margin-top"]) + 12 + 20 + 12,
                toggle:
                    px(rule(".mx_ClarivaAuth_toggle")["margin-top"]) + px(rule(".mx_ClarivaAuth_toggle")["min-height"]),
                footer:
                    px(footer["margin-top"]) +
                    px(footer["padding-top"]) +
                    1 +
                    px(rule(".mx_ClarivaAuth_legal a")["min-height"]),
                cardBottom: px(card[2]),
                pageBottom: 16,
            };
            const total = Object.values(heights).reduce((a, b) => a + b, 0);
            // ~763px today; the 800px window leaves room for a signed-out notice's worth of slack only if this stays low
            expect(total).toBeLessThan(790);
        });
    });
});

describe("wallet (_wallet.pcss)", () => {
    it("credit amounts are amber-text, debit amounts are the text colour, both in the tabular UI face", () => {
        const base = rule(".mx_ClarivaTxns .mx_ClarivaTxn_amount");
        expect(base["font-family"]).toBe("var(--cg-font-ui)");
        expect(base["font-variant-numeric"]).toBe("tabular-nums lining-nums");
        expect(rule(".mx_ClarivaTxns .mx_ClarivaTxn_amount.mx_ClarivaTxn_amount_credit")["color"]).toBe(
            "var(--cg-amber-text)",
        );
        expect(rule(".mx_ClarivaTxns .mx_ClarivaTxn_amount.mx_ClarivaTxn_amount_debit")["color"]).toBe(
            "var(--cg-text)",
        );
        expect(rule(".mx_ClarivaTxns .mx_ClarivaTxn_icon.mx_ClarivaTxn_credit")["color"]).toBe("var(--cg-amber-text)");
        expect(rule(".mx_ClarivaTxns .mx_ClarivaTxn_icon.mx_ClarivaTxn_credit")["background"]).toBe(
            "var(--cg-amber-wash)",
        );
    });

    it("the display face is only on the hero balance, the empty title and the success title (never a list row)", () => {
        const displayUsers = RULES.filter(
            (r) => r.file === "_wallet.pcss" && r.declarations["font-family"] === "var(--cg-font-display)",
        ).map((r) => r.selector);
        expect(displayUsers.sort()).toEqual(
            [
                ".mx_ClarivaWallet_balance .mx_ClarivaWallet_balanceValue",
                ".mx_ClarivaTxns .mx_ClarivaTxns_emptyTitle",
                ".mx_ClarivaSuccess_title",
            ].sort(),
        );
        // 48px balance at its largest: cg-display (28px and up)
        expect(rule(".mx_ClarivaWallet_balance .mx_ClarivaWallet_balanceValue")["font-size"]).toBe(
            "clamp(2rem, 9vw, var(--cg-fs-4xl))",
        );
        expect(rule(".mx_ClarivaWallet_balance .mx_ClarivaWallet_balanceValue")["letter-spacing"]).toBe(
            "var(--cg-display-tracking)",
        );
    });

    it("the balance lens sits on the dialog's glass, so it is an inset tile (no nested blur) with the specular edge", () => {
        const lens = rule(".mx_ClarivaWallet_balance");
        expect(lens["background-color"]).toBe("var(--cg-surface-inset)");
        expect(lens["backdrop-filter"]).toBeUndefined();
        expect(lens["box-shadow"]).toBe("var(--cg-edge), var(--cg-e2)");
    });

    it("no wallet rule blurs at all (the settings and recharge dialogs are the one glass layer)", () => {
        expect(
            RULES.filter((r) => r.file === "_wallet.pcss" && "backdrop-filter" in r.declarations).map(
                (r) => r.selector,
            ),
        ).toEqual([]);
    });

    it("an amount chip is an inset tile; the selected one has a teal edge and a teal-text label", () => {
        const chip = rule(".mx_ClarivaRechargeDialog .mx_ClarivaRecharge_chip");
        expect(chip["background-color"]).toBe("var(--cg-surface-inset)");
        expect(chip["font-family"]).toBe("var(--cg-font-ui)");
        const selected = rule(".mx_ClarivaRechargeDialog .mx_ClarivaRecharge_chip.mx_ClarivaRecharge_chip_selected");
        expect(selected["box-shadow"]).toBe("inset 0 0 0 1.5px var(--cg-teal)");
        expect(selected["color"]).toBe("var(--cg-teal-text)");
    });

    it("the skeleton uses the shared pulse (and the foundation's, not a local keyframe)", () => {
        const css = readCss("_wallet.pcss");
        expect(css).not.toMatch(/@keyframes mx_ClarivaSkel/);
        expect(css).toMatch(/\.mx_ClarivaSkel\s*\{[^}]*@mixin cg-pulse;/);
    });

    it("the success check draws itself in 400 ms, once, only while the seal is allowed to animate", () => {
        const css = readCss("_wallet.pcss");
        expect(css).toMatch(/@keyframes mx_ClarivaSuccess_draw\s*\{\s*from\s*\{\s*stroke-dashoffset: 1;/);
        const tick = rule(".mx_ClarivaSuccess_seal_animate .mx_ClarivaSuccess_check .mx_ClarivaSuccess_tick");
        expect(tick["animation"]).toMatch(/^mx_ClarivaSuccess_draw 400ms var\(--cg-ease-out\) 480ms backwards$/);
        // the finished picture (no animate class) is the drawn tick
        const base = rule(".mx_ClarivaSuccess_check .mx_ClarivaSuccess_tick");
        expect(base["stroke-dashoffset"]).toBe("0");
        expect(base["animation"]).toBeUndefined();
        expect(rule(".mx_ClarivaSuccess_check")["animation"]).toBeUndefined();
    });

    it("the 'Processing recharge...' pill is the primary pill, dimmed, and takes no input", () => {
        const progress = rule(".mx_ClarivaRechargeDialog .mx_ClarivaRecharge_progress");
        expect(progress["background"]).toBe("var(--cg-text)");
        expect(progress["pointer-events"]).toBe("none");
        expect(progress["cursor"]).toBe("progress");
    });

    it("the spinner in that pill is the 24px glyph beside the words, not the stock full-width row", () => {
        const spinner = rule(".mx_ClarivaRechargeDialog .mx_ClarivaRecharge_progress .mx_Spinner");
        expect(spinner["flex"]).toBe("none");
        expect(spinner["width"]).toBe("auto");
    });
});

describe("QR (_qr.pcss)", () => {
    it("the code's paper is pure white with a 16px radius and 16px padding in BOTH themes (a QR is always dark on light)", () => {
        const frame = rule(".mx_ClarivaMyQrDialog .mx_ClarivaMyQr_codeFrame");
        expect(frame["background"]).toBe("var(--clariva-qr-paper)");
        expect(frame["border-radius"]).toBe("var(--cg-r-md)");
        expect(frame["padding"]).toBe("var(--cpd-space-4x)");
        expect(frame["backdrop-filter"]).toBeUndefined();
        const css = readCss("_qr.pcss");
        expect(css).not.toMatch(/qr-paper[^;]*(--cg-|rgba)/);
        // the one place a scanner needs light-on-dark never happens: no theme block inside the frame's rule
        expect(css).not.toMatch(/theme-dark[^{]*mx_ClarivaMyQr_codeFrame/);
    });

    it("the viewfinder is a rounded tile with teal corner brackets; its error is a coral-railed inset tile", () => {
        expect(rule(".mx_ClarivaScanQrDialog .mx_ClarivaScanQr_frame")["border-radius"]).toBe("var(--cg-r-lg)");
        expect(rule(".mx_ClarivaScanQrDialog .mx_ClarivaScanQr_corner")["border"]).toBe("4px solid var(--cg-teal)");
        const error = rule(".mx_ClarivaScanQrDialog .mx_ClarivaScanQr_error");
        expect(error["color"]).toBe("var(--cg-coral-text)");
        expect(error["background-color"]).toBe("var(--cg-surface-inset)");
    });

    it("no QR rule blurs", () => {
        expect(
            RULES.filter((r) => r.file === "_qr.pcss" && "backdrop-filter" in r.declarations).map((r) => r.selector),
        ).toEqual([]);
    });
});
