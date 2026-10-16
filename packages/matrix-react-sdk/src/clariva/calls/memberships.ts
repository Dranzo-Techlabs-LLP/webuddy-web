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

import { CALL_MEMBER_EVENT_TYPE, DEFAULT_MEMBERSHIP_EXPIRY_MS } from "./constants";
import { type CallMediaType, wireIntentOf } from "./intent";

/**
 * Who is really in the call, from the `org.matrix.msc3401.call.member` room state.
 *
 * Why not just `MatrixRTCSession.memberships`? matrix-js-sdk 34.4 parses Element Call 0.16.x's session-shaped
 * memberships, but it can only EXPIRE legacy ones (`CallMembership.isExpired`): a membership left behind by a crashed
 * tab counts as "in the call" until its delayed-leave event fires (or forever if the homeserver has no MSC4140).
 * EC 0.16.3 itself ages a membership out at `(created_ts ?? origin_server_ts) + (expires ?? 4 h)`; this module applies
 * the same rule. It is used for "did the peer answer" (billing) and for the Join controls.
 */

/** The little the predicate needs from a state event, so tests do not need real `MatrixEvent`s. */
export interface MembershipEventLike {
    stateKey: string | undefined;
    sender: string | undefined;
    content: Record<string, unknown>;
    /** `origin_server_ts` of the state event. */
    originTs: number;
}

export interface LiveMembership {
    sender: string;
    deviceId: string;
    stateKey: string;
    /** `created_ts`, or the event's `origin_server_ts` for the first send. Server time. */
    createdTs: number;
    expiresAt: number;
    /** From `m.call.intent` (`audio` -> voice), `null` when the membership does not say. */
    media: CallMediaType | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The live room-scoped memberships among `events`, oldest first. A membership is:
 *  - session-shaped (`focus_active` object + string `device_id`; EC 0.16.x does not write the legacy array form),
 *  - for the room call (`call_id === ""`, `scope === "m.room"`: the same filter js-sdk applies),
 *  - not left (a leave is an empty content `{}`),
 *  - not expired,
 *  - and, when `isJoined` is given, sent by someone who is still joined to the room.
 */
export function parseLiveMemberships(
    events: readonly MembershipEventLike[],
    now: number,
    isJoined?: (userId: string) => boolean,
): LiveMembership[] {
    const live: LiveMembership[] = [];
    for (const ev of events) {
        const { content } = ev;
        if (!ev.sender || ev.stateKey === undefined || !isObject(content) || Object.keys(content).length === 0)
            continue;
        if (!isObject(content.focus_active) || typeof content.device_id !== "string") continue;
        if (content.call_id !== "" || content.scope !== "m.room") continue;
        if (isJoined && !isJoined(ev.sender)) continue;

        const createdTs = typeof content.created_ts === "number" ? content.created_ts : ev.originTs;
        const expires =
            typeof content.expires === "number" && content.expires > 0 ? content.expires : DEFAULT_MEMBERSHIP_EXPIRY_MS;
        const expiresAt = createdTs + expires;
        if (expiresAt <= now) continue;

        live.push({
            sender: ev.sender,
            deviceId: content.device_id,
            stateKey: ev.stateKey,
            createdTs,
            expiresAt,
            media: wireIntentOf(content),
        });
    }
    return live.sort((a, b) => a.createdTs - b.createdTs);
}

/** Is any device of `userId` in the call? */
export function isUserInCall(memberships: readonly LiveMembership[], userId: string): boolean {
    return memberships.some((m) => m.sender === userId);
}

/**
 * The media type the call is currently being held in, from the memberships' `m.call.intent`: video if any member
 * has the camera intent (EC rewrites a membership's intent whenever the camera is toggled), voice if all that say
 * anything say audio, `null` if nobody says.
 */
export function callMediaTypeOf(memberships: readonly LiveMembership[]): CallMediaType | null {
    let voice = false;
    for (const m of memberships) {
        if (m.media === "video") return "video";
        if (m.media === "voice") voice = true;
    }
    return voice ? "voice" : null;
}

/** Slack for the difference between this device's clock and the homeserver's when comparing against a local time. */
export const CLOCK_SKEW_SLACK_MS = 15_000;

/**
 * Did `peerId` join the call after `sinceMs` (local time of "I started")? Used when WE start the call so that a stale
 * membership of the peer left over from an earlier call cannot count as "answered" (spec 04 §7.2-9).
 */
export function hasUserJoinedSince(
    memberships: readonly LiveMembership[],
    userId: string,
    sinceMs: number,
    slackMs: number = CLOCK_SKEW_SLACK_MS,
): boolean {
    return memberships.some((m) => m.sender === userId && m.createdTs >= sinceMs - slackMs);
}

/**
 * Is `userId` in the call with a membership that can be an answer to a ring sent at `ringTs` (server time)? Used for
 * "another device of mine already answered": a membership counts only if it is still live at `nowMs` AND was created
 * at (or, give or take clock skew, after) the ring. One created before the ring cannot be an answer to it — EC only
 * rings from an empty call, so it is what a crashed tab left behind until its delayed leave fires (up to 90 s, or the
 * membership's whole expiry when the homeserver has no delayed events) and must not silence a real ring.
 */
export function isUserAnsweringRing(
    memberships: readonly LiveMembership[],
    userId: string,
    ringTs: number,
    nowMs: number,
    slackMs: number = CLOCK_SKEW_SLACK_MS,
): boolean {
    return memberships.some((m) => m.sender === userId && m.expiresAt > nowMs && m.createdTs >= ringTs - slackMs);
}

/** `getStateEvents` of the call-member type, as plain data. */
export function readMembershipEvents(room: Room): MembershipEventLike[] {
    return room.currentState.getStateEvents(CALL_MEMBER_EVENT_TYPE).map((ev) => ({
        stateKey: ev.getStateKey(),
        sender: ev.getSender(),
        content: ev.getContent() as Record<string, unknown>,
        originTs: ev.getTs(),
    }));
}

/** Live memberships of `room` right now. */
export function getRoomLiveMemberships(room: Room, now: number = Date.now()): LiveMembership[] {
    return parseLiveMemberships(readMembershipEvents(room), now, (userId) => {
        const membership = room.getMember(userId)?.membership;
        // Members that are not loaded yet are given the benefit of the doubt: the state event itself proves presence.
        return membership === undefined || membership === "join";
    });
}

/** Does the room have a call in progress (at least one live membership)? */
export function roomHasLiveCall(room: Room, now: number = Date.now()): boolean {
    return getRoomLiveMemberships(room, now).length > 0;
}

/** Is the call in progress in `room` a VOICE call (every live member says audio)? False for video, unknown and no call. */
export function isVoiceCallInRoom(room: Room | null | undefined, now: number = Date.now()): boolean {
    return !!room && callMediaTypeOf(getRoomLiveMemberships(room, now)) === "voice";
}
