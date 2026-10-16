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

import { type RefObject, useEffect } from "react";

/** How far the list must scroll before the large "Chats" title hands over to the compact one in the header (px). */
export const COLLAPSE_AFTER_PX = 28;
/** It comes back below this (a gap, so a list resting on the threshold does not flicker between the two). */
export const EXPAND_BELOW_PX = 8;

/** The attribute CSS reads on the list column: `data-collapsed="true"` while the list is scrolled. */
export const COLLAPSED_ATTRIBUTE = "data-collapsed";

/**
 * Watches `scroller` and mirrors "scrolled past the large title" into `data-collapsed` on `column`. The handler is a
 * passive listener that reads one number and writes the attribute only when the answer CHANGES, so scrolling costs no
 * layout and no style work between the two states; the title swap itself is two opacity + transform transitions in CSS
 * (no motion at all under reduced motion). Returns the cleanup.
 */
export function bindListCollapse(column: HTMLElement, scroller: HTMLElement): () => void {
    let collapsed = false;
    const sync = (): void => {
        const top = scroller.scrollTop;
        const next = collapsed ? top > EXPAND_BELOW_PX : top > COLLAPSE_AFTER_PX;
        if (next === collapsed) return;
        collapsed = next;
        column.setAttribute(COLLAPSED_ATTRIBUTE, String(next));
    };
    column.setAttribute(COLLAPSED_ATTRIBUTE, "false");
    sync();
    scroller.addEventListener("scroll", sync, { passive: true });
    return () => {
        scroller.removeEventListener("scroll", sync);
        column.removeAttribute(COLLAPSED_ATTRIBUTE);
    };
}

/**
 * Finds the list column and its scroller from the header (both live in the same `.mx_LeftPanel_roomListContainer`) and
 * binds them for as long as the header is mounted.
 */
export function useListCollapse(headerRef: RefObject<HTMLElement>, enabled: boolean): void {
    useEffect(() => {
        if (!enabled) return;
        const column = headerRef.current?.closest<HTMLElement>(".mx_LeftPanel_roomListContainer");
        const scroller = column?.querySelector<HTMLElement>(".mx_LeftPanel_actualRoomListContainer");
        if (!column || !scroller) return;
        return bindListCollapse(column, scroller);
    }, [headerRef, enabled]);
}
