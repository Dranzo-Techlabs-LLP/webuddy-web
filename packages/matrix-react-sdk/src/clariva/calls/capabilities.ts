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

import { EventDirection, MatrixCapabilities, WidgetEventCapability } from "matrix-widget-api";

import {
    CALL_ENCRYPTION_KEYS_EVENT_TYPE,
    CALL_MEMBER_EVENT_TYPE,
    CALL_NOTIFY_EVENT_TYPE,
    CALL_REACTION_EVENT_TYPE,
    RAGESHAKE_REQUEST_EVENT_TYPE,
    RTC_DECLINE_EVENT_TYPE,
    RTC_NOTIFICATION_EVENT_TYPE,
} from "./constants";

/**
 * The widget capabilities Element Call **0.16.3** requests from its host (`src/widget.ts` of EC, recovered from the
 * source map of the build the Android app bundles; spec 04 §5.6). Element Web 3.108 pre-approves a smaller, older list
 * for its trusted EC origin, so without this the user gets a permission prompt and, if they decline, EC cannot publish
 * its membership / ring / decline (and `ElementCall.performConnection` waits for the membership forever).
 *
 * Built with the same `widget-api` helpers EC itself uses, so the strings are identical by construction.
 */

/** Room events EC only sends. */
const SEND_ROOM_EVENTS = [CALL_NOTIFY_EVENT_TYPE, RTC_NOTIFICATION_EVENT_TYPE];

/** Room events EC sends and receives. */
const SEND_RECEIVE_ROOM_EVENTS = [
    RAGESHAKE_REQUEST_EVENT_TYPE,
    CALL_ENCRYPTION_KEYS_EVENT_TYPE,
    "m.reaction",
    "m.room.redaction",
    CALL_REACTION_EVENT_TYPE,
    RTC_DECLINE_EVENT_TYPE,
];

/** State events EC reads (any state key). */
const RECEIVE_STATE_EVENTS = [
    "m.room.create",
    "m.room.name",
    "m.room.member",
    "m.room.encryption",
    CALL_MEMBER_EVENT_TYPE,
];

/** To-device events EC sends and receives (the ten legacy `m.call.*` types plus the key transport). */
const SEND_RECEIVE_TO_DEVICE_EVENTS = [
    "m.call.invite",
    "m.call.candidates",
    "m.call.answer",
    "m.call.hangup",
    "m.call.reject",
    "m.call.select_answer",
    "m.call.negotiate",
    "m.call.sdp_stream_metadata_changed",
    "org.matrix.call.sdp_stream_metadata_changed",
    "m.call.replaces",
    CALL_ENCRYPTION_KEYS_EVENT_TYPE,
];

export interface ElementCallCapabilityContext {
    /** The signed-in Matrix user id (`@me:clarivahub.com`). */
    userId: string;
    /** The signed-in device id; without it only the legacy user-keyed membership state key can be approved. */
    deviceId: string | null;
    /** The room the call widget lives in (the timeline capability is per room). */
    roomId?: string;
}

/** The three state keys EC publishes its membership under (legacy, session, session without the leading underscore). */
export function membershipStateKeys(userId: string, deviceId: string | null): string[] {
    const keys = [userId];
    if (deviceId) {
        keys.push(`_${userId}_${deviceId}_m.call`, `${userId}_${deviceId}_m.call`);
    }
    return keys;
}

/**
 * Every capability string the Clariva host approves for the trusted Element Call widget, as a de-duplicated array.
 * The caller adds them to `StopGapWidgetDriver.allowedCapabilities`; the driver then answers
 * `validateCapabilities(requested)` with the intersection, so asking for more than EC requests is harmless.
 */
export function getElementCallCapabilities({ userId, deviceId, roomId }: ElementCallCapabilityContext): string[] {
    const caps = new Set<string>();

    caps.add(MatrixCapabilities.AlwaysOnScreen);
    // MSC4157 delayed events: the MSC4140 "delayed leave" that makes a crashed tab drop out of the call within ~90 s.
    caps.add(MatrixCapabilities.MSC4157SendDelayedEvent);
    caps.add(MatrixCapabilities.MSC4157UpdateDelayedEvent);
    // EC 0.16.3 sends `turnServers: false`; harmless to allow (LiveKit handles ICE), and EC falls back to the browser.
    caps.add(MatrixCapabilities.MSC3846TurnServers);
    if (roomId) caps.add(`org.matrix.msc2762.timeline:${roomId}`);

    for (const eventType of SEND_ROOM_EVENTS) {
        caps.add(WidgetEventCapability.forRoomEvent(EventDirection.Send, eventType).raw);
    }
    for (const eventType of SEND_RECEIVE_ROOM_EVENTS) {
        caps.add(WidgetEventCapability.forRoomEvent(EventDirection.Send, eventType).raw);
        caps.add(WidgetEventCapability.forRoomEvent(EventDirection.Receive, eventType).raw);
    }

    for (const stateKey of membershipStateKeys(userId, deviceId)) {
        caps.add(WidgetEventCapability.forStateEvent(EventDirection.Send, CALL_MEMBER_EVENT_TYPE, stateKey).raw);
    }
    for (const eventType of RECEIVE_STATE_EVENTS) {
        caps.add(WidgetEventCapability.forStateEvent(EventDirection.Receive, eventType).raw);
    }
    // Element Web's own group-call state event; EC 0.16.3 does not request it but older builds read it.
    caps.add(WidgetEventCapability.forStateEvent(EventDirection.Receive, "org.matrix.msc3401.call").raw);

    for (const eventType of SEND_RECEIVE_TO_DEVICE_EVENTS) {
        caps.add(WidgetEventCapability.forToDeviceEvent(EventDirection.Send, eventType).raw);
        caps.add(WidgetEventCapability.forToDeviceEvent(EventDirection.Receive, eventType).raw);
    }

    return [...caps];
}
