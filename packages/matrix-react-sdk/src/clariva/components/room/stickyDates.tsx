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

import React, { useEffect, useRef } from "react";

/** The attributes the stylesheet reads. */
export const DATE_ATTR = "data-clariva-date";
export const STUCK_ATTR = "data-clariva-stuck";
export const PAST_ATTR = "data-clariva-past";

export interface StickyResult {
    /** Index of the date chip that is stuck at the top right now, or -1 when none has reached it. */
    current: number;
    /** `past[i]`: chip i is stuck BEHIND the current one and must be hidden (only one chip shows at the top). */
    past: boolean[];
}

/**
 * Which date chips are stuck, from their on-screen tops (document order) and the line they stick to. Every date row is
 * `position: sticky`, so all rows above the viewport pile up on that line: the LAST of them is the day being read, the
 * earlier ones are hidden. A chip is stuck once its top has reached the line (`epsilon` absorbs sub-pixel rounding).
 * Pure.
 */
export function computeStickyDates(tops: readonly number[], line: number, epsilon = 1): StickyResult {
    const stuck = tops.map((top) => top <= line + epsilon);
    const current = stuck.lastIndexOf(true);
    return { current, past: stuck.map((isStuck, i) => isStuck && i < current) };
}

const byDocumentOrder = (a: HTMLElement, b: HTMLElement): number =>
    a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;

/** One per timeline scroller: watches its scroll position and keeps the date chips' attributes right. */
class StickyDateGroup {
    private readonly rows = new Set<HTMLElement>();
    private frame = 0;

    public constructor(private readonly scroller: HTMLElement) {
        scroller.addEventListener("scroll", this.schedule, { passive: true });
        window.addEventListener("resize", this.schedule);
    }

    public add(row: HTMLElement): void {
        this.rows.add(row);
        this.schedule();
    }

    /** Returns true when the group has no rows left (the caller drops it). */
    public remove(row: HTMLElement): boolean {
        this.rows.delete(row);
        row.removeAttribute(STUCK_ATTR);
        row.removeAttribute(PAST_ATTR);
        if (this.rows.size > 0) {
            this.schedule();
            return false;
        }
        this.dispose();
        return true;
    }

    private dispose(): void {
        this.scroller.removeEventListener("scroll", this.schedule);
        window.removeEventListener("resize", this.schedule);
        if (this.frame) cancelAnimationFrame(this.frame);
        this.frame = 0;
    }

    private readonly schedule = (): void => {
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            this.update();
        });
    };

    /** Exposed for tests: recompute now. */
    public update(): void {
        const rows = [...this.rows].sort(byDocumentOrder);
        if (rows.length === 0) return;
        const stickyTop = parseFloat(getComputedStyle(rows[0]).top);
        const line = this.scroller.getBoundingClientRect().top + (Number.isFinite(stickyTop) ? stickyTop : 0);
        const { current, past } = computeStickyDates(
            rows.map((row) => row.getBoundingClientRect().top),
            line,
        );
        rows.forEach((row, i) => {
            row.toggleAttribute(PAST_ATTR, past[i]);
            row.toggleAttribute(STUCK_ATTR, i === current);
        });
    }
}

const groups = new WeakMap<HTMLElement, StickyDateGroup>();

/**
 * Mark a timeline date row as sticky and keep exactly one of them (the day being read) visible at the top. Returns the
 * cleanup. A row outside a timeline scroller is left as a normal in-flow row.
 */
export function registerStickyDate(row: HTMLElement): () => void {
    row.setAttribute(DATE_ATTR, "");
    const scroller = row.closest<HTMLElement>(".mx_ScrollPanel");
    if (!scroller) return () => row.removeAttribute(DATE_ATTR);
    let group = groups.get(scroller);
    if (!group) {
        group = new StickyDateGroup(scroller);
        groups.set(scroller, group);
    }
    const mine = group;
    mine.add(row);
    return () => {
        row.removeAttribute(DATE_ATTR);
        if (mine.remove(row) && groups.get(scroller) === mine) groups.delete(scroller);
    };
}

/** Test seam: the group of a scroller, to force an update without waiting for a frame. */
export function stickyGroupOf(scroller: HTMLElement): { update(): void } | undefined {
    return groups.get(scroller);
}

/**
 * Rendered inside a `DateSeparator`: turns the `<li>` the timeline wraps it in into a sticky date row. Renders nothing
 * visible.
 */
export function ClarivaStickyDateMarker(): JSX.Element {
    const ref = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        const row = ref.current?.closest("li");
        if (!row) return;
        return registerStickyDate(row);
    }, []);
    return <span ref={ref} hidden />;
}
