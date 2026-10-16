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

import { CSS_DIR, SDK_DIR, readCss } from "./glassTokens";
import { FLOATING_CHROME } from "./surfaceScan";

/**
 * Cross-partial guards for the "Clear Water" surfaces. The per-surface suites (chatsShell, roomStyles, callsStyles,
 * overlaySurfaces, ...) each pin one partial; the defects that survive them are the ones BETWEEN partials: two surfaces
 * painting the same selector with different materials, a blurred element declared inside another blurred element, a
 * z-index that collides with the scale, an entrance animation on a wrapper that holds a backdrop-filter. This suite compiles
 * the whole chain, in the order _clariva.pcss imports it, and asserts on the result.
 */

interface Compiled {
    selector: string;
    conditions: string[];
    declarations: Record<string, string>;
}

const IMPORTS = [
    ...fs.readFileSync(path.join(CSS_DIR, "_clariva.pcss"), "utf8").matchAll(/@import "\.\/([\w-]+\.pcss)";/g),
].map((m) => m[1]);
const PARTIALS = fs
    .readdirSync(CSS_DIR)
    .filter((f) => f.endsWith(".pcss") && f !== "_clariva.pcss")
    .sort();

const rules: Compiled[] = [];
const keyframeNames: string[] = [];
let warnings: string[] = [];

beforeAll(async () => {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const postcss = require("postcss");
    const mixins = require("postcss-mixins");
    const nested = require("postcss-nested");
    const scss = require("postcss-scss");
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const source = IMPORTS.map((file) => fs.readFileSync(path.join(CSS_DIR, file), "utf8")).join("\n");
    const result = await postcss([mixins(), nested()]).process(source, { from: undefined, parser: scss });
    warnings = result.warnings().map(String);
    result.root.walkAtRules(/keyframes$/, (atRule: any) => {
        keyframeNames.push(atRule.params);
    });
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
            rules.push({ selector: selector.replace(/\s+/g, " ").trim(), conditions, declarations });
        }
    });
});

const ROOT = ":root[data-clariva]";
const blurred = (r: Compiled): boolean =>
    r.declarations["backdrop-filter"] !== undefined && r.declarations["backdrop-filter"] !== "none";

describe("the stylesheet chain", () => {
    it("imports every partial once, the foundation first and _a11y last, and PostCSS reports nothing", () => {
        expect([...IMPORTS].sort()).toEqual(PARTIALS);
        expect(IMPORTS.slice(0, 4)).toEqual(["_brand.pcss", "_fonts.pcss", "_glass.pcss", "_motion.pcss"]);
        expect(IMPORTS[IMPORTS.length - 1]).toBe("_a11y.pcss");
        expect(warnings).toEqual([]);
        expect(rules.length).toBeGreaterThan(1500);
    });

    it("declares every @keyframes name once (a second definition would silently replace the first)", () => {
        const dupes = keyframeNames.filter((name, i) => keyframeNames.indexOf(name) !== i);
        expect(dupes).toEqual([]);
    });
});

describe("materials across partials", () => {
    it("rule 1: no blurred element is declared inside another blurred element", () => {
        const blurs = rules.filter(blurred);
        const nestedPairs: string[] = [];
        for (const outer of blurs) {
            for (const inner of blurs) {
                if (inner === outer) continue;
                const a = outer.selector;
                const b = inner.selector;
                // "<outer> <something>" or "<outer> > <something>": the inner selector can only match inside the outer
                if (b.startsWith(`${a} `) && b.length > a.length + 1) nestedPairs.push(`${a}  CONTAINS  ${b}`);
            }
        }
        expect(nestedPairs).toEqual([]);
    });

    it("one material per selector: two partials never give the same selector different backdrop filters", () => {
        const bySelector = new Map<string, Set<string>>();
        for (const r of rules.filter(blurred)) {
            const key = `${r.conditions.join(" | ")} :: ${r.selector}`;
            (bySelector.get(key) ?? bySelector.set(key, new Set()).get(key)!).add(r.declarations["backdrop-filter"]);
        }
        const conflicts = [...bySelector]
            .filter(([, values]) => values.size > 1)
            .map(([key, values]) => `${key} ${[...values]}`);
        expect(conflicts).toEqual([]);
    });

    it("the phone tab bar floats over a list pane that does not blur (the tab bar lives inside the pane)", () => {
        const phone = "@media (max-width: 768px)";
        const pane = rules.filter(
            (r) =>
                r.selector === `${ROOT} .mx_LeftPanel_wrapper .mx_LeftPanel_wrapper--user` &&
                r.conditions.join("|") === phone,
        );
        expect(pane.length).toBeGreaterThan(0);
        expect(Object.assign({}, ...pane.map((r) => r.declarations))["backdrop-filter"]).toBe("none");
        const bar = rules.filter(
            (r) => r.selector === `${ROOT} .mx_LeftPanel .mx_ClarivaTabBar` && r.conditions.join("|") === phone,
        );
        expect(Object.assign({}, ...bar.map((r) => r.declarations))["backdrop-filter"]).toBe(
            "var(--cg-backdrop-thick)",
        );
        // everywhere else the bar is not displayed at all, so the desktop pane's blur never has one inside it
        const hidden = rules.filter((r) => r.selector === `${ROOT} .mx_ClarivaTabBar` && r.conditions.length === 0);
        expect(Object.assign({}, ...hidden.map((r) => r.declarations))["display"]).toBe("none");
    });

    it("the refund banner and the chat-local toasts are painted once, by the room partial", () => {
        const owners = (needle: string): number =>
            rules.filter((r) => r.selector.endsWith(needle) && blurred(r)).length;
        expect(owners(".mx_ClarivaRefundBanner")).toBe(1);
        expect(owners(".mx_ClarivaRefundToasts .mx_ClarivaRefundToast")).toBe(1);
        const chat = readCss("_chat.pcss");
        expect(chat).toMatch(/\.mx_ClarivaRefundBanner\s*\{\s*@mixin cg-glass-regular;/);
        expect(chat).toMatch(/\.mx_ClarivaRefundToast\s*\{\s*@mixin cg-glass-thick;/);
        expect(readCss("_dialogs.pcss")).not.toMatch(/\.mx_ClarivaRefund(Banner|Toast)\s*\{/);
    });
});

describe("z-order (the --cg-z scale)", () => {
    const brand = fs.readFileSync(path.join(CSS_DIR, "_brand.pcss"), "utf8");
    const token = (name: string): number => {
        const m = new RegExp(`${name}:\\s*(\\d+)`).exec(brand);
        if (!m) throw new Error(`token ${name} not found`);
        return Number(m[1]);
    };
    const z = (selector: string, conditions: string[] = []): string | undefined =>
        Object.assign(
            {},
            ...rules
                .filter((r) => r.selector === selector && r.conditions.join("|") === conditions.join("|"))
                .map((r) => r.declarations),
        )["z-index"];

    it("the header, the composer, the tab bar and the start-chat button share the floating-bar level", () => {
        const expected = "var(--cg-z-float)";
        expect(z(`${ROOT} .mx_RoomView_body.mx_MainSplit_timeline > .mx_RoomHeader`)).toBe(expected);
        expect(z(`${ROOT} .mx_RoomView_body > .mx_MessageComposer`)).toBe(expected);
        expect(z(`${ROOT} .mx_LeftPanel .mx_ClarivaChatsFab`)).toBe(expected);
        expect(z(`${ROOT} .mx_LeftPanel .mx_ClarivaTabBar`, ["@media (max-width: 768px)"])).toBe(expected);
        expect(token("--cg-z-float")).toBe(20);
    });

    it("scroll pill < sticky date chip < the floating bars, and the status area is lowest", () => {
        const pill = z(`${ROOT} .mx_RoomView_timeline .mx_JumpToBottomButton`);
        expect(pill).toBe("var(--clariva-z-float, 10)");
        const chip = Number(
            z(`${ROOT} .mx_RoomView_body.mx_MainSplit_timeline .mx_RoomView_MessageList > li[data-clariva-date]`),
        );
        const status = Number(z(`${ROOT} .mx_RoomView_body.mx_MainSplit_timeline .mx_RoomView_statusArea`));
        expect(status).toBeLessThan(token("--clariva-z-float"));
        expect(token("--clariva-z-float")).toBeLessThan(chip);
        expect(chip).toBeLessThan(token("--cg-z-float"));
    });

    it("chat-local toasts sit under the app's own toast container (101) and the phone right-panel sheet is a bar level", () => {
        const upstream = fs.readFileSync(path.join(SDK_DIR, "res/css/structures/_ToastContainer.pcss"), "utf8");
        const container = Number(/z-index:\s*(\d+)/.exec(upstream)?.[1]);
        expect(container).toBe(101);
        expect(token("--clariva-z-local-toast")).toBeLessThan(container);
        expect(token("--clariva-z-sheet")).toBe(token("--cg-z-float"));
    });
});

describe("motion across partials", () => {
    it("the Home entrance plays on the elements that paint, never on a wrapper around a backdrop-filter", () => {
        const entering = rules.filter(
            (r) => /cg-enter/.test(r.declarations["animation"] ?? "") && /mx_ClarivaHome_enter/.test(r.selector),
        );
        expect(entering.length).toBeGreaterThanOrEqual(4);
        // a selector that ENDS on the wrapper class would fade the wrapper (an opacity below 1 on an ancestor switches the frost off)
        expect(entering.filter((r) => /mx_ClarivaHome_enter$/.test(r.selector)).map((r) => r.selector)).toEqual([]);
        const targets = entering.map((r) => r.selector).join("\n");
        expect(targets).toContain(".mx_ClarivaWalletCard");
        expect(targets).toContain(".mx_ClarivaQuick_tile");
    });
});

describe("rule 7 across partials: text on floating chrome is --cg-text", () => {
    // colours a glyph or label may take on floating glass: the one text token, or a fill-relative pair (white on Deep Teal /
    // coral is a fixed-fill pair that does not depend on the content behind), or an inherited value
    const ALLOWED =
        /^(var\(--cg-text\)|inherit|currentcolor|var\(--cg-on-teal-deep\)|var\(--cg-on-coral\)|var\(--cg-on-tint\)|color-mix\(in srgb, var\(--cg-text\) \d+%, transparent\)|#ffffff)( !important)?$/i;

    it("no rule for the room header, composer, tab bar or scroll pills sets another text colour", () => {
        const offenders = rules
            .filter((r) => FLOATING_CHROME.test(r.selector) && !r.selector.includes(".mx_Autocomplete"))
            .filter((r) => r.declarations["color"] !== undefined)
            .filter((r) => !ALLOWED.test(r.declarations["color"].trim()))
            .map((r) => `${r.selector} { color: ${r.declarations["color"]} }`);
        expect(offenders).toEqual([]);
    });
});
