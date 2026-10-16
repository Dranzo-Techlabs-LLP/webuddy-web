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

import { fetchCallType, recordCallType } from "../../src/clariva/calls/callType";
import { latestCallStartedEventId } from "../../src/clariva/calls/hooks";
import { type TileState, isLiveTile, tileShowsVideoIcon, tileTrailing } from "../../src/clariva/calls/tile";
import { ClarivaCallStartedPreview } from "../../src/clariva/calls/previews";
import { ME, configureClariva, installFakeApi, mockResponse } from "./helpers";

const ROOM = "!dm:clarivahub.com";
const POST_TYPE = "POST /v1/calls/type";
const GET_TYPE = "GET /v1/calls/type";

describe("call-type record (Wallet-API /v1/calls/type)", () => {
    beforeEach(() => {
        configureClariva();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("writes {roomId, callType, callerId} and reports success", async () => {
        const fetchMock = installFakeApi({
            [POST_TYPE]: (_url, init) => {
                expect(JSON.parse(init.body as string)).toEqual({ roomId: ROOM, callType: "voice", callerId: ME });
                return mockResponse(201, { roomId: ROOM, callType: "voice" });
            },
        });
        await expect(recordCallType(ROOM, "voice", ME)).resolves.toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("never throws when the write fails (a call must not depend on it)", async () => {
        installFakeApi({ [POST_TYPE]: () => mockResponse(500, { message: "boom" }) });
        await expect(recordCallType(ROOM, "video", ME)).resolves.toBe(false);

        (global as any).fetch = jest.fn(async () => {
            throw new TypeError("Failed to fetch");
        });
        await expect(recordCallType(ROOM, "video", ME)).resolves.toBe(false);
    });

    it("reads the recorded type and only trusts the Wallet vocabulary", async () => {
        installFakeApi({
            [GET_TYPE]: (url) => {
                expect(url.searchParams.get("roomId")).toBe(ROOM);
                return mockResponse(200, { roomId: ROOM, callType: "video", updatedAt: "2026-08-19T10:00:00.000Z" });
            },
        });
        await expect(fetchCallType(ROOM)).resolves.toBe("video");

        installFakeApi({
            [GET_TYPE]: () => mockResponse(200, { roomId: ROOM, callType: null, updatedAt: null }),
        });
        await expect(fetchCallType(ROOM)).resolves.toBeNull();

        installFakeApi({ [GET_TYPE]: () => mockResponse(200, { roomId: ROOM, callType: "audio" }) });
        await expect(fetchCallType(ROOM)).resolves.toBeNull();
    });

    it("any read failure is 'unknown'", async () => {
        installFakeApi({ [GET_TYPE]: () => mockResponse(400, { message: "roomId is required" }) });
        await expect(fetchCallType(ROOM)).resolves.toBeNull();
    });

    it("gives up after 2 seconds", async () => {
        jest.useFakeTimers();
        (global as any).fetch = jest.fn(
            (_url: string, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
                }),
        );
        const read = fetchCallType(ROOM);
        const write = recordCallType(ROOM, "voice", ME);
        jest.advanceTimersByTime(1999);
        let settled = false;
        void read.then(() => (settled = true));
        await Promise.resolve();
        expect(settled).toBe(false);
        jest.advanceTimersByTime(1);
        await expect(read).resolves.toBeNull();
        await expect(write).resolves.toBe(false);
    });
});

describe('"Call started" tile rules (Join only on the newest tile)', () => {
    const live: TileState = {
        isLatest: true,
        callOngoing: true,
        restricted: false,
        locallyConnected: false,
        media: "video",
    };

    it("the newest tile of a running call shows Join", () => {
        expect(isLiveTile(live)).toBe(true);
        expect(tileTrailing(live)).toBe("join");
        expect(tileShowsVideoIcon(live)).toBe(true);
        expect(tileShowsVideoIcon({ ...live, media: "voice" })).toBe(false);
        expect(tileShowsVideoIcon({ ...live, media: null })).toBe(false);
    });

    it("older tiles never get Join or the video icon, even while a call is running", () => {
        const old = { ...live, isLatest: false };
        expect(tileTrailing(old)).toBe("time");
        expect(tileShowsVideoIcon(old)).toBe(false);
    });

    it("the newest tile of a finished call is history: the time, the phone icon", () => {
        const ended = { ...live, callOngoing: false };
        expect(tileTrailing(ended)).toBe("time");
        expect(tileShowsVideoIcon(ended)).toBe(false);
    });

    it("Join is hidden (an empty slot, not the time) while restricted or already in the call here", () => {
        expect(tileTrailing({ ...live, restricted: true })).toBe("none");
        expect(tileTrailing({ ...live, locallyConnected: true })).toBe("none");
    });
});

describe("latestCallStartedEventId", () => {
    const ev = (id: string, type: string) => ({ getId: () => id, getType: () => type });
    const roomWith = (events: ReturnType<typeof ev>[]) =>
        ({ getLiveTimeline: () => ({ getEvents: () => events }) }) as any;

    it("is the newest ring event, ignoring everything else", () => {
        const room = roomWith([
            ev("$old", "org.matrix.msc4075.rtc.notification"),
            ev("$msg", "m.room.message"),
            ev("$new", "org.matrix.msc4075.rtc.notification"),
            ev("$decline", "org.matrix.msc4310.rtc.decline"),
            ev("$legacy", "org.matrix.msc4075.call.notify"),
        ]);
        expect(latestCallStartedEventId(room)).toBe("$new");
    });

    it("is undefined without a ring (or without a room)", () => {
        expect(latestCallStartedEventId(roomWith([ev("$msg", "m.room.message")]))).toBeUndefined();
        expect(latestCallStartedEventId(null)).toBeUndefined();
    });
});

describe("room-list preview", () => {
    it("is 'Call started' only while Clariva calls are on", () => {
        configureClariva({ features: { calls: true } });
        const preview = new ClarivaCallStartedPreview();
        expect(preview.getTextFor({} as any)).toBe("Call started");
        configureClariva();
        expect(preview.getTextFor({} as any)).toBeNull();
    });
});
