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

import { EventType, type Room } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";

import DMRoomMap from "../../utils/DMRoomMap";
import { isLocalRoom } from "../../utils/localRoom/isLocalRoom";
import { type LocalRoom } from "../../models/LocalRoom";

/**
 * The "other party" of a 1:1 chat, or `null` when the room is not a DM (groups, spaces, 3+ active members, a DM the
 * peer already left, or while members are still loading). Port of Android's `isDm` + `getDirectRoomMember`
 * (spec 03 §3.2 / §3.10): a direct room with at most two ACTIVE (joined or invited) members; the peer is the other
 * active member. An invited-but-not-joined peer already counts, so billing applies from the very first message.
 *
 * Also works for a not-yet-created DM (Element's `LocalRoom`, whose id starts with `local+`): the peer is the
 * single target. NEVER send a local room id to the Wallet-API — only user ids.
 *
 * Direct-chat detection relies on the `m.direct` account data (and the `is_direct` invite hint) via DMRoomMap.
 * Android-created DMs set both (verify in a real session: a false negative silently disables gating, i.e. fails open).
 *
 * This is the helper of everything that BILLS or GATES: the chat gate, send billing, refunds and the chats list. It
 * never guesses; a room `m.direct` does not list is not a DM here. CALLS use `getClarivaCallDmPeerId` instead.
 * It throws while `DMRoomMap` is not started yet; callers go through `safeDmPeerId` (or catch) and treat that as
 * "no peer".
 */
export function getClarivaDmPeerId(room: Room | null | undefined, myUserId?: string): string | null {
    if (!room) return null;
    const me = myUserId ?? room.myUserId;

    if (isLocalRoom(room)) {
        const target = (room as LocalRoom).targets?.[0];
        return target && target.userId !== me ? target.userId : null;
    }

    const directPeer = DMRoomMap.shared().getUserIdForRoomId(room.roomId);
    if (!directPeer || directPeer === me) return null;
    return activeDirectPeer(room, directPeer);
}

/**
 * `getClarivaDmPeerId` for CALLS only: the call controls and their restriction, the incoming ring, the call widget's
 * intent, `Notifier`'s legacy "call notify" suppression and the outgoing call (and its billing watcher) all decide
 * "is this a 1:1 call?" with this one helper, so the controls, the ring and the legacy toast cannot disagree.
 *
 * When `m.direct` says NOTHING about the room (not loaded yet this session, the invitee's client never recorded the DM,
 * or `DMRoomMap` is not started yet) `implicitDmPeerId` takes over, so an incoming call in such a chat still rings.
 * That guess is deliberately NOT in `getClarivaDmPeerId`: an unlisted two-person private room must not be billed like a
 * DM (Android bills real DMs only). Never throws because of `DMRoomMap`.
 */
export function getClarivaCallDmPeerId(room: Room | null | undefined, myUserId?: string): string | null {
    if (!room) return null;
    const me = myUserId ?? room.myUserId;
    if (isLocalRoom(room)) return getClarivaDmPeerId(room, me);

    const directPeer = mDirectPeerOf(room.roomId);
    if (!directPeer) return implicitDmPeerId(room, me); // `m.direct` has no entry for this room
    if (directPeer === me) return null;
    return activeDirectPeer(room, directPeer);
}

/** `directPeer` (listed by `m.direct`) if the room still looks like a 1:1 chat with it, else `null`. */
function activeDirectPeer(room: Room, directPeer: string): string | null {
    if (room.getInvitedAndJoinedMemberCount() > 2) return null;

    // Android compares against active members: the peer must still be joined or invited.
    const member = room.getMember(directPeer);
    if (member && member.membership !== "join" && member.membership !== "invite") return null;
    return directPeer;
}

/** `m.direct` (+ the invite's `is_direct` hint) peer of the room; `undefined` when it has none or cannot be read yet. */
function mDirectPeerOf(roomId: string): string | undefined {
    try {
        return DMRoomMap.shared().getUserIdForRoomId(roomId) ?? undefined;
    } catch {
        return undefined; // DMRoomMap is not started yet: same as "m.direct says nothing"
    }
}

/**
 * The peer of a room that `m.direct` does not mention: exactly two ACTIVE members, me (joined) and one other (joined or
 * invited), in a room that is not a space and has no explicit name. Android creates DMs unnamed, so a named two-person
 * room is a small group, not a 1:1 chat. Anything doubtful (members not loaded, someone else in the room) is `null`.
 */
function implicitDmPeerId(room: Room, me: string): string | null {
    if (room.getMyMembership() !== KnownMembership.Join) return null;
    if (room.getInvitedAndJoinedMemberCount() !== 2) return null;
    if (room.isSpaceRoom()) return null;
    if (room.currentState.getStateEvents(EventType.RoomName, "")?.getContent()?.name) return null;

    const others = [
        ...room.getMembersWithMembership(KnownMembership.Join),
        ...room.getMembersWithMembership(KnownMembership.Invite),
    ].filter((member) => member.userId !== me);
    return others.length === 1 ? others[0].userId : null;
}
