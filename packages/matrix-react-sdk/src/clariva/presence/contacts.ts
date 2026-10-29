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

import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";

import { safeDmPeerId } from "../chat/useChatGate";

/** Someone the user can exclude in "My contacts except...". */
export interface PresenceContact {
    userId: string;
    /** Display name, `null` when they have none (the row then shows the user ID alone). */
    name: string | null;
    /** The 1:1 room with them (for the avatar). */
    room: Room;
}

/**
 * Is `peerId` my "contact" in this 1:1 chat? A contact is someone I have a DM with that BOTH of us have joined: an
 * unanswered chat request does not count (Android `isPeerJoined` / `PresencePrivacy`).
 */
export function isPresenceContact(room: Room, peerId: string): boolean {
    return (
        room.getMyMembership() === KnownMembership.Join && room.getMember(peerId)?.membership === KnownMembership.Join
    );
}

/**
 * My "contacts": everyone I have a 1:1 chat with that both of us have joined, sorted by name, one entry per person
 * (Android `LastSeenPrivacyPresenter.loadContacts`: direct, joined, exactly two joined members).
 */
export function presenceContacts(client: MatrixClient): PresenceContact[] {
    const me = client.getUserId();
    const byUser = new Map<string, PresenceContact>();
    for (const room of client.getRooms()) {
        if (room.getMyMembership() !== KnownMembership.Join || room.getJoinedMemberCount() !== 2) continue;
        const peerId = safeDmPeerId(room);
        if (!peerId || peerId === me || byUser.has(peerId) || !isPresenceContact(room, peerId)) continue;
        const member = room.getMember(peerId);
        const name = member?.rawDisplayName && member.rawDisplayName !== peerId ? member.rawDisplayName : null;
        byUser.set(peerId, { userId: peerId, name, room });
    }
    return [...byUser.values()].sort((a, b) =>
        (a.name ?? a.userId).toLowerCase().localeCompare((b.name ?? b.userId).toLowerCase()),
    );
}
