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

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import classNames from "classnames";
import { Icon as CloseIcon } from "@vector-im/compound-design-tokens/icons/close.svg";

import { isClarivaEnabled } from "../../config";
import { chatsStrings as S } from "../../strings/chats";
import {
    CHAT_FILTER_LABELS,
    CHAT_FILTERS_CHANGED,
    ClarivaChatFilterStore,
    type ChatFilter,
    visibleChatFilters,
} from "./chatFilters";

/** The currently selected chips (live). */
export function useChatFilters(): ReadonlySet<ChatFilter> {
    const store = ClarivaChatFilterStore.instance;
    const [selected, setSelected] = useState<ReadonlySet<ChatFilter>>(() => store.selected);
    useEffect(() => {
        const onChange = (next: ReadonlySet<ChatFilter>): void => setSelected(next);
        store.on(CHAT_FILTERS_CHANGED, onChange);
        onChange(store.selected);
        return () => {
            store.off(CHAT_FILTERS_CHANGED, onChange);
        };
    }, [store]);
    return selected;
}

/** Moves the chips that changed place from where they were to where they are now (FLIP): transform only. */
export function slideChips(
    chips: ReadonlyArray<HTMLElement>,
    before: ReadonlyMap<string, number>,
    after: ReadonlyMap<string, number>,
): void {
    const moved: HTMLElement[] = [];
    for (const chip of chips) {
        const key = chip.dataset.filter;
        const from = key === undefined ? undefined : before.get(key);
        const to = key === undefined ? undefined : after.get(key);
        if (from === undefined || to === undefined || from === to) continue;
        chip.style.transition = "none";
        chip.style.transform = `translate3d(${from - to}px, 0, 0)`;
        moved.push(chip);
    }
    if (moved.length === 0) return;
    void moved[0].offsetWidth; // commit the starting positions before the transition is switched on
    for (const chip of moved) {
        chip.style.transition = "transform var(--cg-dur-sheet, 380ms) var(--cg-spring, ease-out)";
        chip.style.transform = "";
        chip.addEventListener("transitionend", () => (chip.style.transition = ""), { once: true });
    }
}

function prefersReducedMotion(): boolean {
    try {
        return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
        return false;
    }
}

/**
 * The row of filter chips under the search field (Android: Unread / People / Rooms / Favourites / Invites). They really
 * narrow the list: the selection is a room-list filter condition (see chatFilters.ts). `aria-pressed` toggles; the row
 * scrolls horizontally when it does not fit (phones). Renders nothing when Clariva is not configured.
 */
export function ChatFilterChips(): JSX.Element | null {
    const enabled = isClarivaEnabled();
    const selected = useChatFilters();
    const scrollerRef = useRef<HTMLDivElement>(null);
    const lastLeft = useRef<ReadonlyMap<string, number>>(new Map());
    const slideNext = useRef(false);

    // The selected chips jump to the front of the row (Android's order): they slide there instead of snapping, with the
    // spring, but only for a pointer press (a keyboard user gets the change at once) and never under reduced motion.
    useLayoutEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        const chips = Array.from(scroller.querySelectorAll<HTMLElement>("[data-filter]"));
        const positions = new Map<string, number>();
        for (const chip of chips) positions.set(chip.dataset.filter!, chip.offsetLeft);
        if (slideNext.current && !prefersReducedMotion()) slideChips(chips, lastLeft.current, positions);
        slideNext.current = false;
        lastLeft.current = positions;
    }, [selected]);

    // The selection belongs to this signed-in session: forget it (and unhook from the room list) on unmount.
    useEffect(() => {
        if (!enabled) return;
        return () => ClarivaChatFilterStore.instance.reset(false);
    }, [enabled]);

    if (!enabled) return null;
    const store = ClarivaChatFilterStore.instance;
    const active = selected.size > 0;

    return (
        <div
            className="mx_ClarivaChatFilters"
            role="group"
            aria-label={S.filtersLabel}
            data-active={active ? "true" : "false"}
            data-testid="clariva-chat-filters"
        >
            <div className="mx_ClarivaChatFilters_scroller" ref={scrollerRef}>
                {active && (
                    <button
                        type="button"
                        className="mx_ClarivaChatFilters_clear"
                        onClick={(ev) => {
                            slideNext.current = ev.detail > 0;
                            store.clear();
                        }}
                        aria-label={S.clearFilters}
                        title={S.clearFilters}
                        data-testid="clariva-chat-filter-clear"
                    >
                        <span className="mx_ClarivaChatFilters_clearIcon">
                            <CloseIcon width="16px" height="16px" aria-hidden="true" />
                        </span>
                    </button>
                )}
                {visibleChatFilters(selected).map((filter) => {
                    const pressed = selected.has(filter);
                    return (
                        <button
                            key={filter}
                            type="button"
                            className={classNames("mx_ClarivaChatFilters_chip", {
                                mx_ClarivaChatFilters_chip_selected: pressed,
                            })}
                            aria-pressed={pressed}
                            onClick={(ev) => {
                                slideNext.current = ev.detail > 0; // 0 = keyboard, so no slide
                                store.toggle(filter);
                            }}
                            data-filter={filter}
                            data-testid={`clariva-chat-filter-${filter}`}
                        >
                            <span className="mx_ClarivaChatFilters_chipLabel">{CHAT_FILTER_LABELS[filter]}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export default ChatFilterChips;
