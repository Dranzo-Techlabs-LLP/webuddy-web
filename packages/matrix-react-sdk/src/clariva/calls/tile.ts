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

import { type CallMediaType } from "./intent";

/**
 * Rules of the "Call started" timeline row (Android `TimelineItemCallNotifyView`, spec 04 §2.3 / §3.13). `roomCallState`
 * is a property of the ROOM, so without the "newest tile" rule every historical tile used to grow a Join button
 * (Android `9dea721c2d`).
 */
export interface TileState {
    /** This tile is the newest `rtc.notification` in the room's timeline. */
    isLatest: boolean;
    /** A call is in progress in the room (at least one live membership). */
    callOngoing: boolean;
    /** The chat is restricted (a client who cannot afford the consultant). */
    restricted: boolean;
    /** This tab is connected to the call already. */
    locallyConnected: boolean;
    /** The media type of the running call, when known. */
    media: CallMediaType | null;
}

/** Only the newest tile of a running call is "live"; every other tile is history. */
export function isLiveTile({ isLatest, callOngoing }: Pick<TileState, "isLatest" | "callOngoing">): boolean {
    return isLatest && callOngoing;
}

/**
 * What the right-hand side of the row shows: the Join button (live tile, not restricted, not already in the call), the
 * sent time (history), or nothing (live tile whose Join is hidden: Android leaves an empty slot, not the time).
 */
export function tileTrailing(state: TileState): "join" | "time" | "none" {
    if (!isLiveTile(state)) return "time";
    return state.restricted || state.locallyConnected ? "none" : "join";
}

/** The video icon needs the newest tile AND a running video call; history always shows the plain phone. */
export function tileShowsVideoIcon(state: TileState): boolean {
    return isLiveTile(state) && state.media === "video";
}
