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

import {
    type ActiveRing,
    IncomingCallsEvent,
    type IncomingCallsHost,
    IncomingCallsManager,
    type RingEndReason,
} from "../../src/clariva/calls/incomingCalls";
import { type CallMediaType } from "../../src/clariva/calls/intent";
import { type LiveMembership } from "../../src/clariva/calls/memberships";
import { type RtcNotificationInput } from "../../src/clariva/calls/ring";

const ME = "@asha:clarivahub.com";
const CALLER = "@rao:clarivahub.com";
const ROOM = "!dm:clarivahub.com";

const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
};

const membershipOf = (sender: string, ageMs = 0): LiveMembership => ({
    sender,
    deviceId: "DEV",
    stateKey: `_${sender}_DEV_m.call`,
    createdTs: Date.now() - ageMs,
    expiresAt: Date.now() - ageMs + 7_200_000,
    media: null,
});

interface Harness {
    host: jest.Mocked<IncomingCallsHost>;
    manager: IncomingCallsManager;
    /** Who is in the call, mutable. */
    members: LiveMembership[];
    hidden: Array<[string, RingEndReason]>;
}

function harness(overrides: Partial<IncomingCallsHost> = {}): Harness {
    const h: Harness = { members: [membershipOf(CALLER)], hidden: [] } as unknown as Harness;
    h.host = {
        now: jest.fn(() => Date.now()),
        myUserId: jest.fn(() => ME),
        dmPeerOf: jest.fn((roomId: string) => (roomId === ROOM ? CALLER : null)),
        liveMemberships: jest.fn(() => h.members),
        waitForMembership: jest.fn(async (_room: string, user: string) => h.members.some((m) => m.sender === user)),
        fetchCallType: jest.fn(async (): Promise<CallMediaType | null> => null),
        isBusy: jest.fn(() => false),
        sendDecline: jest.fn(async () => undefined),
        joinCall: jest.fn(async () => undefined),
        showRing: jest.fn(),
        hideRing: jest.fn((ring: ActiveRing, reason: RingEndReason) => {
            h.hidden.push([ring.ringEventId, reason]);
        }),
        startRingtone: jest.fn(),
        stopRingtone: jest.fn(),
        notifyMissed: jest.fn(),
        joinFailed: jest.fn(),
        ...overrides,
    } as jest.Mocked<IncomingCallsHost>;
    h.manager = new IncomingCallsManager(h.host);
    return h;
}

const ringInput = (
    extra: Partial<RtcNotificationInput> = {},
    content: Record<string, unknown> = {},
): RtcNotificationInput => ({
    eventId: "$ring1",
    roomId: ROOM,
    sender: CALLER,
    originTs: Date.now() - 500,
    content: { notification_type: "ring", lifetime: 30_000, sender_ts: Date.now() - 500, ...content },
    ...extra,
});

describe("IncomingCallsManager", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(1_760_000_000_000);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe("ringing", () => {
        it("rings for a live ring in a DM: toast, ringtone, voice by default", async () => {
            const h = harness();
            const updates = jest.fn();
            h.manager.on(IncomingCallsEvent.Update, updates);

            const ring = await h.manager.handleRing(ringInput());
            expect(ring).toMatchObject({ ringEventId: "$ring1", roomId: ROOM, senderId: CALLER, mediaType: "voice" });
            expect(h.host.showRing).toHaveBeenCalledWith(ring);
            expect(h.host.startRingtone).toHaveBeenCalledTimes(1);
            expect(h.manager.rings).toEqual([ring]);
            expect(updates).toHaveBeenCalledWith([ring]);
            // 29.5 s left of the 30 s lifetime
            expect(ring!.expiresAt).toBe(Date.now() + 29_500);
        });

        it("takes the media type from the caller's EC (m.call.intent) without asking the Wallet-API", async () => {
            const h = harness();
            const ring = await h.manager.handleRing(ringInput({}, { "m.call.intent": "video" }));
            expect(ring?.mediaType).toBe("video");
            expect(h.host.fetchCallType).not.toHaveBeenCalled();
        });

        it("falls back to the Wallet record, then to voice", async () => {
            const withRecord = harness({ fetchCallType: jest.fn(async () => "video" as CallMediaType) });
            expect((await withRecord.manager.handleRing(ringInput()))?.mediaType).toBe("video");
            expect(withRecord.host.fetchCallType).toHaveBeenCalledWith(ROOM);

            const unknown = harness({ fetchCallType: jest.fn(async () => null) });
            expect((await unknown.manager.handleRing(ringInput()))?.mediaType).toBe("voice");
        });

        it("ignores my own ring, groups, plain notifications and rings that are already over", async () => {
            const h = harness();
            expect(await h.manager.handleRing(ringInput({ sender: ME }))).toBeNull();
            expect(await h.manager.handleRing(ringInput({ roomId: "!group:clarivahub.com" }))).toBeNull();
            expect(await h.manager.handleRing(ringInput({}, { notification_type: "notification" }))).toBeNull();
            expect(
                await h.manager.handleRing(
                    ringInput({ originTs: Date.now() - 40_000 }, { sender_ts: Date.now() - 40_000 }),
                ),
            ).toBeNull();
            expect(h.host.showRing).not.toHaveBeenCalled();
            expect(h.host.startRingtone).not.toHaveBeenCalled();
        });

        it("does not ring for a call that is already over (the caller has no membership after 3 s)", async () => {
            const h = harness();
            h.members = [];
            expect(await h.manager.handleRing(ringInput())).toBeNull();
            expect(h.host.waitForMembership).toHaveBeenCalledWith(ROOM, CALLER, 3_000);
            expect(h.host.showRing).not.toHaveBeenCalled();
            expect(h.host.startRingtone).not.toHaveBeenCalled();
        });

        it("a ring whose caller never shows up in the call is a missed call, not a silent drop", async () => {
            const h = harness();
            h.members = [];
            expect(await h.manager.handleRing(ringInput())).toBeNull();
            expect(h.host.notifyMissed).toHaveBeenCalledTimes(1);
            expect(h.host.notifyMissed).toHaveBeenCalledWith({ roomId: ROOM, senderId: CALLER });
            expect(h.manager.rings).toEqual([]);
        });

        it("a ring that was declined elsewhere while waiting for the caller leaves no missed-call trace", async () => {
            let release: (v: boolean) => void = () => undefined;
            const h = harness({ waitForMembership: jest.fn(() => new Promise<boolean>((r) => (release = r))) });
            h.members = [];
            const pending = h.manager.handleRing(ringInput());
            await settle();
            h.manager.onDecline("$ring1", ME);
            release(false);
            await expect(pending).resolves.toBeNull();
            expect(h.host.notifyMissed).not.toHaveBeenCalled();
        });

        it("a ring while I am busy in another call is a missed call, never a second ring", async () => {
            const h = harness({ isBusy: jest.fn(() => true) });
            expect(await h.manager.handleRing(ringInput())).toBeNull();
            expect(h.host.notifyMissed).toHaveBeenCalledWith({ roomId: ROOM, senderId: CALLER });
            expect(h.host.showRing).not.toHaveBeenCalled();
        });

        it("does not ring when another device of mine is already in the call", async () => {
            const h = harness();
            h.members = [membershipOf(CALLER), membershipOf(ME)];
            expect(await h.manager.handleRing(ringInput())).toBeNull();
            expect(h.host.showRing).not.toHaveBeenCalled();
        });

        it("a membership of mine that a crashed tab left behind (older than the ring) does not silence the ring", async () => {
            const h = harness();
            h.members = [membershipOf(CALLER), membershipOf(ME, 60 * 60_000)]; // mine is an hour old
            const ring = await h.manager.handleRing(ringInput());
            expect(ring).not.toBeNull();
            expect(h.host.showRing).toHaveBeenCalledTimes(1);
        });

        it("a membership of mine that has expired does not count either, even if it is newer than the ring", async () => {
            const h = harness();
            h.members = [membershipOf(CALLER), { ...membershipOf(ME), expiresAt: Date.now() - 1 }];
            expect(await h.manager.handleRing(ringInput())).not.toBeNull();
        });

        it("a membership of mine created just after the ring is an answer from another device", async () => {
            const h = harness();
            h.members = [membershipOf(CALLER), membershipOf(ME, -2_000)]; // created 2 s from now: after the ring
            expect(await h.manager.handleRing(ringInput())).toBeNull();
            expect(h.host.showRing).not.toHaveBeenCalled();
        });

        it("two ring events that point at the same caller membership are one call and ring once", async () => {
            const h = harness();
            const rel = { "m.relates_to": { rel_type: "m.reference", event_id: "$caller-membership" } };
            expect(await h.manager.handleRing(ringInput({ eventId: "$a" }, rel))).not.toBeNull();
            expect(await h.manager.handleRing(ringInput({ eventId: "$b" }, rel))).toBeNull();
            await h.manager.reject("$a");
            expect(await h.manager.handleRing(ringInput({ eventId: "$c" }, rel))).toBeNull(); // not even after it ended
            expect(h.host.showRing).toHaveBeenCalledTimes(1);
            // another call of the same caller (another membership) rings again
            const next = { "m.relates_to": { rel_type: "m.reference", event_id: "$caller-membership-2" } };
            expect(await h.manager.handleRing(ringInput({ eventId: "$d" }, next))).not.toBeNull();
        });

        it("rings without a membership reference are de-duplicated by their event id only", async () => {
            const h = harness();
            expect(await h.manager.handleRing(ringInput({ eventId: "$a" }))).not.toBeNull();
            await h.manager.reject("$a");
            expect(await h.manager.handleRing(ringInput({ eventId: "$b" }))).not.toBeNull();
        });

        it("a re-delivered ring event (decryption retry, backfill) rings once", async () => {
            const h = harness();
            await h.manager.handleRing(ringInput());
            expect(await h.manager.handleRing(ringInput())).toBeNull();
            expect(h.host.showRing).toHaveBeenCalledTimes(1);
            // and not again after it ended either
            await h.manager.reject("$ring1");
            expect(await h.manager.handleRing(ringInput())).toBeNull();
            expect(h.host.showRing).toHaveBeenCalledTimes(1);
        });

        it("never rejects, whatever the host does", async () => {
            const h = harness({
                waitForMembership: jest.fn(async () => {
                    throw new Error("boom");
                }),
            });
            await expect(h.manager.handleRing(ringInput())).resolves.toBeNull();
        });
    });

    describe("answering", () => {
        it("Accept stops the ring and joins with the resolved media type, without declining", async () => {
            const h = harness();
            await h.manager.handleRing(ringInput({}, { "m.call.intent": "audio" }));
            await h.manager.accept("$ring1");
            expect(h.hidden).toEqual([["$ring1", "accepted"]]);
            expect(h.host.joinCall).toHaveBeenCalledWith(ROOM, "voice");
            expect(h.host.sendDecline).not.toHaveBeenCalled();
            expect(h.host.stopRingtone).toHaveBeenCalled();
            expect(h.manager.rings).toEqual([]);
        });

        it("Reject stops the ring and sends the decline for THAT ring", async () => {
            const h = harness();
            await h.manager.handleRing(ringInput());
            await h.manager.reject("$ring1");
            expect(h.hidden).toEqual([["$ring1", "rejected"]]);
            expect(h.host.sendDecline).toHaveBeenCalledWith(ROOM, "$ring1");
            expect(h.host.joinCall).not.toHaveBeenCalled();
            expect(h.host.notifyMissed).not.toHaveBeenCalled();
        });

        it("accepting or rejecting an unknown or finished ring does nothing", async () => {
            const h = harness();
            await h.manager.accept("$nope");
            await h.manager.reject("$nope");
            expect(h.host.joinCall).not.toHaveBeenCalled();
            expect(h.host.sendDecline).not.toHaveBeenCalled();
        });

        it("a failing join is reported to the user (error toast) and leaves nothing ringing", async () => {
            const h = harness({
                joinCall: jest.fn(async () => {
                    throw new Error("widget");
                }),
            });
            await h.manager.handleRing(ringInput({}, { "m.call.intent": "video" }));
            await h.manager.accept("$ring1");
            expect(h.host.joinFailed).toHaveBeenCalledTimes(1);
            expect(h.host.joinFailed).toHaveBeenCalledWith(
                expect.objectContaining({ ringEventId: "$ring1", roomId: ROOM, mediaType: "video" }),
            );
            expect(h.manager.rings).toEqual([]);
            expect(h.host.notifyMissed).not.toHaveBeenCalled();
        });

        it("a join that works reports nothing, and a reporting failure is swallowed", async () => {
            const ok = harness();
            await ok.manager.handleRing(ringInput());
            await ok.manager.accept("$ring1");
            expect(ok.host.joinFailed).not.toHaveBeenCalled();

            const broken = harness({
                joinCall: jest.fn(async () => {
                    throw new Error("widget");
                }),
                joinFailed: jest.fn(() => {
                    throw new Error("toast");
                }),
            });
            await broken.manager.handleRing(ringInput());
            await expect(broken.manager.accept("$ring1")).resolves.toBeUndefined();
        });

        it("a failing decline or join is swallowed", async () => {
            const h = harness({
                sendDecline: jest.fn(async () => {
                    throw new Error("offline");
                }),
                joinCall: jest.fn(async () => {
                    throw new Error("widget");
                }),
            });
            await h.manager.handleRing(ringInput({ eventId: "$a" }));
            await expect(h.manager.reject("$a")).resolves.toBeUndefined();
            await h.manager.handleRing(ringInput({ eventId: "$b" }));
            await expect(h.manager.accept("$b")).resolves.toBeUndefined();
        });
    });

    describe("ending by itself", () => {
        it("stops at the end of the lifetime and leaves a missed-call entry", async () => {
            const h = harness();
            await h.manager.handleRing(ringInput());
            jest.advanceTimersByTime(29_499);
            expect(h.manager.rings).toHaveLength(1);
            jest.advanceTimersByTime(1);
            expect(h.hidden).toEqual([["$ring1", "expired"]]);
            expect(h.host.notifyMissed).toHaveBeenCalledWith(expect.objectContaining({ ringEventId: "$ring1" }));
            expect(h.host.stopRingtone).toHaveBeenCalled();
        });

        it("checkExpiry() ends rings whose time is up even if a throttled timer never fired", async () => {
            const h = harness();
            await h.manager.handleRing(ringInput());
            jest.setSystemTime(Date.now() + 31_000); // timers do not run, the clock moved
            h.manager.checkExpiry();
            expect(h.hidden).toEqual([["$ring1", "expired"]]);
        });

        it("the caller giving up (membership gone) is a missed call", async () => {
            const h = harness();
            await h.manager.handleRing(ringInput());
            h.members = [];
            h.manager.onRoomStateChanged(ROOM);
            expect(h.hidden).toEqual([["$ring1", "cancelled-by-caller"]]);
            expect(h.host.notifyMissed).toHaveBeenCalled();
        });

        it("another device of mine joining stops the ring silently", async () => {
            const h = harness();
            await h.manager.handleRing(ringInput());
            h.members = [membershipOf(CALLER), membershipOf(ME)];
            h.manager.onRoomStateChanged(ROOM);
            expect(h.hidden).toEqual([["$ring1", "answered-elsewhere"]]);
            expect(h.host.notifyMissed).not.toHaveBeenCalled();
        });

        it("a stale membership of mine does not end the ring when the room state changes", async () => {
            const h = harness();
            h.members = [membershipOf(CALLER), membershipOf(ME, 60 * 60_000)];
            await h.manager.handleRing(ringInput());
            h.manager.onRoomStateChanged(ROOM);
            expect(h.manager.rings).toHaveLength(1);
            // ...but a fresh one from another device still does
            h.members = [membershipOf(CALLER), membershipOf(ME, -1_000)];
            h.manager.onRoomStateChanged(ROOM);
            expect(h.hidden).toEqual([["$ring1", "answered-elsewhere"]]);
        });

        it("an unrelated state change keeps ringing", async () => {
            const h = harness();
            await h.manager.handleRing(ringInput());
            h.manager.onRoomStateChanged(ROOM);
            h.manager.onRoomStateChanged("!other:clarivahub.com");
            expect(h.manager.rings).toHaveLength(1);
        });

        it("my own decline from another device stops it silently; someone else's decline does not", async () => {
            const h = harness();
            await h.manager.handleRing(ringInput());
            h.manager.onDecline("$ring1", CALLER);
            expect(h.manager.rings).toHaveLength(1);
            h.manager.onDecline("$other", ME);
            expect(h.manager.rings).toHaveLength(1);
            h.manager.onDecline("$ring1", ME);
            expect(h.hidden).toEqual([["$ring1", "declined-elsewhere"]]);
            expect(h.host.notifyMissed).not.toHaveBeenCalled();
        });

        it("connecting to the call from this tab stops the ring silently", async () => {
            const h = harness();
            await h.manager.handleRing(ringInput());
            h.manager.onLocalCallConnected("!other:clarivahub.com");
            expect(h.manager.rings).toHaveLength(1);
            h.manager.onLocalCallConnected(ROOM);
            expect(h.hidden).toEqual([["$ring1", "joined-locally"]]);
        });

        it("a decline on another device DURING the media-type lookup still wins (no ghost ring)", async () => {
            let release: (v: CallMediaType | null) => void = () => undefined;
            const h = harness({
                fetchCallType: jest.fn(() => new Promise<CallMediaType | null>((r) => (release = r))),
            });
            const pending = h.manager.handleRing(ringInput());
            await settle();
            h.manager.onDecline("$ring1", ME);
            release("video");
            await expect(pending).resolves.toBeNull();
            expect(h.host.showRing).not.toHaveBeenCalled();
            expect(h.manager.rings).toEqual([]);
        });

        it("the caller giving up during the media-type lookup is a missed call, not a ring", async () => {
            let release: (v: CallMediaType | null) => void = () => undefined;
            const h = harness({
                fetchCallType: jest.fn(() => new Promise<CallMediaType | null>((r) => (release = r))),
            });
            const pending = h.manager.handleRing(ringInput());
            await settle();
            h.members = [];
            release("video");
            await expect(pending).resolves.toBeNull();
            expect(h.host.showRing).not.toHaveBeenCalled();
            expect(h.host.notifyMissed).toHaveBeenCalledWith({ roomId: ROOM, senderId: CALLER });
        });

        it("stop() silences every ring", async () => {
            const h = harness();
            await h.manager.handleRing(ringInput({ eventId: "$a" }));
            h.manager.stop();
            expect(h.manager.rings).toEqual([]);
            expect(h.hidden).toEqual([["$a", "stopped"]]);
            expect(h.host.stopRingtone).toHaveBeenCalled();
        });
    });
});
