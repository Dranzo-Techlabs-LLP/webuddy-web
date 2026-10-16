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

import { type Room } from "matrix-js-sdk/src/matrix";

import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";
import { useEventEmitterState } from "../../../hooks/useEventEmitter";
import RoomListStore, { LISTS_UPDATE_EVENT } from "../../../stores/room-list/RoomListStore";
import { DefaultTagID } from "../../../stores/room-list/models";
import { getClarivaDmPeerId } from "../../chat/dmPeer";
import { getLastActivityTs } from "../chats/RoomTileTime";

/** The rail shows at most this many conversations. */
export const MAX_RECENT_CHATS = 8;

/** Tags whose rooms are not conversations to go back to: invites (not joined yet), the archive, server notices. */
const SKIPPED_TAGS: ReadonlySet<string> = new Set([
    DefaultTagID.Invite,
    DefaultTagID.Archived,
    DefaultTagID.ServerNotice,
]);

/**
 * The newest `limit` items that are 1:1 chats, newest first. Generic over the room type so the ordering and the cut-off can
 * be tested without a Matrix client; ties keep their original order.
 */
export function selectRecentChats<T>(
    rooms: readonly T[],
    isChat: (room: T) => boolean,
    lastActivity: (room: T) => number,
    limit: number = MAX_RECENT_CHATS,
): T[] {
    return rooms
        .filter(isChat)
        .map((room, index) => ({ room, index, ts: lastActivity(room) }))
        .sort((a, b) => b.ts - a.ts || a.index - b.index)
        .slice(0, limit)
        .map((entry) => entry.room);
}

function peerOf(room: Room): string | null {
    try {
        return getClarivaDmPeerId(room);
    } catch {
        return null; // DMRoomMap not started yet: not a chat to list (yet)
    }
}

/** Every room the Chats list shows, once each, minus the tags that are not conversations. */
export function listedRooms(): Room[] {
    const rooms: Room[] = [];
    const seen = new Set<string>();
    for (const [tagId, tagged] of Object.entries(RoomListStore.instance.orderedLists)) {
        if (SKIPPED_TAGS.has(tagId)) continue;
        for (const room of tagged ?? []) {
            if (seen.has(room.roomId)) continue;
            seen.add(room.roomId);
            rooms.push(room);
        }
    }
    return rooms;
}

/** The recent 1:1 chats of the signed-in user (live: it follows the room list). */
export function useRecentChats(): Room[] {
    return useEventEmitterState(RoomListStore.instance, LISTS_UPDATE_EVENT, () =>
        selectRecentChats(listedRooms(), (room) => peerOf(room) !== null, getLastActivityTs),
    );
}

/**
 * The chats of clients who have an open refund request, newest first (a consultant's "Review refunds" opens the first).
 * `pendingClients` is `WalletStore.pendingRefundClients`: the Matrix IDs of those clients.
 */
export function chatsWithPendingRefunds(rooms: readonly Room[], pendingClients: ReadonlySet<string>): Room[] {
    if (pendingClients.size === 0) return [];
    return selectRecentChats(
        rooms,
        (room) => {
            const peer = peerOf(room);
            return peer !== null && pendingClients.has(peer);
        },
        getLastActivityTs,
        Number.MAX_SAFE_INTEGER,
    );
}

/** Open a room exactly as a click on its row in the Chats list does. */
export function openChat(roomId: string): void {
    dis.dispatch<ViewRoomPayload>({
        action: Action.ViewRoom,
        show_room_tile: true, // make sure the row is visible in the list
        room_id: roomId,
        metricsTrigger: "RoomList",
    });
}

/** A consultant's "Review refunds": opens the most recently active chat among the clients who asked; false when none is listed. */
export function reviewRefunds(pendingClients: ReadonlySet<string>): boolean {
    const [first] = chatsWithPendingRefunds(listedRooms(), pendingClients);
    if (!first) return false;
    openChat(first.roomId);
    return true;
}
