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

import { useEffect, useReducer, useState } from "react";
import { type MatrixEvent, type Room, RoomEvent, RoomStateEvent } from "matrix-js-sdk/src/matrix";

import { useTypedEventEmitter } from "../../hooks/useEventEmitter";
import { useClarivaCallDmPeerId } from "../chat/useChatGate";
import { CALL_MEMBER_EVENT_TYPE, RTC_NOTIFICATION_EVENT_TYPE } from "./constants";
import { isClarivaCallsEnabled } from "./config";
import { type CallMediaType } from "./intent";
import { type LiveMembership, callMediaTypeOf, getRoomLiveMemberships, isUserInCall } from "./memberships";
import { getIncomingCalls } from "./registry";
import { type ActiveRing, IncomingCallsEvent } from "./incomingCalls";
import { isRingSoundBlocked, subscribeRingSoundBlocked } from "./callAudio";

/** Is this a 1:1 chat for which Clariva's call controls replace Element's (calls enabled + DM)? */
export function useClarivaDmCalls(room: Room | null | undefined): boolean {
    const enabled = isClarivaCallsEnabled();
    // no membership listeners at all while the calls feature is off: the header must stay exactly Element's
    const peerId = useClarivaCallDmPeerId(room, enabled);
    return enabled && peerId !== null;
}

export interface RoomCallState {
    memberships: readonly LiveMembership[];
    /** At least one live membership: a call is in progress. */
    hasOngoingCall: boolean;
    /** Some device of mine is in the call (this tab or another). */
    meInCall: boolean;
    peerInCall: boolean;
    /** The media type the call is held in (`m.call.intent`), `null` when the memberships do not say. */
    media: CallMediaType | null;
}

/**
 * Live call state of the room, re-read whenever a `call.member` state event arrives and again when the soonest
 * membership is due to expire (a dead tab's membership ages out even without any new event).
 */
export function useRoomCallState(room: Room | null, myUserId: string, peerId: string | null): RoomCallState {
    const [, rerender] = useReducer((n: number) => n + 1, 0);
    useTypedEventEmitter(room?.currentState, RoomStateEvent.Events, (ev: MatrixEvent) => {
        if (ev.getType() === CALL_MEMBER_EVENT_TYPE) rerender();
    });

    const memberships = room ? getRoomLiveMemberships(room) : [];
    const soonestExpiry = memberships.length > 0 ? Math.min(...memberships.map((m) => m.expiresAt)) : null;
    useEffect(() => {
        if (soonestExpiry === null) return;
        const timer = setTimeout(rerender, Math.min(Math.max(soonestExpiry - Date.now(), 0) + 1000, 2 ** 31 - 1));
        return () => clearTimeout(timer);
    }, [soonestExpiry]);

    return {
        memberships,
        hasOngoingCall: memberships.length > 0,
        meInCall: isUserInCall(memberships, myUserId),
        peerInCall: peerId !== null && isUserInCall(memberships, peerId),
        media: callMediaTypeOf(memberships),
    };
}

/** The newest `rtc.notification` event in the room's live timeline (Android: only that tile may show Join). */
export function latestCallStartedEventId(room: Room | null | undefined): string | undefined {
    if (!room) return undefined;
    const events = room.getLiveTimeline().getEvents();
    for (let i = events.length - 1; i >= 0; i--) {
        const id = events[i].getId();
        if (events[i].getType() === RTC_NOTIFICATION_EVENT_TYPE && id) return id;
    }
    return undefined;
}

/** `latestCallStartedEventId`, kept current as events arrive (including decryption and local-echo id changes). */
export function useLatestCallStartedEventId(room: Room | null | undefined): string | undefined {
    const [id, setId] = useState(() => latestCallStartedEventId(room));
    const update = (): void => setId(latestCallStartedEventId(room));
    useTypedEventEmitter(room ?? undefined, RoomEvent.Timeline, update);
    useTypedEventEmitter(room ?? undefined, RoomEvent.LocalEchoUpdated, update);
    useTypedEventEmitter(room ?? undefined, RoomEvent.TimelineReset, update);
    useEffect(() => setId(latestCallStartedEventId(room)), [room]);
    return id;
}

/** The rings currently ringing (for the toast components). */
export function useIncomingRings(): readonly ActiveRing[] {
    const [rings, setRings] = useState<readonly ActiveRing[]>(() => getIncomingCalls()?.rings ?? []);
    useEffect(() => {
        const manager = getIncomingCalls();
        if (!manager) return;
        setRings(manager.rings);
        manager.on(IncomingCallsEvent.Update, setRings);
        return () => {
            manager.off(IncomingCallsEvent.Update, setRings);
        };
    }, []);
    return rings;
}

/** Is the browser keeping the ringtone silent until the user interacts with the page (see `callAudio.ts`)? */
export function useRingSoundBlocked(): boolean {
    const [blocked, setBlocked] = useState(isRingSoundBlocked);
    useEffect(() => {
        setBlocked(isRingSoundBlocked()); // it may have changed between render and subscription
        return subscribeRingSoundBlocked(() => setBlocked(isRingSoundBlocked()));
    }, []);
    return blocked;
}
