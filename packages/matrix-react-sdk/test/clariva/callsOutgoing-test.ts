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

import { type CallMediaType, type ElementCallIntent } from "../../src/clariva/calls/intent";
import { type OutgoingHost, joinDmCall, startDmCall } from "../../src/clariva/calls/outgoing";

const ME = "@asha:clarivahub.com";
const PEER = "@rao:clarivahub.com";

interface FakeRoom {
    roomId: string;
    peer: string | null;
    live: boolean;
    media: CallMediaType | null;
}

function setup(overrides: Partial<OutgoingHost<FakeRoom>> = {}): {
    host: OutgoingHost<FakeRoom>;
    log: string[];
    opened: ElementCallIntent[];
} {
    const log: string[] = [];
    const opened: ElementCallIntent[] = [];
    const host: OutgoingHost<FakeRoom> = {
        myUserId: () => ME,
        dmPeerOf: (room) => room.peer,
        roomIdOf: (room) => room.roomId,
        hasLiveCall: (room) => room.live,
        liveCallMedia: (room) => room.media,
        recordCallType: jest.fn(async (roomId, media, callerId) => {
            log.push(`record:${roomId}:${media}:${callerId}`);
            return true;
        }),
        fetchCallType: jest.fn(async () => {
            log.push("fetch");
            return null;
        }),
        watchBilling: jest.fn((_room, peerId, mode) => {
            log.push(`billing:${peerId}:${mode}`);
        }),
        watchDecline: jest.fn(() => {
            log.push("decline-watch");
        }),
        openCall: jest.fn(async (_room, intent) => {
            log.push(`open:${intent}`);
            opened.push(intent);
        }),
        now: () => 1000,
        ...overrides,
    };
    return { host, log, opened };
}

const dm = (extra: Partial<FakeRoom> = {}): FakeRoom => ({
    roomId: "!dm:clarivahub.com",
    peer: PEER,
    live: false,
    media: null,
    ...extra,
});

describe("startDmCall (the chooser)", () => {
    it("voice: billing watcher first, then the call-type record, then the voice intent", async () => {
        const { host, log } = setup();
        await expect(startDmCall(host, dm(), true)).resolves.toBe("start_call_dm_voice");
        expect(log).toEqual([
            `billing:${PEER}:start`,
            `record:!dm:clarivahub.com:voice:${ME}`,
            "decline-watch",
            "open:start_call_dm_voice",
        ]);
    });

    it("video: records 'video' and uses start_call_dm", async () => {
        const { host, log } = setup();
        await expect(startDmCall(host, dm(), false)).resolves.toBe("start_call_dm");
        expect(log).toContain(`record:!dm:clarivahub.com:video:${ME}`);
        expect(log[log.length - 1]).toBe("open:start_call_dm");
    });

    it("never waits on a failed call-type record: the call still starts", async () => {
        const { host, opened } = setup({ recordCallType: jest.fn(async () => false) });
        await startDmCall(host, dm(), true);
        expect(opened).toEqual(["start_call_dm_voice"]);
    });

    it("a call that is already live is joined (join_existing_dm*), and no decline watcher is armed for it", async () => {
        const { host, log } = setup();
        await expect(startDmCall(host, dm({ live: true }), true)).resolves.toBe("join_existing_dm_voice");
        expect(log).not.toContain("decline-watch");
        const again = setup();
        await expect(startDmCall(again.host, dm({ live: true }), false)).resolves.toBe("join_existing_dm");
    });

    it("is not for groups: nothing happens and the caller falls back to Element's flow", async () => {
        const { host, log } = setup();
        await expect(startDmCall(host, dm({ peer: null }), false)).resolves.toBeNull();
        expect(log).toEqual([]);
    });
});

describe("joinDmCall", () => {
    it("takes the media type from the live call (m.call.intent) and bills in 'join' mode", async () => {
        const { host, log } = setup();
        await expect(joinDmCall(host, dm({ live: true, media: "voice" }), { billing: true })).resolves.toBe(
            "join_existing_dm_voice",
        );
        expect(log).toEqual([`billing:${PEER}:join`, "open:join_existing_dm_voice"]);
    });

    it("asks the Wallet record only when the call itself does not say, and defaults to video", async () => {
        const { host, log } = setup();
        await expect(joinDmCall(host, dm({ live: true }), { billing: false })).resolves.toBe("join_existing_dm");
        expect(log).toEqual(["fetch", "open:join_existing_dm"]);

        const voice = setup({ fetchCallType: jest.fn(async () => "voice" as CallMediaType) });
        await expect(joinDmCall(voice.host, dm({ live: true }), { billing: false })).resolves.toBe(
            "join_existing_dm_voice",
        );

        const known = setup();
        await joinDmCall(known.host, dm({ live: true, media: "video" }), { billing: false });
        expect(known.log).toEqual(["open:join_existing_dm"]); // no pointless request
    });

    it("answering a ring is not billed (Android parity) and uses the media type the ring resolved", async () => {
        const { host, log } = setup();
        await expect(joinDmCall(host, dm({ live: true }), { mediaType: "voice", billing: false })).resolves.toBe(
            "join_existing_dm_voice",
        );
        expect(log).toEqual(["open:join_existing_dm_voice"]);
    });

    it("is not for groups", async () => {
        const { host, log } = setup();
        await expect(joinDmCall(host, dm({ peer: null, live: true }), { billing: true })).resolves.toBeNull();
        expect(log).toEqual([]);
    });
});
