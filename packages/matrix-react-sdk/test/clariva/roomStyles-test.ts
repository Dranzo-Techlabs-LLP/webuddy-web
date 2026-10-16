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
    blockOf,
    colorsIn,
    contrast,
    customProps,
    glassOver,
    over,
    parseColor,
    readCss,
    themeTokens,
    wallpaperSweep,
    worstContrast,
    type CompiledRule,
    type RGB,
    type RGBA,
    type Theme,
} from "./glassTokens";
import { FLOATING_CHROME, floatingChromeProblems, rawGlassHits } from "./surfaceScan";
import { roomStrings } from "../../src/clariva/strings/room";

/**
 * Guards the chat room stylesheets (res/css/clariva/_chatroom.pcss, _chat.pcss): jsdom applies no stylesheet, so a rule that
 * is deleted, reworded or moved onto the wrong element would otherwise go unnoticed until somebody looked at the screen.
 * The partials are compiled the way webpack does (postcss-mixins + postcss-nested, with the foundation mixins they use) and
 * the compiled rules are asserted; every colour pair is measured from the real tokens over the whole wallpaper.
 */

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
const ROOT = ":root[data-clariva]";
const ROOM = readCss("_chatroom.pcss");
const CHAT = readCss("_chat.pcss");
const MOTION = readCss("_motion.pcss");
const THEMES: Theme[] = ["light", "dark"];

let rules: CompiledRule[] = [];
let chatRules: CompiledRule[] = [];
let roomRules: CompiledRule[] = [];
beforeAll(async () => {
    const foundation = await compile(FOUNDATION);
    const withChat = await compile([...FOUNDATION, "_chat.pcss"]);
    rules = await compile([...FOUNDATION, "_chat.pcss", "_chatroom.pcss"]);
    chatRules = withChat.slice(foundation.length);
    roomRules = rules.slice(withChat.length);
});

/** Every rule whose selector contains ALL of the given fragments (outside any at-rule unless `conditions` is given). */
const having = (fragments: string[], conditions: string[] = []): CompiledRule[] =>
    rules.filter(
        (r) => fragments.every((f) => r.selector.includes(f)) && r.conditions.join("|") === conditions.join("|"),
    );

/** The declarations of every rule with exactly this selector, merged in source order (the last one wins). */
function styleOf(selector: string, conditions: string[] = []): Record<string, string> {
    const matching = rules.filter((r) => r.selector === selector && r.conditions.join("|") === conditions.join("|"));
    expect(matching.length).toBeGreaterThan(0);
    return Object.assign({}, ...matching.map((r) => r.declarations));
}

/** The merged declarations of the rules matching all fragments. */
function styleHaving(fragments: string[], conditions: string[] = []): Record<string, string> {
    const matching = having(fragments, conditions);
    expect(matching.length).toBeGreaterThan(0);
    return Object.assign({}, ...matching.map((r) => r.declarations));
}

const BUBBLE_IN = [`[data-self="false"] .mx_EventTile_line:not(.mx_EventTile_mediaLine)`, "mx_EventTile_noBubble"];
const BUBBLE_OUT = [`[data-self="true"] .mx_EventTile_line:not(.mx_EventTile_mediaLine)`, "mx_EventTile_noBubble"];

describe("room stylesheets: foundation rules", () => {
    it("compile (every mixin they use is defined by the foundation)", () => {
        expect(roomRules.length).toBeGreaterThan(200);
        expect(chatRules.length).toBeGreaterThan(20);
    });

    it("write no glass by hand: no backdrop-filter, blur(, --cg-fill-* or --cg-solid-*", () => {
        expect(rawGlassHits(ROOM)).toEqual([]);
        expect(rawGlassHits(CHAT)).toEqual([]);
    });

    it("keep floating chrome on thick glass (rule 7)", () => {
        expect(floatingChromeProblems(ROOM)).toEqual([]);
        expect(floatingChromeProblems(CHAT)).toEqual([]);
    });

    it("never use `transition: all`, scale(0), a bare ease-in or a forwards / both fill mode", () => {
        for (const css of [ROOM, CHAT]) {
            expect(css).not.toMatch(/transition\s*:\s*all\b/);
            expect(css).not.toMatch(/scale\(\s*0\s*[,)]/);
            expect(css).not.toMatch(/(?<![\w-])ease-in(?![\w-])/);
            expect(css).not.toMatch(/animation-fill-mode\s*:\s*(both|forwards)/);
        }
    });

    it("_chatroom.pcss starts every selector with :root[data-clariva] (so it out-ranks the stock partials imported after it)", () => {
        expect(roomRules.filter((r) => !r.selector.startsWith(ROOT)).map((r) => r.selector)).toEqual([]);
    });

    it("_chat.pcss restyles the banner, toasts and the gate card with the foundation materials", () => {
        const banner = chatRules.filter((r) => r.selector === `${ROOT} .mx_ClarivaRefundBanner`);
        expect(banner[0].declarations["backdrop-filter"]).toBe("var(--cg-backdrop-regular)");
        const merged = (selector: (s: string) => boolean): Record<string, string> =>
            Object.assign(
                {},
                ...chatRules
                    .filter((r) => r.conditions.length === 0 && selector(r.selector))
                    .map((r) => r.declarations),
            );
        const toast = merged((s) => s === ".mx_ClarivaRefundToasts .mx_ClarivaRefundToast");
        expect(toast["backdrop-filter"]).toBe("var(--cg-backdrop-thick)");
        expect(toast["color"]).toBe("var(--cg-text)");
        const gate = merged((s) => s === `${ROOT} .mx_ClarivaChatRestricted`);
        expect(gate["background-color"]).toBe("var(--cg-surface-inset)");
        expect(gate["backdrop-filter"]).toBeUndefined();
        expect(gate["color"]).toBe("var(--cg-text)");
    });

    it("the gate's Recharge button is an inset pill in --cg-text, not Compound's accent-text secondary button (rule 7)", () => {
        const recharge = Object.assign(
            {},
            ...chatRules
                .filter(
                    (r) =>
                        r.conditions.length === 0 &&
                        r.selector ===
                            `${ROOT} .mx_ClarivaChatRestricted button.mx_ClarivaChatRestricted_recharge[data-size]`,
                )
                .map((r) => r.declarations),
        );
        expect(recharge["background-color"]).toBe("var(--cg-surface-inset)");
        expect(recharge["backdrop-filter"]).toBeUndefined();
        expect(recharge["color"]).toBe("var(--cg-text)");
        expect(recharge["border"]).toBe("0");
        expect(recharge["min-block-size"]).toBe("44px");
    });
});

describe("room stylesheets: what blurs (and what must not)", () => {
    const blurred = (): string[] =>
        roomRules
            .filter((r) => r.declarations["backdrop-filter"] && r.declarations["backdrop-filter"] !== "none")
            .map((r) => r.selector);

    it("the header, the composer pill, the scroll pill, the stuck date chip, the hover bar and the intro lens are thick glass", () => {
        const thick = [
            `${ROOT} .mx_RoomHeader`,
            `${ROOT} .mx_MessageComposer .mx_MessageComposer_wrapper`,
            `${ROOT} .mx_RoomView_timeline .mx_JumpToBottomButton .mx_JumpToBottomButton_scrollDown`,
            `${ROOT} .mx_RoomView_timeline .mx_TopUnreadMessagesBar .mx_TopUnreadMessagesBar_scrollUp`,
            `${ROOT} .mx_EventTile .mx_MessageActionBar`,
            `${ROOT} .mx_ClarivaDmIntro .mx_ClarivaDmIntro_card`,
        ];
        for (const selector of thick) {
            const style = styleOf(selector);
            expect(style["backdrop-filter"]).toBe("var(--cg-backdrop-thick)");
            expect(style["background-color"]).toBe("var(--cg-surface-thick)");
        }
        const chip = styleHaving(["[data-clariva-stuck]", ".mx_DateSeparator_dateContent"]);
        expect(chip["backdrop-filter"]).toBe("var(--cg-backdrop-thick)");
    });

    it("nothing inside a blurred bar blurs again (rule 1): the controls are inset tiles", () => {
        const inside = blurred().filter(
            (s) =>
                (s.includes(".mx_RoomHeader ") && s !== `${ROOT} .mx_RoomHeader`) ||
                (s.includes(".mx_MessageComposer_wrapper ") && !s.endsWith(".mx_MessageComposer_wrapper")),
        );
        expect(inside).toEqual([]);
        const iconButton = styleHaving([".mx_RoomHeader button[style*="]);
        expect(iconButton["background-color"]).toBe("var(--cg-surface-inset)");
        expect(iconButton["backdrop-filter"]).toBeUndefined();
        const send = styleOf(`${ROOT} .mx_MessageComposer_sendMessage.mx_ClarivaComposerAction`);
        expect(send["backdrop-filter"]).toBeUndefined();
        expect(send["background-color"]).toBe("var(--cg-teal-deep)");
    });

    it("bubbles, reactions, quotes, link previews, file tiles and the typing pill have NO backdrop-filter (rule 2)", () => {
        const offenders = blurred().filter((s) =>
            /mx_EventTile_line|mx_ReactionsRow|mx_ReplyChain|mx_LinkPreviewWidget|mx_MediaBody|mx_WhoIsTypingTile|mx_EventTileBubble|mx_Clariva(Ticks|RoleBadge)/.test(
                s,
            ),
        );
        expect(offenders).toEqual([]);
        expect(styleHaving(BUBBLE_IN)["background-color"]).toBe("var(--cg-surface-inset)");
        expect(styleHaving(BUBBLE_OUT)["background"]).toBe("var(--cg-surface-tint)");
    });

    it("at most eight selectors blur in the room (about six at once: header, composer, pill, chip, lens, one hover bar)", () => {
        expect(blurred().length).toBeLessThanOrEqual(8);
    });

    it("floating chrome carries --cg-text only: no text-2, text-3, coral-, teal- or amber-text on it (rule 7)", () => {
        const offenders: string[] = [];
        for (const rule of roomRules) {
            if (!FLOATING_CHROME.test(rule.selector)) continue;
            const color = rule.declarations["color"];
            if (color && /--cg-(text-2|text-3|coral-text|teal-text|amber-text)/.test(color)) {
                offenders.push(`${rule.selector}: ${color}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});

describe("room stylesheets: the floating header and composer, and the timeline under them", () => {
    it("the header leaves the flow in a timeline room and the first message pads itself clear of it", () => {
        const header = styleHaving([".mx_RoomView_body.mx_MainSplit_timeline > .mx_RoomHeader"]);
        expect(header["position"]).toBe("absolute");
        expect(header["z-index"]).toBe("var(--cg-z-float)");
        const list = styleHaving([".mx_RoomView_body.mx_MainSplit_timeline .mx_RoomView_MessageList"]);
        expect(list["padding-top"]).toBe("var(--clariva-room-head-clear)");
    });

    it("the composer shell floats over the foot of the timeline and the list pads its end by the measured height", () => {
        const shell = styleOf(`${ROOT} .mx_RoomView_body > .mx_MessageComposer`);
        expect(shell["position"]).toBe("absolute");
        expect(shell["inset-block-end"]).toBe("0");
        const list = styleHaving([".mx_RoomView_body.mx_MainSplit_timeline .mx_RoomView_MessageList"]);
        expect(list["padding-bottom"]).toContain("var(--cg-composer-h, 0px)");
        // the shell lets clicks through its gap; only the pill takes them
        expect(styleOf(`${ROOT} .mx_MessageComposer`)["pointer-events"]).toBe("none");
        expect(styleOf(`${ROOT} .mx_MessageComposer > *`)["pointer-events"]).toBe("auto");
    });

    it("the pill is 52px tall, grows to about five lines, and shows a 2px focus ring only while focus is inside", () => {
        expect(styleOf(`${ROOT} .mx_MessageComposer .mx_MessageComposer_row`)["min-height"]).toBe("52px");
        expect(styleHaving([".mx_BasicMessageComposer_input"], [])["max-height"]).toBe("140px");
        const focus = styleOf(`${ROOT} .mx_MessageComposer .mx_MessageComposer_wrapper:focus-within`);
        expect(focus["outline"]).toBe("2px solid var(--cg-focus)");
        // no permanent ring: the resting wrapper has no outline of its own
        expect(styleOf(`${ROOT} .mx_MessageComposer .mx_MessageComposer_wrapper`)["outline"]).toBeUndefined();
    });

    it("the scroll pill sits above the composer, whatever its height, and is a 44px target", () => {
        const pill = styleOf(`${ROOT} .mx_RoomView_timeline .mx_JumpToBottomButton`);
        expect(pill["bottom"]).toContain("var(--cg-composer-h, 0px)");
        expect(pill["width"]).toBe("var(--clariva-hit)");
        const token = customProps(blockOf(ROOM, `${ROOT} .mx_MatrixChat`));
        expect(token["--clariva-hit"]).toContain("44px");
    });

    it("on a phone the header is flush with the screen and the composer has no side gap", () => {
        const phone = styleOf(`${ROOT} .mx_MatrixChat`, ["@media (max-width: 768px)"]);
        expect(phone["--clariva-room-gutter"]).toBe("var(--cpd-space-2x)");
        expect(phone["--clariva-header-h"]).toBe("56px");
    });

    it("a refund banner / drawer under the header clears it, and the list below it then pads less", () => {
        expect(styleHaving(["> .mx_ClarivaRefundBanner"])["margin-top"]).toContain("var(--clariva-room-head)");
        expect(having([":has(> .mx_ClarivaRefundBanner)", ".mx_RoomView_MessageList"]).length).toBeGreaterThan(0);
    });

    it("the status area is lifted above the composer and stays under the pill", () => {
        const status = styleHaving([".mx_RoomView_body.mx_MainSplit_timeline .mx_RoomView_statusArea"]);
        expect(status["inset-block-start"]).toBe("calc(-1 * var(--cg-composer-h, 0px))");
        expect(Number(status["z-index"])).toBeLessThan(10);
    });
});

describe("room stylesheets: bubbles", () => {
    const tokens = customProps(blockOf(ROOM, `${ROOT} .mx_MatrixChat`));

    it("are 20px drops with a 6px tail, at most 78% (68ch) wide", () => {
        expect(tokens["--clariva-bubble-radius"]).toBe("20px");
        expect(tokens["--clariva-bubble-radius-tail"]).toBe("6px");
        expect(tokens["--clariva-bubble-max"]).toBe("min(78%, 68ch)");
    });

    it("keep 4px inside a group and 12px between groups", () => {
        expect(styleOf(`${ROOT} .mx_EventTile[data-layout="bubble"]`)["margin-top"]).toBe("var(--cpd-space-3x)");
        expect(styleOf(`${ROOT} .mx_EventTile[data-layout="bubble"].mx_EventTile_continuation`)["margin-top"]).toBe(
            "var(--cpd-space-1x)",
        );
    });

    it("have the tail on the sender's side, always at the bottom and at the top too inside a group", () => {
        const tail = "var(--clariva-bubble-radius-tail)";
        expect(
            styleHaving([`[data-self="false"] .mx_EventTile_line`, "mx_EventTile_noBubble"])["border-end-start-radius"],
        ).toBe(tail);
        expect(
            styleHaving([`[data-self="false"].mx_EventTile_continuation .mx_EventTile_line`, "mx_EventTile_noBubble"])[
                "border-start-start-radius"
            ],
        ).toBe(tail);
        expect(
            styleHaving([`[data-self="true"] .mx_EventTile_line`, "mx_EventTile_noBubble"])["border-end-end-radius"],
        ).toBe(tail);
        expect(
            styleHaving([`[data-self="true"].mx_EventTile_continuation .mx_EventTile_line`, "mx_EventTile_noBubble"])[
                "border-start-end-radius"
            ],
        ).toBe(tail);
    });

    it("incoming: a translucent inset drop with a specular edge and a soft shadow; outgoing: the teal tint with AA text", () => {
        const incoming = styleHaving(BUBBLE_IN);
        expect(incoming["background-image"]).toContain("var(--clariva-bubble-in-lift)");
        expect(incoming["box-shadow"]).toContain("var(--cg-edge)");
        expect(incoming["box-shadow"]).toContain("var(--cg-e1)");
        expect(incoming["color"]).toBe("var(--cg-text)");
        const outgoing = styleHaving(BUBBLE_OUT);
        expect(outgoing["background"]).toBe("var(--cg-surface-tint)");
        expect(outgoing["color"]).toBe("var(--cg-on-tint)");
        expect(outgoing["--cg-focus"]).toBe("var(--cg-focus-on-tint)");
    });

    it("a mention keeps its meaning with a 2px teal ring instead of an outline", () => {
        const incoming = styleHaving([`.mx_EventTile_highlight[data-self="false"] .mx_EventTile_line`]);
        expect(incoming["box-shadow"]).toContain("0 0 0 2px var(--clariva-ring)");
        const outgoing = styleHaving([`.mx_EventTile_highlight[data-self="true"] .mx_EventTile_line`]);
        expect(outgoing["box-shadow"]).toContain("0 0 0 2px var(--clariva-ring)");
        expect(ROOM).not.toMatch(/outline:[^;]*icon-accent-primary/);
    });

    it("sent / read ticks sit inline after the time, in the bubble's text colour, a deeper teal once read", () => {
        const ticks = styleOf(`${ROOT} .mx_EventTile[data-layout="bubble"] .mx_ClarivaTicks`);
        expect(ticks["order"]).toBe("4");
        expect(ticks["color"]).toBe("var(--cg-on-tint)");
        expect(
            styleOf(`${ROOT} .mx_EventTile[data-layout="bubble"] .mx_ClarivaTicks[data-state="read"]`)["color"],
        ).toBe("var(--clariva-tick-read)");
    });

    it("reactions are inset pills without blur; a selected one gets a teal wash and edge", () => {
        const pill = styleOf(`${ROOT} .mx_EventTile[data-layout="bubble"] .mx_ReactionsRowButton`);
        expect(pill["border-radius"]).toBe("var(--cg-r-pill)");
        expect(pill["background-color"]).toBe("var(--cg-surface-inset)");
        expect(pill["backdrop-filter"]).toBeUndefined();
        const selected = styleOf(
            `${ROOT} .mx_EventTile[data-layout="bubble"] .mx_ReactionsRowButton.mx_ReactionsRowButton_selected`,
        );
        expect(selected["box-shadow"]).toBe("var(--cg-edge-tint)");
    });

    it("a reply quote has a teal rail on an inset tile; link previews and file tiles are inset cards", () => {
        const quoteIn = rules.filter(
            (r) => r.selector.endsWith(" .mx_ReplyChain") && !r.selector.includes('[data-self="true"]'),
        );
        const quote = Object.assign({}, ...quoteIn.map((r) => r.declarations));
        expect(quote["box-shadow"]).toContain("inset 3px 0 0 var(--cg-teal)");
        expect(styleHaving(['[data-self="true"] .mx_ReplyChain'])["box-shadow"]).toContain("var(--cg-on-tint)");
        expect(quote["border-radius"]).toBe("var(--cg-r-sm)");
        expect(styleHaving([".mx_LinkPreviewWidget"])["border-radius"]).toBe("var(--cg-r-sm)");
        expect(styleHaving([`[data-self="false"] .mx_MediaBody`])["background-color"]).toBe("var(--cg-surface-inset)");
        expect(styleHaving([`[data-self="true"] .mx_MediaBody`])["background"]).toBe("var(--cg-surface-tint)");
        expect(styleHaving(['.mx_EventTile[data-layout="bubble"] .mx_MediaBody'])["border-radius"]).toBe(
            "var(--cg-r-md)",
        );
    });

    it("long words and URLs wrap inside the bubble (no horizontal scroll)", () => {
        const bubble = styleHaving(["mx_EventTile_noBubble", ".mx_EventTile_line:not(.mx_EventTile_mediaLine)"]);
        expect(bubble["overflow-wrap"]).toBe("anywhere");
    });
});

describe("room stylesheets: motion", () => {
    const dur = customProps(blockOf(MOTION, `${ROOT}`));

    it("a live message eases in over 140 ms, translateY(6px) + fade, only on the class EventTile adds", () => {
        const live = styleOf(`${ROOT} .mx_EventTile.mx_EventTile_clarivaLive[data-layout="bubble"]`);
        expect(live["animation"]).toBe("mx_ClarivaMessageIn 140ms var(--cg-ease-out) backwards");
        const frames = blockOf(ROOM, "@keyframes mx_ClarivaMessageIn");
        expect(frames).toMatch(/opacity:\s*0/);
        expect(frames).toMatch(/translate3d\(0, 6px, 0\)/);
        expect(new Set([...frames.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]))).toEqual(
            new Set(["opacity", "transform"]),
        );
    });

    it("is switched off under reduced motion, as are the pill and the typing loop", () => {
        const reduced = blockOf(ROOM, "@media (prefers-reduced-motion: reduce)");
        expect(reduced).toMatch(/mx_EventTile_clarivaLive[^{]*[\s\S]*animation: none/);
        expect(reduced).toMatch(/mx_JumpToBottomButton_scrollDown/);
        expect(reduced).toMatch(/mx_WhoIsTypingTile_dots span/);
    });

    it("the mic and send glyphs cross-fade over 160 ms, opacity only, and a keyboard send removes the fade", () => {
        expect(dur["--cg-dur-hover"]).toBe("160ms");
        const icon = styleHaving([".mx_ClarivaComposerAction .mx_ClarivaComposerAction_icon"]);
        expect(icon["transition"]).toBe("opacity var(--cg-dur-hover) var(--cg-ease-out)");
        expect(icon["opacity"]).toBe("0");
        expect(
            styleOf(
                `${ROOT} .mx_MessageComposer_sendMessage.mx_ClarivaComposerAction[data-mode="mic"] .mx_ClarivaComposerAction_mic`,
            )["opacity"],
        ).toBe("1");
        expect(
            styleOf(
                `${ROOT} .mx_MessageComposer_sendMessage.mx_ClarivaComposerAction[data-mode="send"] .mx_ClarivaComposerAction_send`,
            )["opacity"],
        ).toBe("1");
        expect(
            styleOf(
                `${ROOT} .mx_MessageComposer_sendMessage.mx_ClarivaComposerAction[data-instant] .mx_ClarivaComposerAction_icon`,
            )["transition"],
        ).toBe("none");
    });

    it("the send circle presses to .97 (the cg-press recipe) and the stock send glyph is removed", () => {
        const press = having([".mx_ClarivaComposerAction:active"]);
        expect(press.some((r) => r.declarations["transform"] === "scale(var(--cg-press-scale))")).toBe(true);
        expect(styleOf(`${ROOT} .mx_MessageComposer_sendMessage.mx_ClarivaComposerAction::before`)["content"]).toBe(
            "none",
        );
        expect(customProps(blockOf(MOTION, ROOT))["--cg-press-scale"]).toBe("0.97");
    });

    it("the scroll pill enters in 180 ms and leaves in 120 ms, on the glass element itself, opacity + 8px", () => {
        expect(dur["--cg-dur-small"]).toBe("180ms");
        expect(dur["--cg-dur-exit-small"]).toBe("120ms");
        const glass = styleOf(`${ROOT} .mx_RoomView_timeline .mx_JumpToBottomButton .mx_JumpToBottomButton_scrollDown`);
        expect(glass["animation"]).toBe("mx_ClarivaPillIn var(--cg-dur-small) var(--cg-ease-out) backwards");
        const leaving = styleHaving([".mx_JumpToBottomButton_leaving .mx_JumpToBottomButton_scrollDown"]);
        expect(leaving["animation"]).toBe("mx_ClarivaPillOut var(--cg-dur-exit-small) var(--cg-ease-out) both");
        // the wrapper (an ancestor of the backdrop-filter) is never the animated element
        expect(styleOf(`${ROOT} .mx_RoomView_timeline .mx_JumpToBottomButton`)["animation"]).toBeUndefined();
        for (const name of ["mx_ClarivaPillIn", "mx_ClarivaPillOut"]) {
            const frames = blockOf(ROOM, `@keyframes ${name}`);
            expect(frames).toMatch(/opacity/);
            expect(frames).toMatch(/translate3d\(0, 8px, 0\)/);
        }
    });

    it("the typing dots loop once a second on opacity + transform only", () => {
        const dot = styleHaving([".mx_WhoIsTypingTile_dots span"], []);
        expect(dot["animation"]).toContain("mx_ClarivaTyping 1s");
        const frames = blockOf(ROOM, "@keyframes mx_ClarivaTyping");
        const props = new Set([...frames.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]));
        expect([...props].sort()).toEqual(["opacity", "transform"]);
    });

    it("never animates a blur", () => {
        for (const m of ROOM.matchAll(/@keyframes\s+[\w-]+\s*\{/g)) {
            const open = (m.index ?? 0) + m[0].length - 1;
            let depth = 0;
            let end = open;
            for (let i = open; i < ROOM.length; i++) {
                if (ROOM[i] === "{") depth++;
                else if (ROOM[i] === "}" && --depth === 0) {
                    end = i;
                    break;
                }
            }
            expect(ROOM.slice(open, end)).not.toMatch(/backdrop-filter|blur\(/);
        }
    });
});

describe("room stylesheets: the sticky date chip and the unread divider", () => {
    it("every day row sticks under the header; a past row hides; only the stuck chip is thick glass", () => {
        const row = styleHaving(["li[data-clariva-date]"]);
        expect(row["position"]).toBe("sticky");
        expect(row["inset-block-start"]).toContain("var(--clariva-room-head)");
        expect(row["pointer-events"]).toBe("none"); // a full-width sticky row never blocks the messages under it
        expect(styleHaving(["li[data-clariva-date][data-clariva-past]"])["visibility"]).toBe("hidden");
        const rest = styleHaving([".mx_TimelineSeparator .mx_DateSeparator_dateContent"]);
        expect(rest["background-color"]).toBe("var(--cg-surface-inset)");
        expect(rest["backdrop-filter"]).toBeUndefined();
        expect(rest["color"]).toBe("var(--cg-text)");
    });

    it("the unread divider is a teal hairline with a small teal-text label on an inset tile", () => {
        const label = styleHaving([".mx_MessagePanel_myReadMarker .mx_ClarivaUnreadLabel"]);
        expect(label["color"]).toBe("var(--cg-teal-text)");
        expect(label["background-color"]).toBe("var(--cg-surface-inset)");
        const hairline = styleHaving([".mx_MessagePanel_myReadMarker hr"]);
        expect(hairline["border-top"]).toBe("1px solid var(--cg-teal-text)");
    });
});

describe("room stylesheets: the DM intro card", () => {
    it("is one thick glass lens with a Fraunces name at 28px, and a rate chip on the amber wash with amber text", () => {
        const name = styleOf(`${ROOT} .mx_ClarivaDmIntro .mx_ClarivaDmIntro_name`);
        expect(name["font-family"]).toBe("var(--cg-font-display)");
        expect(name["font-size"]).toBe("var(--cg-fs-2xl)");
        const rate = styleOf(`${ROOT} .mx_ClarivaDmIntro .mx_ClarivaDmIntro_rate`);
        expect(rate["background-color"]).toBe("var(--cg-amber-wash)");
        expect(rate["color"]).toBe("var(--cg-amber-text)");
        expect(rate["font-family"]).toBe("var(--cg-font-ui)"); // numerals: Inter, tabular (Fraunces figures are proportional)
    });

    it("Voice and Video are 44px inset pills (no second blur inside the lens)", () => {
        const action = styleOf(`${ROOT} .mx_ClarivaDmIntro .mx_ClarivaDmIntro_action`);
        expect(action["min-height"]).toBe("var(--clariva-hit)");
        expect(action["border-radius"]).toBe("var(--cg-r-pill)");
        expect(action["background-color"]).toBe("var(--cg-surface-inset)");
        expect(action["backdrop-filter"]).toBeUndefined();
    });

    it("keeps the stock text as small quiet text, and the role badge is a teal-wash tag", () => {
        const note = styleOf(`${ROOT} .mx_ClarivaDmIntro .mx_ClarivaDmIntro_note`);
        expect(note["color"]).toBe("var(--cg-text-2)");
        const badge = styleOf(`${ROOT} .mx_ClarivaRoleBadge`);
        expect(badge["background-color"]).toContain("var(--cg-teal)");
        // in the floating header the words are --cg-text (rule 7); on the card they are teal text
        expect(badge["color"]).toBe("var(--cg-text)");
        expect(styleOf(`${ROOT} .mx_ClarivaDmIntro .mx_ClarivaRoleBadge`)["color"]).toBe("var(--cg-teal-text)");
    });
});

// ── contrast, measured over the whole wallpaper ────────────────────────────────────────────────────────────────────

const rgbaOf = (value: string): RGBA => parseColor(value);
const tokenColour = (theme: Theme, name: string): RGB => parseColor(themeTokens(theme)[name]).rgb;
const roomTokens = (theme: Theme): Record<string, string> =>
    customProps(
        blockOf(
            ROOM,
            theme === "light" ? `${ROOT} .mx_MatrixChat` : `${ROOT} body[class*="cpd-theme-dark"] .mx_MatrixChat`,
        ),
    );

/** The pane the timeline sits on: the veil over the wallpaper. */
const paneOver = (theme: Theme, wall: RGB): RGB => over(rgbaOf(themeTokens(theme)["--cg-pane-wash"]), wall);

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

describe.each(THEMES)("room contrast (%s theme)", (theme) => {
    const text = (name: string): RGB => tokenColour(theme, name);
    const walls = wallpaperSweep(theme);
    const lift = rgbaOf(roomTokens(theme)["--clariva-bubble-in-lift"]);
    const inset = rgbaOf(themeTokens(theme)["--cg-fill-inset"]);

    /** What an incoming drop looks like over the wallpaper: lift over inset over the pane veil. */
    const incoming = (wall: RGB): RGB => over(lift, over(inset, paneOver(theme, wall)));

    it("an incoming bubble: text, timestamp (text-2) and link (teal-text) are >= 4.5:1 over every wallpaper point", () => {
        for (const token of ["--cg-text", "--cg-text-2", "--cg-teal-text"]) {
            const worst = worstContrast(walls, text(token), incoming);
            expect({ token, ok: worst.ratio >= 4.5, where: worst.where }).toEqual({
                token,
                ok: true,
                where: worst.where,
            });
        }
    });

    it("an outgoing bubble: --cg-on-tint is >= 4.5:1 on both gradient stops over the pane and every wallpaper point", () => {
        const stops = colorsIn(themeTokens(theme)["--cg-fill-tint"]);
        expect(stops).toHaveLength(2);
        for (const stop of stops) {
            const worst = worstContrast(walls, text("--cg-on-tint"), (wall) => over(stop, paneOver(theme, wall)));
            expect(worst.ratio).toBeGreaterThanOrEqual(4.5);
        }
    });

    it("the ticks: every tick, and the deeper-teal double tick of a read message, are >= 3:1 on the tint", () => {
        const stops = colorsIn(themeTokens(theme)["--cg-fill-tint"]);
        const readValue = roomTokens(theme)["--clariva-tick-read"];
        const read = parseColor(readValue.startsWith("var(") ? themeTokens(theme)["--cg-teal"] : readValue).rgb;
        for (const stop of stops) {
            for (const colour of [read, text("--cg-on-tint")]) {
                const worst = worstContrast(walls, colour, (wall) => over(stop, paneOver(theme, wall)));
                expect(worst.ratio).toBeGreaterThanOrEqual(3);
            }
        }
    });

    it("the mention ring (--cg-focus) is >= 3:1 against the pane around the bubble", () => {
        const worst = worstContrast(walls, text("--cg-focus"), (wall) => paneOver(theme, wall));
        expect(worst.ratio).toBeGreaterThanOrEqual(3);
    });

    it("the composer placeholder (a --cg-text mix) is >= 4.5:1 on thick glass over any content", () => {
        // the share is read from the stylesheet, so a tweak there is measured here
        const share = ROOM.match(
            /inputEmpty > :first-child::before \{\s*color: color-mix\(in srgb, var\(--cg-text\) (\d+)%/,
        );
        expect(share).not.toBeNull();
        const failing: string[] = [];
        for (const [name, content] of Object.entries(CONTENT)) {
            const surface = glassOver(theme, "thick", content);
            const placeholder = over({ rgb: text("--cg-text"), a: Number(share![1]) / 100 }, surface);
            const ratio = contrast(placeholder, surface);
            if (ratio < 4.5) failing.push(`${name}: ${ratio.toFixed(2)}`);
        }
        expect(failing).toEqual([]);
    });

    it("the header's role badge: --cg-text (words and shield) is >= 4.5:1 on the teal wash over thick glass over any content", () => {
        const share = ROOM.match(
            /\.mx_ClarivaRoleBadge \{[^}]*?background-color: color-mix\(in srgb, var\(--cg-teal\) (\d+)%/,
        );
        expect(share).not.toBeNull();
        const wash: RGBA = { rgb: tokenColour(theme, "--cg-teal"), a: Number(share![1]) / 100 };
        const failing: string[] = [];
        for (const [name, content] of Object.entries(CONTENT)) {
            const surface = over(wash, glassOver(theme, "thick", content));
            if (contrast(text("--cg-text"), surface) < 4.5) failing.push(`text on ${name}`);
        }
        expect(failing).toEqual([]);
    });

    it("on the intro card (thick glass over the pane): the teal-text badge and the amber-text rate chip are >= 4.5:1, text-2 too", () => {
        const lens = (wall: RGB): RGB => glassOver(theme, "thick", paneOver(theme, wall));
        const tealWash: RGBA = { rgb: tokenColour(theme, "--cg-teal"), a: 0.12 };
        const amberWash = rgbaOf(themeTokens(theme)["--cg-amber-wash"]);
        const cases: [string, RGB, (wall: RGB) => RGB][] = [
            ["role badge", text("--cg-teal-text"), (wall) => over(tealWash, lens(wall))],
            ["rate chip", text("--cg-amber-text"), (wall) => over(amberWash, lens(wall))],
            ["privacy line", text("--cg-text-2"), lens],
            ["name", text("--cg-text"), lens],
        ];
        for (const [name, colour, surface] of cases) {
            const worst = worstContrast(walls, colour, surface);
            expect({ name, ok: worst.ratio >= 4.5 }).toEqual({ name, ok: true });
        }
    });

    it("the 'Say hello' prompt (text-2) and the typing label are >= 4.5:1 on the bare pane", () => {
        const worst = worstContrast(walls, text("--cg-text-2"), (wall) => paneOver(theme, wall));
        expect(worst.ratio).toBeGreaterThanOrEqual(4.5);
    });
});

describe("room copy", () => {
    it("is plain: no exclamation marks, no emoji, sentence case", () => {
        const samples: string[] = [];
        for (const value of Object.values(roomStrings)) {
            samples.push(typeof value === "function" ? (value as (s: string) => string)("Dr. Rao") : value);
        }
        for (const text of samples) {
            expect(text).not.toMatch(/!/);
            expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
            expect(text[0]).toBe(text[0].toUpperCase());
        }
    });

    it("states the rate the way Android's chat list does, with the unit", () => {
        expect(roomStrings.introRate("100")).toBe("100 credits per 24 h chat");
        expect(roomStrings.introSayHello("Dr. Rao")).toBe("Say hello to Dr. Rao");
        expect(roomStrings.introPrivate).toBe("Private and end-to-end encrypted");
    });
});
