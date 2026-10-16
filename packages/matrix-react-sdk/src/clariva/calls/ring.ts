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

import { RING_CAP_MS, SENDER_TS_SANITY_MS } from "./constants";
import { type CallMediaType, wireIntentOf } from "./intent";

/**
 * Parsing of `org.matrix.msc4075.rtc.notification` and building/recognising `org.matrix.msc4310.rtc.decline`.
 * Port of Android's `CallNotificationEventResolver` + `ActiveCallManager.registerIncomingCall` timing rules
 * (spec 04 §3.8, §5.3, §5.4, §6.7). Pure: no Matrix SDK objects.
 */

/** What the parser needs from a Matrix event. */
export interface RtcNotificationInput {
    eventId: string;
    roomId: string;
    sender: string;
    /** `origin_server_ts`. */
    originTs: number;
    /**
     * The local time the event was created, estimated from the server's `age` (`MatrixEvent.localTimestamp`). Robust
     * against a skewed device clock; pass it when available.
     */
    localTs?: number;
    content: unknown;
}

export interface ParsedRing {
    ringEventId: string;
    roomId: string;
    senderId: string;
    /** From `m.call.intent` on the ring, `null` when the caller's EC did not say. */
    wireMedia: CallMediaType | null;
    /** The id of the sender's `call.member` state event (`m.relates_to`), when present. */
    membershipEventId: string | null;
    /** Local time (ms) after which this ring is over: `start + lifetime`, capped at `RING_CAP_MS` from `now`. */
    expiresAt: number;
    /** Milliseconds left at `now`. Always > 0 for a returned ring. */
    remainingMs: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * MSC4075 sanity rule: `sender_ts` is the sender's clock; trust it only when it is within ~20 s of the server's
 * `origin_server_ts`, otherwise fall back to the latter.
 */
export function effectiveSenderTs(senderTs: unknown, originTs: number): number {
    if (
        typeof senderTs === "number" &&
        Number.isFinite(senderTs) &&
        Math.abs(senderTs - originTs) <= SENDER_TS_SANITY_MS
    ) {
        return senderTs;
    }
    return originTs;
}

/**
 * `null` unless the event is a ring that should ring right now:
 *  - `notification_type` must be exactly `"ring"` (`"notification"` is the plain, silent variant),
 *  - it must have a positive `lifetime` (Android: no lifetime -> no expiry -> nothing to ring for),
 *  - and must not be over: `start + lifetime > now`, where `start` is the skew-corrected local creation time when
 *    known, else `sender_ts` (sanity-checked) — never a timer, background tabs throttle those.
 * The 90 s Android cap only matters for lifetimes longer than EC's own 30 s.
 */
export function parseRtcNotification(input: RtcNotificationInput, now: number): ParsedRing | null {
    const { content } = input;
    if (!isObject(content)) return null;
    if (content.notification_type !== "ring") return null;

    const lifetime = content.lifetime;
    if (typeof lifetime !== "number" || !Number.isFinite(lifetime) || lifetime <= 0) return null;

    const start = input.localTs ?? effectiveSenderTs(content.sender_ts, input.originTs);
    const remainingMs = Math.min(start + lifetime - now, RING_CAP_MS);
    if (remainingMs <= 0) return null;

    const relates = content["m.relates_to"];
    const membershipEventId =
        isObject(relates) && relates.rel_type === "m.reference" && typeof relates.event_id === "string"
            ? relates.event_id
            : null;

    return {
        ringEventId: input.eventId,
        roomId: input.roomId,
        senderId: input.sender,
        wireMedia: wireIntentOf(content),
        membershipEventId,
        expiresAt: now + remainingMs,
        remainingMs,
    };
}

/** Content of the decline event: exactly what js-sdk's newer `sendRtcDecline` and the Rust `declineCall` send. */
export function buildDeclineContent(ringEventId: string): {
    "m.relates_to": { rel_type: "m.reference"; event_id: string };
} {
    return { "m.relates_to": { rel_type: "m.reference", event_id: ringEventId } };
}

/** The ring event a decline refers to, or `null` for anything that is not a well-formed reference. */
export function declinedRingId(content: unknown): string | null {
    if (!isObject(content)) return null;
    const relates = content["m.relates_to"];
    if (!isObject(relates) || relates.rel_type !== "m.reference" || typeof relates.event_id !== "string") return null;
    return relates.event_id;
}
