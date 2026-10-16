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

import { type RefObject, useLayoutEffect } from "react";

import { isClarivaEnabled } from "../../config";

/** How long the leaving copy lives: a little longer than the 120 ms exit animation in `_chatroom.pcss`. */
export const PILL_EXIT_MS = 200;

/** The class the stylesheet animates (opacity + translateY, 120 ms) and which switches the copy's pointer events off. */
export const PILL_LEAVING_CLASS = "mx_JumpToBottomButton_leaving";

/**
 * Leave a floating pill (the scroll-to-latest button) with an exit animation although its parent unmounts it at once.
 * A React component cannot delay its own unmount, and the room view that owns the pill is not ours to change, so on
 * unmount an inert, aria-hidden CLONE of the pill is left in the same parent for `PILL_EXIT_MS`; the stylesheet plays the
 * exit on it. Does nothing outside Clariva, in a tab that is not visible, or when the pill was not in the page.
 */
export function useClarivaPillExit(ref: RefObject<HTMLElement>): void {
    useLayoutEffect(() => {
        if (!isClarivaEnabled()) return;
        const node = ref.current;
        return () => {
            const parent = node?.parentElement;
            if (!node || !parent || !node.isConnected || document.visibilityState !== "visible") return;
            const ghost = node.cloneNode(true) as HTMLElement;
            ghost.classList.add(PILL_LEAVING_CLASS);
            ghost.setAttribute("aria-hidden", "true");
            ghost.querySelectorAll("[tabindex]").forEach((el) => el.setAttribute("tabindex", "-1"));
            parent.appendChild(ghost);
            window.setTimeout(() => ghost.remove(), PILL_EXIT_MS);
        };
        // the ref object is stable; the node is read once, when the effect runs
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
}
