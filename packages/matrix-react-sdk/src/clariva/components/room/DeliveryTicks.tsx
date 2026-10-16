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

import React, { useEffect, useState } from "react";
import { EventStatus, type MatrixEvent, type Room, RoomEvent } from "matrix-js-sdk/src/matrix";

import { roomStrings } from "../../strings/room";

export type DeliveryState = "sending" | "sent" | "read" | "failed";

/**
 * One `Room.receipt` listener per room, however many own messages are on screen: a long timeline has dozens of tiles and
 * `Room` only tolerates a hundred listeners before warning.
 */
const hubs = new WeakMap<Room, { listeners: Set<() => void>; handler: () => void }>();

export function subscribeRoomReceipts(room: Room, listener: () => void): () => void {
    let hub = hubs.get(room);
    if (!hub) {
        const listeners = new Set<() => void>();
        const handler = (): void => listeners.forEach((l) => l());
        room.on(RoomEvent.Receipt, handler);
        hub = { listeners, handler };
        hubs.set(room, hub);
    }
    const mine = hub;
    mine.listeners.add(listener);
    return () => {
        mine.listeners.delete(listener);
        if (mine.listeners.size === 0) {
            room.off(RoomEvent.Receipt, mine.handler);
            if (hubs.get(room) === mine) hubs.delete(room);
        }
    };
}

/** Has anybody other than me read up to (or past) this event? */
export function isReadByOthers(room: Room, mxEvent: MatrixEvent): boolean {
    const eventId = mxEvent.getId();
    if (!eventId) return false;
    const me = room.client.getUserId();
    return room.getJoinedMembers().some((m) => m.userId !== me && room.hasUserReadEvent(m.userId, eventId));
}

/** The delivery state of one of my own messages. Pure; `read` is `isReadByOthers`. */
export function deliveryStateOf(sendStatus: string | null | undefined, read: boolean): DeliveryState {
    if (sendStatus === EventStatus.NOT_SENT) return "failed";
    if (sendStatus && sendStatus !== EventStatus.SENT) return "sending"; // sending, queued, encrypting
    return read ? "read" : "sent";
}

/** `read` for one of my own messages, kept up to date; once read it stays read and listens to nothing more. */
export function useReadByOthers(room: Room, mxEvent: MatrixEvent, enabled = true): boolean {
    const [read, setRead] = useState(() => enabled && isReadByOthers(room, mxEvent));
    useEffect(() => {
        if (!enabled || read) return;
        const check = (): void => setRead(isReadByOthers(room, mxEvent));
        check(); // a receipt may have arrived between render and subscription
        return subscribeRoomReceipts(room, check);
    }, [room, mxEvent, enabled, read]);
    return read;
}

const LABELS: Record<DeliveryState, string> = {
    sending: roomStrings.tickSending,
    sent: roomStrings.tickSent,
    read: roomStrings.tickRead,
    failed: roomStrings.tickFailed,
};

interface Props {
    room: Room;
    mxEvent: MatrixEvent;
    /** `mxEvent.getAssociatedStatus()` (the tile already tracks it as `eventSendStatus`). */
    sendStatus?: string;
}

/**
 * The delivery glyph next to the time of one of my own messages: a clock while it is being sent, one check once sent,
 * two checks (and the accent colour) once somebody has read it, an exclamation mark if it failed. The shape differs per
 * state so the colour is never the only carrier. Inline SVG, `currentColor`; positions and colours: `_chatroom.pcss`.
 */
export function ClarivaDeliveryTicks({ room, mxEvent, sendStatus }: Props): JSX.Element {
    const read = useReadByOthers(room, mxEvent, !sendStatus || sendStatus === EventStatus.SENT);
    const state = deliveryStateOf(sendStatus, read);
    return (
        <span className="mx_ClarivaTicks" data-state={state} role="img" aria-label={LABELS[state]}>
            <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
            >
                {state === "sending" && (
                    <>
                        <circle cx="8" cy="8" r="5.4" />
                        <path d="M8 5.2V8l1.9 1.2" />
                    </>
                )}
                {state === "sent" && <path d="m3.6 8.6 2.9 2.9 6-6.6" />}
                {state === "read" && (
                    <>
                        <path d="m1.7 8.6 2.9 2.9 5.9-6.6" />
                        <path d="m7.6 11.1.4.4 6-6.6" />
                    </>
                )}
                {state === "failed" && (
                    <>
                        <circle cx="8" cy="8" r="5.4" />
                        <path d="M8 5.2v3.3M8 10.6v.1" />
                    </>
                )}
            </svg>
        </span>
    );
}
