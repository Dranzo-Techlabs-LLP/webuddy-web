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

import { useCallback, useState } from "react";
import { type Room, type User, UserEvent } from "matrix-js-sdk/src/matrix";

import { isPresenceEnabled } from "../../../utils/presence";
import { formatDuration } from "../../../DateUtils";
import { getJoinedNonFunctionalMembers } from "../../../utils/room/getJoinedNonFunctionalMembers";
import { BUSY_PRESENCE_NAME } from "../../../components/views/rooms/PresenceLabel";
import { useEventEmitter } from "../../../hooks/useEventEmitter";
import { useClarivaDmPeerId } from "../../chat/useChatGate";
import { roomStrings } from "../../strings/room";

export type PresenceState = "online" | "away" | "busy" | "offline";

export interface PeerPresence {
    state: PresenceState;
    /** When the peer was last active (ms since the epoch), `null` when the server does not say. */
    lastActiveTs: number | null;
}

/** The stock `WithPresenceIndicator` rules (busy, then online / currently active, then offline, then away). */
export function presenceStateOf(
    user: Pick<User, "presence" | "currentlyActive"> | null | undefined,
): PresenceState | null {
    if (!user) return null;
    if (BUSY_PRESENCE_NAME.matches(user.presence)) return "busy";
    if (user.currentlyActive || user.presence === "online") return "online";
    if (user.presence === "offline") return "offline";
    if (user.presence === "unavailable") return "away";
    return null;
}

/** The short line under the room name: "Online", "Away", "Busy", "Last seen 5m ago", "Offline". */
export function presenceLabel(presence: PeerPresence, now: number): string {
    switch (presence.state) {
        case "online":
            return roomStrings.presenceOnline;
        case "away":
            return roomStrings.presenceAway;
        case "busy":
            return roomStrings.presenceBusy;
        case "offline": {
            const ago = presence.lastActiveTs === null ? 0 : now - presence.lastActiveTs;
            return ago > 0 ? roomStrings.presenceLastSeen(formatDuration(ago)) : roomStrings.presenceOffline;
        }
    }
}

function lastActiveTsOf(user: User): number | null {
    try {
        const ts = user.getLastActiveTs();
        return Number.isFinite(ts) && ts > 0 ? ts : null;
    } catch {
        return null;
    }
}

/**
 * Presence of the other party of a 1:1 chat, or `null` when it is not shared: not a two-person room, the homeserver has
 * presence switched off (`enable_presence_by_hs_url`, which is how the Clariva homeserver is configured), or the user is
 * not known yet. The room header and the avatar ring simply show nothing in that case.
 */
export function usePeerPresence(room: Room): PeerPresence | null {
    const peerId = useClarivaDmPeerId(room, false); // `null` when Clariva is off or the room is not a 1:1 chat
    const user = (peerId ? room.getMember(peerId)?.user : null) ?? null;
    const [, setTick] = useState(0);
    const rerender = useCallback(() => setTick((n) => n + 1), []);
    useEventEmitter(user ?? undefined, UserEvent.Presence, rerender);
    useEventEmitter(user ?? undefined, UserEvent.CurrentlyActive, rerender);

    if (!user || !isPresenceEnabled(room.client)) return null;
    if (getJoinedNonFunctionalMembers(room).length !== 2) return null;
    const state = presenceStateOf(user);
    return state ? { state, lastActiveTs: lastActiveTsOf(user) } : null;
}
