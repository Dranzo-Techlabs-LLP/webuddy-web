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

import React from "react";

import dis from "../../../dispatcher/dispatcher";
import { useEventEmitterState } from "../../../hooks/useEventEmitter";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import RoomListStore, { LISTS_UPDATE_EVENT } from "../../../stores/room-list/RoomListStore";
import { DefaultTagID } from "../../../stores/room-list/models";
import { isClarivaEnabled } from "../../config";
import { chatsStrings as S } from "../../strings/chats";
import { ClarivaChatFilterStore, emptyStateCopy } from "./chatFilters";
import { useChatFilters } from "./ChatFilterChips";
import { ChatsIllustration } from "./ChatsIllustration";

/** Rooms the list is showing (every section except the one stock Element never renders). */
export function countListedRooms(): number {
    let count = 0;
    for (const [tagId, rooms] of Object.entries(RoomListStore.instance.orderedLists)) {
        if (tagId !== DefaultTagID.Archived) count += rooms?.length ?? 0;
    }
    return count;
}

export function startChat(): void {
    dis.dispatch({ action: "view_create_chat" });
}

/**
 * Shown under the (empty) list: "No chats yet" with a glass-bubble picture and ONE primary action (Start a chat), or
 * Android's per-filter message ("no results") with a magnifier picture and a Clear filters action. Waits for the first sync
 * so a list that is merely still loading never flashes it (the skeleton rows cover that wait).
 */
export function ChatsEmptyState(): JSX.Element | null {
    const enabled = isClarivaEnabled();
    const selected = useChatFilters();
    const count = useEventEmitterState(RoomListStore.instance, LISTS_UPDATE_EVENT, countListedRooms);

    if (!enabled || count > 0) return null;
    if (!MatrixClientPeg.get()?.isInitialSyncComplete()) return null;

    const { title, subtitle } = emptyStateCopy(selected);
    const filtering = selected.size > 0;

    return (
        <div className="mx_ClarivaChatsEmpty" data-testid="clariva-chats-empty" role="status">
            <ChatsIllustration variant={filtering ? "search" : "chats"} />
            <h2 className="mx_ClarivaChatsEmpty_title">{title}</h2>
            {subtitle && <p className="mx_ClarivaChatsEmpty_subtitle">{subtitle}</p>}
            {filtering ? (
                <button
                    type="button"
                    className="mx_ClarivaChatsEmpty_action mx_ClarivaChatsEmpty_action_secondary"
                    onClick={() => ClarivaChatFilterStore.instance.clear()}
                >
                    {S.clearFilters}
                </button>
            ) : (
                <button type="button" className="mx_ClarivaChatsEmpty_action" onClick={startChat}>
                    {S.startAChat}
                </button>
            )}
        </div>
    );
}

export default ChatsEmptyState;
