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

import { RING_CAP_MS } from "../../src/clariva/calls/constants";
import {
    CLOCK_SKEW_SLACK_MS,
    type MembershipEventLike,
    callMediaTypeOf,
    hasUserJoinedSince,
    isUserInCall,
    parseLiveMemberships,
} from "../../src/clariva/calls/memberships";
import {
    buildDeclineContent,
    declinedRingId,
    effectiveSenderTs,
    parseRtcNotification,
} from "../../src/clariva/calls/ring";
import { CallerDeclineWatcher, peerDeclinedThisCall } from "../../src/clariva/calls/declineWatcher";

const NOW = 1_760_000_000_000;
const ROOM = "!dm:clarivahub.com";
const CALLER = "@rao:clarivahub.com";
const ME = "@asha:clarivahub.com";

function ring(content: Record<string, unknown>, extra: Partial<Parameters<typeof parseRtcNotification>[0]> = {}) {
    return parseRtcNotification(
        { eventId: "$ring", roomId: ROOM, sender: CALLER, originTs: NOW - 1000, content, ...extra },
        NOW,
    );
}

describe("parseRtcNotification (Android ring rules)", () => {
    const base = { notification_type: "ring", lifetime: 30_000, sender_ts: NOW - 1000 };

    it("returns a live 30 s ring with its remaining time", () => {
        const parsed = ring(base);
        expect(parsed).toMatchObject({
            ringEventId: "$ring",
            roomId: ROOM,
            senderId: CALLER,
            wireMedia: null,
            membershipEventId: null,
            remainingMs: 29_000,
            expiresAt: NOW + 29_000,
        });
    });

    it('only a notification_type of exactly "ring" rings ("notification" is the silent variant)', () => {
        expect(ring({ ...base, notification_type: "notification" })).toBeNull();
        expect(ring({ ...base, notification_type: undefined })).toBeNull();
        expect(ring({ ...base, notification_type: "RING" })).toBeNull();
    });

    it("needs a positive lifetime", () => {
        expect(ring({ ...base, lifetime: 0 })).toBeNull();
        expect(ring({ ...base, lifetime: -5 })).toBeNull();
        expect(ring({ ...base, lifetime: "30000" })).toBeNull();
        expect(ring({ notification_type: "ring", sender_ts: NOW })).toBeNull();
    });

    it("is over once start + lifetime has passed (decided on timestamps, not timers)", () => {
        expect(ring({ ...base, sender_ts: NOW - 29_999 }, { originTs: NOW - 29_999 })?.remainingMs).toBe(1);
        expect(ring({ ...base, sender_ts: NOW - 30_000 }, { originTs: NOW - 30_000 })).toBeNull();
        expect(ring({ ...base, sender_ts: NOW - 60_000 }, { originTs: NOW - 60_000 })).toBeNull();
    });

    it("caps the ring at 90 s like Android", () => {
        const parsed = ring({ ...base, lifetime: 600_000, sender_ts: NOW });
        expect(parsed?.remainingMs).toBe(RING_CAP_MS);
    });

    it("applies the MSC4075 sender_ts sanity rule", () => {
        expect(effectiveSenderTs(NOW, NOW + 19_000)).toBe(NOW); // close: trust the sender
        expect(effectiveSenderTs(NOW, NOW + 21_000)).toBe(NOW + 21_000); // skewed: use the server's
        expect(effectiveSenderTs(undefined, NOW)).toBe(NOW);
        expect(effectiveSenderTs("x", NOW)).toBe(NOW);
        // a sender clock 10 minutes in the past must not make a fresh ring look expired
        const skewed = ring({ ...base, sender_ts: NOW - 600_000 }, { originTs: NOW - 500 });
        expect(skewed?.remainingMs).toBe(29_500);
    });

    it("prefers the skew-corrected local creation time when the caller has it", () => {
        const parsed = ring(base, { localTs: NOW - 20_000 });
        expect(parsed?.remainingMs).toBe(10_000);
        expect(ring(base, { localTs: NOW - 31_000 })).toBeNull();
    });

    it("reads the on-wire media type and the membership reference", () => {
        const parsed = ring({
            ...base,
            "m.call.intent": "audio",
            "m.relates_to": { rel_type: "m.reference", event_id: "$member" },
        });
        expect(parsed?.wireMedia).toBe("voice");
        expect(parsed?.membershipEventId).toBe("$member");
        expect(ring({ ...base, "m.call.intent": "video" })?.wireMedia).toBe("video");
        // a relation that is not a reference is ignored
        expect(
            ring({ ...base, "m.relates_to": { rel_type: "m.thread", event_id: "$x" } })?.membershipEventId,
        ).toBeNull();
    });

    it("ignores non-object content", () => {
        expect(ring(null as any)).toBeNull();
        expect(ring("ring" as any)).toBeNull();
        expect(ring([] as any)).toBeNull();
    });
});

describe("decline event", () => {
    it("has exactly the content Android's declineCall / js-sdk sendRtcDecline send", () => {
        expect(buildDeclineContent("$ring")).toEqual({
            "m.relates_to": { rel_type: "m.reference", event_id: "$ring" },
        });
    });

    it("recognises the ring a decline refers to", () => {
        expect(declinedRingId(buildDeclineContent("$ring"))).toBe("$ring");
        expect(declinedRingId({})).toBeNull();
        expect(declinedRingId({ "m.relates_to": { rel_type: "m.thread", event_id: "$x" } })).toBeNull();
        expect(declinedRingId({ "m.relates_to": { rel_type: "m.reference" } })).toBeNull();
        expect(declinedRingId(undefined)).toBeNull();
    });
});

describe("parseLiveMemberships (EC 0.16.x session memberships)", () => {
    const membership = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
        application: "m.call",
        call_id: "",
        scope: "m.room",
        device_id: "DEV",
        expires: 7_200_000,
        focus_active: { type: "livekit", focus_selection: "oldest_membership" },
        foci_preferred: [{ type: "livekit", livekit_service_url: "https://rtc.example", livekit_alias: ROOM }],
        ...extra,
    });
    const event = (sender: string, content: Record<string, unknown>, originTs = NOW - 5000): MembershipEventLike => ({
        stateKey: `_${sender}_DEV_m.call`,
        sender,
        content,
        originTs,
    });

    it("accepts a fresh membership and reads its m.call.intent", () => {
        const [m] = parseLiveMemberships([event(CALLER, membership({ "m.call.intent": "audio" }))], NOW);
        expect(m).toMatchObject({ sender: CALLER, deviceId: "DEV", media: "voice", createdTs: NOW - 5000 });
        expect(m.expiresAt).toBe(NOW - 5000 + 7_200_000);
    });

    it("a leave (empty content) and malformed events are not memberships", () => {
        expect(parseLiveMemberships([event(CALLER, {})], NOW)).toEqual([]);
        expect(parseLiveMemberships([event(CALLER, { memberships: [] })], NOW)).toEqual([]); // legacy shape
        expect(parseLiveMemberships([event(CALLER, membership({ device_id: 5 }))], NOW)).toEqual([]);
        expect(parseLiveMemberships([event(CALLER, membership({ focus_active: "x" }))], NOW)).toEqual([]);
        expect(parseLiveMemberships([event(CALLER, membership({ call_id: "x" }))], NOW)).toEqual([]);
        expect(parseLiveMemberships([event(CALLER, membership({ scope: "m.user" }))], NOW)).toEqual([]);
        expect(parseLiveMemberships([{ ...event(CALLER, membership()), sender: undefined }], NOW)).toEqual([]);
    });

    it("ages a membership out at (created_ts ?? origin ts) + expires, the rule js-sdk 34.4 only applies to legacy ones", () => {
        const stale = event(CALLER, membership({ expires: 60_000 }), NOW - 61_000);
        expect(parseLiveMemberships([stale], NOW)).toEqual([]);
        // a refreshed membership: created_ts keeps the first join, expires grows
        const refreshed = event(CALLER, membership({ created_ts: NOW - 3_600_000, expires: 7_200_000 }), NOW - 1000);
        expect(parseLiveMemberships([refreshed], NOW)).toHaveLength(1);
        // no expires at all: EC's 4 h default
        const noExpiry = event(CALLER, membership({ expires: undefined }), NOW - 3 * 3_600_000);
        expect(parseLiveMemberships([noExpiry], NOW)).toHaveLength(1);
        const old = event(CALLER, membership({ expires: undefined }), NOW - 5 * 3_600_000);
        expect(parseLiveMemberships([old], NOW)).toEqual([]);
    });

    it("drops members who left the room and sorts oldest first", () => {
        const events = [event(ME, membership(), NOW - 1000), event(CALLER, membership(), NOW - 9000)];
        expect(parseLiveMemberships(events, NOW).map((m) => m.sender)).toEqual([CALLER, ME]);
        expect(parseLiveMemberships(events, NOW, (u) => u !== CALLER).map((m) => m.sender)).toEqual([ME]);
    });

    it("answers who is in the call and with which media", () => {
        const ms = parseLiveMemberships(
            [
                event(CALLER, membership({ "m.call.intent": "audio" })),
                event(ME, membership({ "m.call.intent": "audio" })),
            ],
            NOW,
        );
        expect(isUserInCall(ms, CALLER)).toBe(true);
        expect(isUserInCall(ms, "@x:clarivahub.com")).toBe(false);
        expect(callMediaTypeOf(ms)).toBe("voice");
        // EC rewrites the intent when the camera is switched on: any video wins
        const upgraded = parseLiveMemberships(
            [
                event(CALLER, membership({ "m.call.intent": "audio" })),
                event(ME, membership({ "m.call.intent": "video" })),
            ],
            NOW,
        );
        expect(callMediaTypeOf(upgraded)).toBe("video");
        expect(callMediaTypeOf(parseLiveMemberships([event(CALLER, membership())], NOW))).toBeNull();
        expect(callMediaTypeOf([])).toBeNull();
    });

    it("hasUserJoinedSince: a stale membership from before the call started is not an answer (spec 04 §7.2-9)", () => {
        const startedAt = NOW;
        const stale = parseLiveMemberships([event(CALLER, membership(), NOW - 600_000)], NOW);
        expect(hasUserJoinedSince(stale, CALLER, startedAt)).toBe(false);
        const answered = parseLiveMemberships([event(CALLER, membership(), NOW + 4_000)], NOW + 5_000);
        expect(hasUserJoinedSince(answered, CALLER, startedAt)).toBe(true);
        // device clocks differ a little: a membership a few seconds "before" the start still counts
        const skewed = parseLiveMemberships([event(CALLER, membership(), NOW - CLOCK_SKEW_SLACK_MS + 1)], NOW);
        expect(hasUserJoinedSince(skewed, CALLER, startedAt)).toBe(true);
        expect(hasUserJoinedSince(answered, ME, startedAt)).toBe(false);
    });
});

describe("caller-side decline rule (Android fc38a7a6a0)", () => {
    const base = {
        declinedRingId: "$new",
        declinerId: CALLER,
        myUserId: ME,
        baseline: new Set(["$old"]),
        ownRingIds: new Set(["$old", "$new"]),
    };

    it("a peer decline of THIS call's ring hangs up", () => {
        expect(peerDeclinedThisCall(base)).toBe(true);
    });

    it("never acts on a stale ring from an earlier call (it is in the baseline)", () => {
        expect(peerDeclinedThisCall({ ...base, declinedRingId: "$old" })).toBe(false);
    });

    it("ignores my own declines, malformed declines and rings that are not mine", () => {
        expect(peerDeclinedThisCall({ ...base, declinerId: ME })).toBe(false);
        expect(peerDeclinedThisCall({ ...base, declinedRingId: null })).toBe(false);
        expect(peerDeclinedThisCall({ ...base, declinedRingId: "$someone-elses" })).toBe(false);
    });

    it("the watcher hangs up once, and snapshots the baseline when constructed", () => {
        let own = new Set(["$old"]);
        const hangUp = jest.fn();
        const watcher = new CallerDeclineWatcher({ myUserId: () => ME, ownRingIds: () => own, hangUp });

        // EC sends this call's ring after the watcher was armed
        own = new Set(["$old", "$new"]);
        watcher.onDecline(CALLER, buildDeclineContent("$old")); // stale
        expect(hangUp).not.toHaveBeenCalled();
        watcher.onDecline(ME, buildDeclineContent("$new")); // echo of my own device
        expect(hangUp).not.toHaveBeenCalled();
        watcher.onDecline(CALLER, buildDeclineContent("$new"));
        watcher.onDecline(CALLER, buildDeclineContent("$new"));
        expect(hangUp).toHaveBeenCalledTimes(1);
        expect(watcher.hasTriggered).toBe(true);
    });

    it("a stopped watcher does nothing", () => {
        const hangUp = jest.fn();
        const watcher = new CallerDeclineWatcher({
            myUserId: () => ME,
            ownRingIds: () => new Set(["$new"]),
            hangUp,
        });
        watcher.stop();
        watcher.onDecline(CALLER, buildDeclineContent("$new"));
        expect(hangUp).not.toHaveBeenCalled();
    });
});
