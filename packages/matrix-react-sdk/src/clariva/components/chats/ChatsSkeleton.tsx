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
import { ClientEvent } from "matrix-js-sdk/src/matrix";

import { useEventEmitterState } from "../../../hooks/useEventEmitter";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { isClarivaEnabled } from "../../config";
import { chatsStrings as S } from "../../strings/chats";
import { Skeleton } from "../../ui";
import { countListedRooms } from "./ChatsEmptyState";
import RoomListStore, { LISTS_UPDATE_EVENT } from "../../../stores/room-list/RoomListStore";

/** How many placeholder rows the first load shows (a screenful on a phone, calm on a desktop). */
export const SKELETON_ROW_COUNT = 6;

/** Name and preview widths per row (percent of the text column): varied so the stack reads as a list, not a grid. */
const NAME_WIDTHS = [46, 38, 52, 34, 44, 40] as const;
const PREVIEW_WIDTHS = [78, 64, 70, 58, 74, 66] as const;

/** True until the client finished its first sync (reactive: the sync state event fires when it completes). */
function useFirstSyncPending(): boolean {
    const client = MatrixClientPeg.get() ?? undefined;
    return useEventEmitterState(
        client,
        ClientEvent.Sync,
        () => MatrixClientPeg.get()?.isInitialSyncComplete() === false,
    );
}

/**
 * Six placeholder chat rows while the FIRST sync loads and nothing is listed yet (a quiet opacity pulse, never a shimmer).
 * It is a polite status region named "Loading chats", so a screen reader hears one sentence instead of eighteen empty
 * blocks. Gone as soon as the sync completes or the first chat appears (the empty state then takes over if there are none).
 */
export function ChatsSkeleton(): JSX.Element | null {
    const enabled = isClarivaEnabled();
    const pending = useFirstSyncPending();
    const listed = useEventEmitterState(RoomListStore.instance, LISTS_UPDATE_EVENT, countListedRooms);

    if (!enabled || !pending || listed > 0) return null;

    return (
        <div className="mx_ClarivaChatsSkeleton" role="status" aria-busy="true" data-testid="clariva-chats-skeleton">
            <span className="mx_ClarivaChatsSkeleton_status">{S.loadingChats}</span>
            {Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => (
                <div className="mx_ClarivaChatsSkeleton_row" key={i} aria-hidden="true">
                    <Skeleton width={52} height={52} radius="pill" />
                    <div className="mx_ClarivaChatsSkeleton_text">
                        <Skeleton width={`${NAME_WIDTHS[i % NAME_WIDTHS.length]}%`} height={14} radius="xs" />
                        <Skeleton width={`${PREVIEW_WIDTHS[i % PREVIEW_WIDTHS.length]}%`} height={12} radius="xs" />
                    </div>
                </div>
            ))}
        </div>
    );
}

export default ChatsSkeleton;
