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

/**
 * Source scanners for the Clariva SURFACE partials (everything in res/css/clariva except the foundation). They look at
 * comment-stripped stylesheet text (readCss) and find, for a pattern, the rules that enclose it, so a test can say "this
 * selector may use a raw blur" or "that selector is floating chrome". They are plain text walkers, good enough for the
 * flat, prettier-formatted partials; designTokens-test.ts also runs them on fixtures so a broken scanner cannot pass silently.
 */

export interface Enclosure {
    /** the rule headers around the match, outermost first (".a", "&:hover", "@media (...)") */
    chain: string[];
    /** index of the `{` that opens the innermost rule */
    open: number;
}

/** The rules a position in `css` sits in. */
export function enclosing(css: string, index: number): Enclosure {
    const chain: string[] = [];
    let open = -1;
    let depth = 0;
    for (let i = index - 1; i >= 0; i--) {
        const ch = css[i];
        if (ch === "}") {
            depth++;
        } else if (ch === "{") {
            if (depth > 0) {
                depth--;
                continue;
            }
            if (open < 0) open = i;
            let start = i - 1;
            while (start >= 0 && !";{}".includes(css[start])) start--;
            chain.unshift(
                css
                    .slice(start + 1, i)
                    .replace(/\s+/g, " ")
                    .trim(),
            );
        }
    }
    return { chain, open };
}

/** What a foundation-only construct looks like when a surface writes it by hand. */
export interface RawGlassHit {
    kind: "backdrop-filter" | "blur(" | "--cg-fill-" | "--cg-solid-";
    text: string;
    chain: string[];
}

/**
 * Hand-written glass in a surface partial: a `backdrop-filter` other than `none`, a literal `blur(`, or the raw
 * `--cg-fill-*` / `--cg-solid-*` token families. A surface must use a material mixin instead (it reads the derived
 * tokens, which the accessibility fallbacks re-point), otherwise it keeps its blur and translucency under reduced
 * transparency, more contrast and forced colours.
 */
export function rawGlassHits(css: string): RawGlassHit[] {
    const hits: RawGlassHit[] = [];
    const add = (kind: RawGlassHit["kind"], match: RegExpMatchArray): void => {
        hits.push({ kind, text: match[0].trim(), chain: enclosing(css, match.index ?? 0).chain });
    };
    for (const m of css.matchAll(/(?:-webkit-)?backdrop-filter\s*:\s*([^;}]*)/g)) {
        if (m[1].trim() !== "none") add("backdrop-filter", m);
    }
    for (const m of css.matchAll(/(?<![\w-])blur\(/g)) add("blur(", m);
    for (const m of css.matchAll(/--cg-fill-[\w-]+/g)) add("--cg-fill-", m);
    for (const m of css.matchAll(/--cg-solid-[\w-]+/g)) add("--cg-solid-", m);
    return hits;
}

/** Selectors that float over scrolling content (rule 7 of DESIGN-SYSTEM.md section 3). */
export const FLOATING_CHROME = /RoomHeader|MessageComposer|Composer|TabBar|JumpToBottom|ScrollToLatest|ScrollToBottom/i;

export interface ChromeProblem {
    selector: string;
    mixin: string;
}

/**
 * Rules whose selector names floating chrome and that use cg-glass-thin / cg-glass-regular. Rule 7: floating chrome is
 * cg-glass-thick ONLY (the pane wash is a light veil, so there is no "veiled regular" exception any more).
 */
export function floatingChromeProblems(css: string): ChromeProblem[] {
    const problems: ChromeProblem[] = [];
    for (const m of css.matchAll(/@mixin (cg-glass-thin|cg-glass-regular);/g)) {
        const { chain } = enclosing(css, m.index ?? 0);
        const selector = chain[chain.length - 1] ?? "";
        if (!FLOATING_CHROME.test(chain.join(" "))) continue;
        problems.push({ selector: chain.join(" "), mixin: `${m[1]} (in ${selector})` });
    }
    return problems;
}
