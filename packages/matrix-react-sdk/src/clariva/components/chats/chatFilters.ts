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

import { EventEmitter } from "events";
import { type Room } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";

import { FILTER_CHANGED, type IFilterCondition } from "../../../stores/room-list/filters/IFilterCondition";
import RoomListStore from "../../../stores/room-list/RoomListStore";
import { DefaultTagID } from "../../../stores/room-list/models";
import {
    RoomNotificationStateStore,
    UPDATE_STATUS_INDICATOR,
} from "../../../stores/notifications/RoomNotificationStateStore";
import { UPDATE_EVENT } from "../../../stores/AsyncStore";
import { SdkContextClass } from "../../../contexts/SDKContext";
import DMRoomMap from "../../../utils/DMRoomMap";
import { chatsStrings as S } from "../../strings/chats";

/** The chips of the Chats home (Android `RoomListFilter`, same order). */
export enum ChatFilter {
    Unread = "unread",
    People = "people",
    Rooms = "rooms",
    Favourites = "favourites",
    Invites = "invites",
}

export const CHAT_FILTER_ORDER: readonly ChatFilter[] = [
    ChatFilter.Unread,
    ChatFilter.People,
    ChatFilter.Rooms,
    ChatFilter.Favourites,
    ChatFilter.Invites,
];

export const CHAT_FILTER_LABELS: Readonly<Record<ChatFilter, string>> = {
    [ChatFilter.Unread]: S.filterUnread,
    [ChatFilter.People]: S.filterPeople,
    [ChatFilter.Rooms]: S.filterRooms,
    [ChatFilter.Favourites]: S.filterFavourites,
    [ChatFilter.Invites]: S.filterInvites,
};

/** Android `RoomListFilter.incompatibleFilters`: selecting a chip drops these, and they are not offered meanwhile. */
const INCOMPATIBLE: Readonly<Record<ChatFilter, readonly ChatFilter[]>> = {
    [ChatFilter.Rooms]: [ChatFilter.People, ChatFilter.Invites],
    [ChatFilter.People]: [ChatFilter.Rooms, ChatFilter.Invites],
    [ChatFilter.Unread]: [ChatFilter.Invites],
    [ChatFilter.Favourites]: [ChatFilter.Invites],
    [ChatFilter.Invites]: [ChatFilter.Rooms, ChatFilter.People, ChatFilter.Unread, ChatFilter.Favourites],
};

/** The selection after tapping `filter`: toggles it and removes whatever cannot be combined with it. */
export function toggleChatFilter(selected: ReadonlySet<ChatFilter>, filter: ChatFilter): Set<ChatFilter> {
    const next = new Set(selected);
    if (next.delete(filter)) return next;
    for (const other of INCOMPATIBLE[filter]) next.delete(other);
    next.add(filter);
    return next;
}

/**
 * The chips to render, Android's order: the selected ones first (in selection order), then the unselected ones that
 * are still compatible with the selection.
 */
export function visibleChatFilters(selected: ReadonlySet<ChatFilter>): ChatFilter[] {
    const hidden = new Set<ChatFilter>();
    for (const filter of selected) for (const other of INCOMPATIBLE[filter]) hidden.add(other);
    const rest = CHAT_FILTER_ORDER.filter((f) => !selected.has(f) && !hidden.has(f));
    return [...selected, ...rest];
}

/** What the filters need to know about one room (kept separate from matrix-js-sdk so it is trivially testable). */
export interface RoomFacts {
    isDm: boolean;
    isInvite: boolean;
    isFavourite: boolean;
    isUnread: boolean;
}

/** AND of all selected chips (empty selection: everything matches). */
export function roomMatchesFilters(facts: RoomFacts, selected: ReadonlySet<ChatFilter>): boolean {
    for (const filter of selected) {
        switch (filter) {
            case ChatFilter.Unread:
                if (!facts.isUnread) return false;
                break;
            case ChatFilter.People:
                if (!facts.isDm) return false;
                break;
            case ChatFilter.Rooms:
                if (facts.isDm) return false;
                break;
            case ChatFilter.Favourites:
                if (!facts.isFavourite) return false;
                break;
            case ChatFilter.Invites:
                if (!facts.isInvite) return false;
                break;
        }
    }
    return true;
}

export interface EmptyStateCopy {
    title: string;
    subtitle?: string;
}

/** Android `RoomListFiltersEmptyStateResources`: the empty-state copy for the selection (or for "no chats at all"). */
export function emptyStateCopy(selected: ReadonlySet<ChatFilter>): EmptyStateCopy {
    if (selected.size === 0) return { title: S.emptyTitle, subtitle: S.emptyMessage };
    if (selected.size > 1) return { title: S.emptyMixedTitle, subtitle: S.emptyMixedSubtitle };
    switch ([...selected][0]) {
        case ChatFilter.Unread:
            return { title: S.emptyUnreadTitle, subtitle: S.emptyUnreadSubtitle };
        case ChatFilter.People:
            return { title: S.emptyPeopleTitle, subtitle: S.emptyMixedSubtitle };
        case ChatFilter.Rooms:
            return { title: S.emptyRoomsTitle, subtitle: S.emptyMixedSubtitle };
        case ChatFilter.Favourites:
            return { title: S.emptyFavouritesTitle, subtitle: S.emptyFavouritesSubtitle };
        case ChatFilter.Invites:
            return { title: S.emptyInvitesTitle };
    }
}

function isDirect(room: Room): boolean {
    try {
        return !!DMRoomMap.shared().getUserIdForRoomId(room.roomId);
    } catch {
        return false; // DMRoomMap not started yet: treat as a regular room
    }
}

function factsFor(room: Room, currentRoomId: string | null | undefined): RoomFacts {
    return {
        isDm: isDirect(room),
        isInvite: room.getMyMembership() === KnownMembership.Invite,
        isFavourite: !!room.tags?.[DefaultTagID.Favourite],
        // The chat that is open stays in the "Unread" list even though opening it just marked it read, otherwise the
        // row would vanish under the user's cursor.
        isUnread: room.roomId === currentRoomId || RoomNotificationStateStore.instance.getRoomState(room).isUnread,
    };
}

/** How long to wait before re-evaluating the filters after the underlying state changed (unread counts, tags...). */
const REFRESH_DEBOUNCE_MS = 200;

/**
 * The filter condition registered with `RoomListStore` while at least one chip is selected: the list, the sections
 * and the unread counts then all come from the stock store, only narrower.
 */
export class ChatFilterCondition extends EventEmitter implements IFilterCondition {
    private timer: number | undefined;

    public constructor(private readonly getSelected: () => ReadonlySet<ChatFilter>) {
        super();
    }

    public isVisible(room: Room): boolean {
        const selected = this.getSelected();
        if (selected.size === 0) return true;
        return roomMatchesFilters(factsFor(room, SdkContextClass.instance.roomViewStore.getRoomId()), selected);
    }

    /** Re-evaluate every room soon (debounced): the answer of `isVisible` may have changed. */
    public scheduleRefresh = (): void => {
        if (this.timer !== undefined) return;
        this.timer = window.setTimeout(() => {
            this.timer = undefined;
            this.emit(FILTER_CHANGED);
        }, REFRESH_DEBOUNCE_MS);
    };

    public destroy(): void {
        if (this.timer !== undefined) window.clearTimeout(this.timer);
        this.timer = undefined;
        this.removeAllListeners();
    }
}

export const CHAT_FILTERS_CHANGED = "chat_filters_changed";

/**
 * The selected chips (in memory only, like Android: the selection is gone after a restart) and their wiring to the
 * room list. A singleton because the chips and the empty state live in different parts of the left panel.
 */
export class ClarivaChatFilterStore extends EventEmitter {
    private static internal: ClarivaChatFilterStore | undefined;

    public static get instance(): ClarivaChatFilterStore {
        return (ClarivaChatFilterStore.internal ??= new ClarivaChatFilterStore());
    }

    private selectedFilters: ReadonlySet<ChatFilter> = new Set();
    private condition: ChatFilterCondition | null = null;

    public get selected(): ReadonlySet<ChatFilter> {
        return this.selectedFilters;
    }

    public toggle(filter: ChatFilter): void {
        this.setSelected(toggleChatFilter(this.selectedFilters, filter));
    }

    public clear(): void {
        this.setSelected(new Set());
    }

    private setSelected(next: ReadonlySet<ChatFilter>): void {
        this.selectedFilters = next;
        if (next.size > 0 && !this.condition) {
            this.attach();
        } else if (next.size === 0 && this.condition) {
            this.detach();
        } else {
            this.condition?.scheduleRefresh();
        }
        this.emit(CHAT_FILTERS_CHANGED, next);
    }

    private attach(): void {
        const condition = new ChatFilterCondition(() => this.selectedFilters);
        this.condition = condition;
        // Unread counts, the open chat and tags are not part of what the store re-evaluates on its own.
        RoomNotificationStateStore.instance.on(UPDATE_STATUS_INDICATOR, condition.scheduleRefresh);
        SdkContextClass.instance.roomViewStore.on(UPDATE_EVENT, condition.scheduleRefresh);
        void RoomListStore.instance.addFilter(condition);
    }

    private detach(): void {
        const condition = this.condition;
        if (!condition) return;
        this.condition = null;
        RoomNotificationStateStore.instance.off(UPDATE_STATUS_INDICATOR, condition.scheduleRefresh);
        SdkContextClass.instance.roomViewStore.off(UPDATE_EVENT, condition.scheduleRefresh);
        RoomListStore.instance.removeFilter(condition);
        condition.destroy();
    }

    /**
     * Sign-out / tests: drop the selection and unhook from the room list. `notify: false` skips the change event (the
     * chips call it while unmounting, when the components that would hear it are going away too).
     */
    public reset(notify = true): void {
        const hadSelection = this.selectedFilters.size > 0;
        this.selectedFilters = new Set();
        this.detach();
        if (notify && hadSelection) this.emit(CHAT_FILTERS_CHANGED, this.selectedFilters);
    }
}
