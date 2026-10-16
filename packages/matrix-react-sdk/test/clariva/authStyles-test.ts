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

/**
 * Guards the few stylesheet rules the Google sign-in components rely on. jsdom applies no stylesheet, so a rule that
 * is deleted or reworded would otherwise go unnoticed until somebody looked at the page. The colour pairs themselves
 * are measured in designTokens-test.ts; here we only pin WHICH tokens the Google rules use. The page is the "Clear
 * Water" glass card: --cg-text-2 for quiet text, the 2px --cg-focus ring for keyboard focus.
 */

const read = (file: string): string =>
    fs.readFileSync(path.join(__dirname, "../../res/css/clariva", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const AUTH = read("_auth.pcss");
const BRAND = read("_brand.pcss");

/** Everything between the braces that open at `openIndex` (nested blocks included). */
function blockAt(css: string, openIndex: number): string {
    let depth = 0;
    for (let i = openIndex; i < css.length; i++) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}" && --depth === 0) return css.slice(openIndex + 1, i);
    }
    throw new Error("unbalanced braces");
}

/** The body of the top-level rule `selector { ... }` (the selector starts a line). */
function rule(css: string, selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`^${escaped}\\s*\\{`, "m").exec(css);
    if (!match) throw new Error(`rule ${selector} not found`);
    return blockAt(css, match.index + match[0].length - 1);
}

/** Every nested block whose header is exactly `header` (e.g. `&:focus-visible`) inside `body`. */
function nested(body: string, header: string): string[] {
    const escaped = header.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&");
    const found: string[] = [];
    for (const match of body.matchAll(new RegExp(`^\\s*${escaped}\\s*\\{`, "gm"))) {
        found.push(blockAt(body, (match.index ?? 0) + match[0].length - 1));
    }
    return found;
}

const declaration = (body: string, property: string): string | undefined =>
    new RegExp(`(?:^|[\\s;{])${property}\\s*:\\s*([^;]+);`).exec(body)?.[1].trim();

describe("Clariva auth stylesheet: Google sign-in rules", () => {
    describe(".mx_ClarivaAuth_googleWrap", () => {
        const wrap = rule(AUTH, ".mx_ClarivaAuth_googleWrap");

        it("is the positioned, 44px-high slot the loading text and the shield are laid over", () => {
            expect(declaration(wrap, "position")).toBe("relative");
            expect(declaration(wrap, "min-height")).toBe("var(--clariva-tap)");
            expect(declaration(BRAND, "--clariva-tap")).toBe("44px");
        });

        it("its programmatic focus ring is the 2px --cg-focus ring (measured on the glass card)", () => {
            const rings = nested(wrap, "&:focus-visible");
            expect(rings).toHaveLength(1);
            expect(declaration(rings[0], "outline")).toBe("2px solid var(--cg-focus)");
            expect(declaration(rings[0], "outline-offset")).toBe("2px");
            expect(rings[0]).not.toContain("text-primary");
        });

        it("the button never spills out of the card: it is clipped to the column it was drawn for", () => {
            const button = rule(AUTH, ".mx_ClarivaAuth_googleButton");
            expect(declaration(button, "max-width")).toBe("100%");
            expect(declaration(button, "overflow")).toBe("hidden");
        });
    });

    describe(".mx_ClarivaAuth_googleLoading", () => {
        const loading = rule(AUTH, ".mx_ClarivaAuth_googleLoading");

        it("fills the slot without shifting the layout and never takes a click", () => {
            expect(declaration(loading, "position")).toBe("absolute");
            expect(declaration(loading, "inset")).toBe("0");
            expect(declaration(loading, "display")).toBe("flex");
            expect(declaration(loading, "align-items")).toBe("center");
            expect(declaration(loading, "justify-content")).toBe("center");
            expect(declaration(loading, "pointer-events")).toBe("none");
            expect(declaration(loading, "font")).toBe("var(--cpd-font-body-sm-regular)");
        });

        it("is quiet text on the glass card: --cg-text-2 (measured on every wallpaper point)", () => {
            expect(declaration(loading, "color")).toBe("var(--cg-text-2)");
        });
    });

    describe(".mx_ClarivaAuth_googleNotice", () => {
        it("the live-region text wrapper stacks title and body", () => {
            const text = rule(AUTH, ".mx_ClarivaAuth_googleNoticeText");
            expect(declaration(text, "display")).toBe("flex");
            expect(declaration(text, "flex-direction")).toBe("column");
            expect(declaration(text, "gap")).toBe("var(--cpd-space-2x)");
        });
    });

    describe(".mx_ClarivaAuth_googleDevHint", () => {
        const hint = rule(AUTH, ".mx_ClarivaAuth_googleDevHint");
        const summary = nested(hint, "summary")[0];

        it("the keyboard focus ring on the glass card is the 2px --cg-focus ring, not the canvas-tuned border-focused", () => {
            const rings = nested(summary, "&:focus-visible").filter((block) => block.includes("outline"));
            expect(rings).toHaveLength(1);
            expect(declaration(rings[0], "outline")).toBe("2px solid var(--cg-focus)");
            expect(rings[0]).not.toContain("border-focused");
            expect(hint).not.toContain("border-focused");
        });
    });

    describe(".mx_ClarivaDeactivate_google", () => {
        it("spaces the explanation and the button / notice / authorised line in a column", () => {
            const block = rule(AUTH, ".mx_ClarivaDeactivate_google");
            expect(declaration(block, "display")).toBe("flex");
            expect(declaration(block, "flex-direction")).toBe("column");
            expect(declaration(block, "gap")).toBe("var(--cpd-space-3x)");
        });
    });
});
