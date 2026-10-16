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

import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { isClarivaEnabled } from "../../config";

/**
 * A message that is mounted within this long of arriving "arrived live". A room switch or a history load mounts events
 * that arrived a while ago (or, for history, whose age says they are old), so they never qualify.
 */
export const LIVE_ARRIVAL_WINDOW_MS = 3000;

/**
 * An event whose own timestamp is further than this from now is history even if it was only just delivered (a cached
 * sync, back-pagination).
 */
export const LIVE_TIMESTAMP_TOLERANCE_MS = 5 * 60_000;

export interface LiveArrivalFacts {
    now: number;
    /** `MatrixEvent.localTimestamp`: when the client received it (receipt time minus the event's `age`). */
    receivedAt: number;
    /** The sender's `origin_server_ts`. */
    ts: number;
    /** Is the tab visible right now? A message that lands in a background tab must not play a motion nobody sees. */
    visible: boolean;
    /**
     * Did I send it? My own messages never animate: sending is the most frequent thing a person does in a chat (frequency
     * decides motion, DESIGN-SYSTEM.md section 5), and the tile of a local echo is mounted a second time when the server
     * confirms it (its event id changes), which would replay the motion.
     */
    own?: boolean;
}

/**
 * Does this message arrive LIVE (the 140 ms `translateY(6px)` + fade of `_chatroom.pcss` applies) rather than as part of
 * a history load, a room switch or a background tab? Pure; see `isLiveEvent` for the wiring. "At the bottom" needs no
 * check of its own: a message that lands below the viewport of a user who scrolled up is mounted off screen, so its 140 ms
 * is over before anybody can see it.
 */
export function isLiveArrival({ now, receivedAt, ts, visible, own = false }: LiveArrivalFacts): boolean {
    if (!visible || own) return false;
    if (now - receivedAt > LIVE_ARRIVAL_WINDOW_MS) return false;
    if (Math.abs(now - ts) > LIVE_TIMESTAMP_TOLERANCE_MS) return false;
    return true;
}

/** `isLiveArrival` for an event being mounted into the timeline right now. Always `false` outside Clariva. */
export function isLiveEvent(mxEvent: MatrixEvent): boolean {
    if (!isClarivaEnabled() || typeof document === "undefined") return false;
    const me = MatrixClientPeg.get()?.getUserId();
    return isLiveArrival({
        now: Date.now(),
        receivedAt: mxEvent.localTimestamp,
        ts: mxEvent.getTs(),
        visible: document.visibilityState === "visible",
        own: !!me && mxEvent.getSender() === me,
    });
}
