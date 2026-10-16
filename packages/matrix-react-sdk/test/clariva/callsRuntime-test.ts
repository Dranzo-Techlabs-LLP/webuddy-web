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

import { EventEmitter } from "events";
import { waitFor } from "@testing-library/react";
import {
    ClientEvent,
    MatrixEventEvent,
    RoomEvent,
    RoomStateEvent,
    SyncState,
    type MatrixClient,
    type MatrixEvent,
    type Room,
} from "matrix-js-sdk/src/matrix";

import SdkConfig from "../../src/SdkConfig";
import ToastStore from "../../src/stores/ToastStore";
import defaultDispatcher from "../../src/dispatcher/dispatcher";
import { Action } from "../../src/dispatcher/actions";
import LegacyCallHandler from "../../src/LegacyCallHandler";
import { ElementCall } from "../../src/models/Call";
import { CallStore, CallStoreEvent } from "../../src/stores/CallStore";
import { getClarivaCallDmPeerId, getClarivaDmPeerId } from "../../src/clariva/chat/dmPeer";
import { WalletStore } from "../../src/clariva/stores/WalletStore";
import { ClarivaCalls } from "../../src/clariva/calls/runtime";
import { resetClarivaCallsConfigForTests } from "../../src/clariva/calls/config";
import { isRingSoundBlocked, setRingSoundBlocked } from "../../src/clariva/calls/callAudio";
import { closeCallNotification, showCallNotification } from "../../src/clariva/calls/desktopNotify";
import { CLIENT, CONSULTANT, ME, configureClariva, installFakeApi, mockResponse, walletUser } from "./helpers";

// The CALL peer (m.direct, then the implicit 1:1 guess) and the BILLING peer (m.direct only) are different helpers: the
// whole runtime must run on the first. Tests make the second one say "not a DM" everywhere.
jest.mock("../../src/clariva/chat/dmPeer", () => ({
    getClarivaDmPeerId: jest.fn(),
    getClarivaCallDmPeerId: jest.fn(),
}));
// Listeners of the ringtone context's `statechange`.
const mockAudioStateListeners = new Set<() => void>();
// Autoplay / WebAudio do not exist in jsdom.
jest.mock("../../src/LegacyCallHandler", () => ({
    __esModule: true,
    default: {
        instance: {
            play: jest.fn(async () => undefined),
            pause: jest.fn(),
            isAudioBlocked: jest.fn(() => false),
            unlockAudio: jest.fn(async () => undefined),
            onAudioBlockedChange: jest.fn((listener: () => void) => {
                mockAudioStateListeners.add(listener);
                return () => {
                    mockAudioStateListeners.delete(listener);
                };
            }),
        },
    },
    AudioID: { Ring: "ringAudio" },
}));
// Browser notifications are asserted on; their own rules are tested in callsReceiving-test.
jest.mock("../../src/clariva/calls/desktopNotify", () => ({
    showCallNotification: jest.fn(),
    closeCallNotification: jest.fn(),
    isTabInBackground: jest.fn(() => false),
}));

const enc = encodeURIComponent;
const ROOM_ID = "!dm:clarivahub.com";
const PEER = CONSULTANT;

const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
};

interface FakeEventInit {
    id: string;
    type: string;
    sender: string;
    content: Record<string, unknown>;
    stateKey?: string;
    ts?: number;
    decrypting?: boolean;
}

type FakeEvent = MatrixEvent & { decrypting: boolean; failed: boolean };

function fakeEvent(init: FakeEventInit): FakeEvent {
    const ts = init.ts ?? Date.now();
    const ev = {
        decrypting: init.decrypting ?? false,
        failed: false,
        getId: () => init.id,
        getType: () => init.type,
        getSender: () => init.sender,
        getRoomId: () => ROOM_ID,
        getTs: () => ts,
        localTimestamp: ts,
        getContent: () => init.content,
        getStateKey: () => init.stateKey,
        isBeingDecrypted: () => ev.decrypting,
        isDecryptionFailure: () => ev.failed,
    };
    return ev as unknown as FakeEvent;
}

const membershipEvent = (sender: string, ts: number, media?: "audio" | "video"): MatrixEvent =>
    fakeEvent({
        id: `$member-${sender}`,
        type: "org.matrix.msc3401.call.member",
        sender,
        stateKey: `_${sender}_DEV_m.call`,
        ts,
        content: {
            application: "m.call",
            call_id: "",
            scope: "m.room",
            device_id: "DEV",
            expires: 7_200_000,
            focus_active: { type: "livekit", focus_selection: "oldest_membership" },
            foci_preferred: [],
            ...(media ? { "m.call.intent": media } : {}),
        },
    });

const ringEvent = (id: string, sender: string, extra: Record<string, unknown> = {}, decrypting = false): FakeEvent =>
    fakeEvent({
        id,
        type: "org.matrix.msc4075.rtc.notification",
        sender,
        decrypting,
        content: { notification_type: "ring", lifetime: 30_000, sender_ts: Date.now(), ...extra },
    });

describe("ClarivaCalls runtime (wiring)", () => {
    let client: MatrixClient;
    /** The fake client as the plain emitter it is (the typed `emit` wants the SDK's full argument lists). */
    let bus: EventEmitter;
    let room: Room;
    let syncState: SyncState | null;
    let roomMembers: { membership: string; count: number };
    let memberships: MatrixEvent[];
    let timeline: MatrixEvent[];
    let requests: Array<{ key: string; body?: any }>;
    let order: string[];
    let create: jest.SpyInstance;
    let dispatch: jest.SpyInstance;

    const installWallet = (isConsultant: 0 | 1): void => {
        requests = [];
        const record = (key: string) => (_url: URL, init: RequestInit) => {
            order.push(key);
            requests.push({ key, body: init.body ? JSON.parse(init.body as string) : undefined });
            return mockResponse(201, {});
        };
        installFakeApi({
            [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser({ current_hold: "500.00", isConsultant })),
            [`GET /v1/users/${enc(PEER)}`]: () =>
                mockResponse(200, walletUser({ Webuddy_name: PEER, max_credits: "100.00", isConsultant: 1 })),
            "GET /v1/refund/pending-for-consultant": () => mockResponse(200, { clientIds: [] }),
            "GET /v1/pending-holds/exists": () => mockResponse(200, { exists: true }),
            "POST /v1/calls/type": record("calls/type"),
            "POST /v1/pending-holds/initiate": record("initiate"),
        });
    };

    const startWallet = async (): Promise<void> => {
        WalletStore.resetForTests();
        WalletStore.instance.start(ME);
        await settle();
    };

    beforeEach(() => {
        configureClariva({ features: { calls: true } });
        resetClarivaCallsConfigForTests();
        memberships = [];
        timeline = [];
        order = [];
        syncState = SyncState.Syncing;
        roomMembers = { membership: "join", count: 2 };
        room = {
            roomId: ROOM_ID,
            getMember: jest.fn(() => ({ name: "Dr Rao", membership: "join" })),
            getMyMembership: jest.fn(() => roomMembers.membership),
            getInvitedAndJoinedMemberCount: jest.fn(() => roomMembers.count),
            currentState: { getStateEvents: jest.fn(() => memberships) },
            getLiveTimeline: () => ({ getEvents: () => timeline }),
        } as unknown as Room;
        client = Object.assign(new EventEmitter(), {
            getSyncState: () => syncState,
            getSafeUserId: () => ME,
            getRoom: (id: string) => (id === ROOM_ID ? room : null),
            decryptEventIfNeeded: jest.fn(async () => undefined),
            sendEvent: jest.fn(async () => ({ event_id: "$sent" })),
        }) as unknown as MatrixClient;
        bus = client as unknown as EventEmitter;
        (room as any).client = client;
        jest.mocked(getClarivaCallDmPeerId).mockImplementation((r) => (r === room ? PEER : null));
        jest.mocked(getClarivaDmPeerId).mockReset().mockReturnValue(null); // not a billed DM: calls must not care
        create = jest.spyOn(ElementCall, "create").mockImplementation(async () => {
            order.push("create");
        });
        dispatch = jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => undefined);
        ToastStore.sharedInstance().reset();
        setRingSoundBlocked(false);
        jest.mocked(LegacyCallHandler.instance.isAudioBlocked).mockReturnValue(false);
        jest.mocked(LegacyCallHandler.instance.unlockAudio).mockClear();
        jest.mocked(LegacyCallHandler.instance.play).mockClear();
        jest.mocked(LegacyCallHandler.instance.pause).mockClear();
        jest.mocked(LegacyCallHandler.instance.onAudioBlockedChange).mockClear();
        mockAudioStateListeners.clear();
        jest.mocked(showCallNotification).mockClear();
        jest.mocked(closeCallNotification).mockClear();
        document.title = "";
    });

    afterEach(() => {
        jest.useRealTimers();
        ClarivaCalls.stop();
        WalletStore.resetForTests();
        ToastStore.sharedInstance().reset();
        jest.restoreAllMocks();
        SdkConfig.reset();
        resetClarivaCallsConfigForTests();
    });

    const currentRingToast = (): string | undefined =>
        ToastStore.sharedInstance()
            .getToasts()
            .map((t) => t.key)
            .find((k) => k.startsWith("clariva_call_") && !k.startsWith("clariva_call_join_failed_"));

    const deliverTimeline = (ev: MatrixEvent, live = true): void => {
        bus.emit(RoomEvent.Timeline, ev, room, false, false, {
            liveEvent: live,
            timeline: { getTimelineSet: () => ({ threadListType: null }) },
        } as any);
    };

    describe("starting a call from the chooser", () => {
        it("records the call type, creates the widget with the voice intent and opens the call", async () => {
            installWallet(0);
            await startWallet();
            ClarivaCalls.start(client);

            await expect(ClarivaCalls.startCall(room, true)).resolves.toBe("start_call_dm_voice");

            expect(requests.find((r) => r.key === "calls/type")?.body).toEqual({
                roomId: ROOM_ID,
                callType: "voice",
                callerId: ME,
            });
            expect(create).toHaveBeenCalledWith(room, true, "start_call_dm_voice");
            expect(dispatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: Action.ViewRoom,
                    room_id: ROOM_ID,
                    view_call: true,
                    skipLobby: true,
                }),
            );
            // the call type is written BEFORE the call opens
            expect(order.filter((step) => step === "calls/type" || step === "create")).toEqual([
                "calls/type",
                "create",
            ]);
        });

        it("a video call starts with start_call_dm, a running call is joined with join_existing_dm*", async () => {
            installWallet(0);
            await startWallet();
            ClarivaCalls.start(client);
            await expect(ClarivaCalls.startCall(room, false)).resolves.toBe("start_call_dm");

            memberships = [membershipEvent(PEER, Date.now() - 1000, "audio")];
            await expect(ClarivaCalls.joinCall(room, { billing: false })).resolves.toBe("join_existing_dm_voice");
            expect(create).toHaveBeenLastCalledWith(room, true, "join_existing_dm_voice");
        });

        it("a room that is not a 1:1 chat is left to Element's flow", async () => {
            installWallet(0);
            jest.mocked(getClarivaCallDmPeerId).mockReturnValue(null);
            await expect(ClarivaCalls.startCall(room, true)).resolves.toBeNull();
            expect(create).not.toHaveBeenCalled();
        });

        it("a room only the CALL helper knows as a 1:1 chat (m.direct does not list it) still starts and joins calls", async () => {
            installWallet(0);
            await startWallet();
            ClarivaCalls.start(client);
            // beforeEach: the billing helper says "not a DM" for this room, the call helper says PEER
            await expect(ClarivaCalls.startCall(room, true)).resolves.toBe("start_call_dm_voice");
            memberships = [membershipEvent(PEER, Date.now() - 1000, "video")];
            await expect(ClarivaCalls.joinCall(room, { billing: true })).resolves.toBe("join_existing_dm");
            expect(getClarivaDmPeerId).not.toHaveBeenCalled(); // no call path consults the billing helper
        });
    });

    describe("billing when the peer answers", () => {
        it("a client is billed once, when the consultant joins after the call started", async () => {
            installWallet(0);
            await startWallet();
            ClarivaCalls.start(client);
            await ClarivaCalls.startCall(room, false);
            expect(requests.filter((r) => r.key === "initiate")).toHaveLength(0);

            // my own membership appears: still nobody to bill
            memberships = [membershipEvent(ME, Date.now() + 500)];
            bus.emit(RoomStateEvent.Events, memberships[0]);
            await settle();
            expect(requests.filter((r) => r.key === "initiate")).toHaveLength(0);

            // the consultant answers
            memberships = [...memberships, membershipEvent(PEER, Date.now() + 3000)];
            bus.emit(RoomStateEvent.Events, memberships[1]);
            await waitFor(() => expect(requests.filter((r) => r.key === "initiate")).toHaveLength(1));
            expect(requests.find((r) => r.key === "initiate")?.body).toEqual({ clientId: ME, consultantId: PEER });

            // further changes in the same call do not bill again
            bus.emit(RoomStateEvent.Events, memberships[1]);
            await settle();
            expect(requests.filter((r) => r.key === "initiate")).toHaveLength(1);
        });

        it("a membership the consultant left behind before the call started is not an answer", async () => {
            installWallet(0);
            await startWallet();
            ClarivaCalls.start(client);
            memberships = [membershipEvent(PEER, Date.now() - 60 * 60_000)]; // stale, 1 h old, not expired yet
            await ClarivaCalls.startCall(room, false);
            bus.emit(RoomStateEvent.Events, memberships[0]);
            await settle();
            expect(requests.filter((r) => r.key === "initiate")).toHaveLength(0);
        });

        it("pressing Join on a call the consultant is already in bills at once", async () => {
            installWallet(0);
            await startWallet();
            ClarivaCalls.start(client);
            memberships = [membershipEvent(PEER, Date.now() - 20_000, "video")];
            await ClarivaCalls.joinCall(room, { billing: true });
            await waitFor(() => expect(requests.filter((r) => r.key === "initiate")).toHaveLength(1));
        });

        it("accepting a ring does not bill (Android parity)", async () => {
            installWallet(0);
            await startWallet();
            ClarivaCalls.start(client);
            memberships = [membershipEvent(PEER, Date.now() - 5000)];
            await ClarivaCalls.joinCall(room, { mediaType: "voice", billing: false });
            bus.emit(RoomStateEvent.Events, memberships[0]);
            await settle();
            expect(requests.filter((r) => r.key === "initiate")).toHaveLength(0);
        });

        it("a consultant never pays", async () => {
            installWallet(1);
            await startWallet();
            ClarivaCalls.start(client);
            await ClarivaCalls.startCall(room, false);
            memberships = [membershipEvent(CLIENT, Date.now() + 3000)];
            bus.emit(RoomStateEvent.Events, memberships[0]);
            await settle();
            expect(requests.filter((r) => r.key === "initiate")).toHaveLength(0);
        });
    });

    describe("incoming rings", () => {
        const ringToast = (): string | undefined =>
            ToastStore.sharedInstance()
                .getToasts()
                .map((t) => t.key)
                .find((k) => k.startsWith("clariva_call_"));

        const timelineEvent = (ev: MatrixEvent, live = true): void => {
            bus.emit(RoomEvent.Timeline, ev, room, false, false, {
                liveEvent: live,
                timeline: { getTimelineSet: () => ({ threadListType: null }) },
            } as any);
        };

        beforeEach(() => {
            installWallet(1);
        });

        it("a live ring from the peer shows the toast", async () => {
            ClarivaCalls.start(client);
            memberships = [membershipEvent(PEER, Date.now() - 1000)];
            timelineEvent(ringEvent("$ring", PEER, { "m.call.intent": "audio" }));
            await waitFor(() => expect(ringToast()).toBe("clariva_call_$ring"));
            expect(ClarivaCalls.incomingCalls?.rings[0]).toMatchObject({ roomId: ROOM_ID, mediaType: "voice" });
            // the room is a 1:1 call for the CALL helper only: a ring never waits for the billing helper's m.direct
            expect(getClarivaDmPeerId).not.toHaveBeenCalled();
        });

        it("Reject sends the decline for that ring and removes the toast", async () => {
            ClarivaCalls.start(client);
            memberships = [membershipEvent(PEER, Date.now() - 1000)];
            timelineEvent(ringEvent("$ring", PEER, { "m.call.intent": "video" }));
            await waitFor(() => expect(ringToast()).toBeDefined());

            await ClarivaCalls.incomingCalls!.reject("$ring");
            expect(client.sendEvent).toHaveBeenCalledWith(ROOM_ID, "org.matrix.msc4310.rtc.decline", {
                "m.relates_to": { rel_type: "m.reference", event_id: "$ring" },
            });
            expect(ringToast()).toBeUndefined();
        });

        it("Accept joins with the ring's media type and does not bill", async () => {
            ClarivaCalls.start(client);
            memberships = [membershipEvent(PEER, Date.now() - 1000)];
            timelineEvent(ringEvent("$ring", PEER, { "m.call.intent": "audio" }));
            await waitFor(() => expect(ringToast()).toBeDefined());

            await ClarivaCalls.incomingCalls!.accept("$ring");
            expect(create).toHaveBeenCalledWith(room, true, "join_existing_dm_voice");
            expect(requests.filter((r) => r.key === "initiate")).toHaveLength(0);
            expect(ringToast()).toBeUndefined();
        });

        it("waits for decryption before ringing", async () => {
            ClarivaCalls.start(client);
            memberships = [membershipEvent(PEER, Date.now() - 1000)];
            const encrypted = ringEvent("$ring", PEER, { "m.call.intent": "audio" }, true);
            timelineEvent(encrypted);
            await settle();
            expect(ringToast()).toBeUndefined();

            (encrypted as any).decrypting = false;
            bus.emit(MatrixEventEvent.Decrypted, encrypted);
            await waitFor(() => expect(ringToast()).toBe("clariva_call_$ring"));
        });

        it("never rings for history, for a ring before the first sync, or for my own ring", async () => {
            ClarivaCalls.start(client);
            memberships = [membershipEvent(PEER, Date.now() - 1000)];
            timelineEvent(ringEvent("$old", PEER), false); // backfill / not a live event
            timelineEvent(ringEvent("$mine", ME));
            await settle();
            expect(ringToast()).toBeUndefined();

            bus.emit("sync", SyncState.Stopped); // the client is shut down
            timelineEvent(ringEvent("$offline", PEER));
            await settle();
            expect(ringToast()).toBeUndefined();
        });

        it("my other device declining stops the ring; the caller's own decline does not", async () => {
            ClarivaCalls.start(client);
            memberships = [membershipEvent(PEER, Date.now() - 1000)];
            timelineEvent(ringEvent("$ring", PEER, { "m.call.intent": "audio" }));
            await waitFor(() => expect(ringToast()).toBeDefined());

            const decline = (sender: string, id: string): MatrixEvent =>
                fakeEvent({
                    id,
                    type: "org.matrix.msc4310.rtc.decline",
                    sender,
                    content: { "m.relates_to": { rel_type: "m.reference", event_id: "$ring" } },
                });
            timelineEvent(decline(PEER, "$d1"));
            await settle();
            expect(ringToast()).toBeDefined();
            timelineEvent(decline(ME, "$d2"));
            await waitFor(() => expect(ringToast()).toBeUndefined());
        });

        it("the caller hanging up (membership removed) ends the ring", async () => {
            ClarivaCalls.start(client);
            memberships = [membershipEvent(PEER, Date.now() - 1000)];
            timelineEvent(ringEvent("$ring", PEER, { "m.call.intent": "audio" }));
            await waitFor(() => expect(ringToast()).toBeDefined());

            memberships = []; // the leave
            bus.emit(
                RoomStateEvent.Events,
                fakeEvent({
                    id: "$leave",
                    type: "org.matrix.msc3401.call.member",
                    sender: PEER,
                    content: {},
                    stateKey: `_${PEER}_DEV_m.call`,
                }),
            );
            await waitFor(() => expect(ringToast()).toBeUndefined());
        });
    });

    describe("receiving: the sync-state gate", () => {
        beforeEach(() => {
            installWallet(1);
            memberships = [membershipEvent(PEER, Date.now() - 1000)];
        });

        it("rings for a ring in the first response after Reconnecting (js-sdk emits the new state only afterwards)", async () => {
            ClarivaCalls.start(client);
            bus.emit(ClientEvent.Sync, SyncState.Reconnecting);
            deliverTimeline(ringEvent("$ring", PEER, { "m.call.intent": "audio" }));
            await waitFor(() => expect(currentRingToast()).toBe("clariva_call_$ring"));
        });

        it("the ring toast carries the shell and body class hooks the call sheet stylesheet hangs on", async () => {
            ClarivaCalls.start(client);
            deliverTimeline(ringEvent("$ring", PEER, { "m.call.intent": "audio" }));
            await waitFor(() => expect(currentRingToast()).toBe("clariva_call_$ring"));
            const toast = ToastStore.sharedInstance()
                .getToasts()
                .find((t) => t.key === "clariva_call_$ring");
            expect(toast?.className).toBe("mx_ClarivaIncomingCallToast");
            expect(toast?.bodyClassName).toBe("mx_ClarivaIncomingCall");
        });

        it("rings for a ring in the first response after Prepared and after Catchup", async () => {
            syncState = SyncState.Prepared; // the runtime starts right after the cached sync was replayed
            ClarivaCalls.start(client);
            deliverTimeline(ringEvent("$first", PEER, { "m.call.intent": "audio" }));
            await waitFor(() => expect(currentRingToast()).toBe("clariva_call_$first"));

            bus.emit(ClientEvent.Sync, SyncState.Error);
            bus.emit(ClientEvent.Sync, SyncState.Catchup);
            deliverTimeline(ringEvent("$caught-up", PEER, { "m.call.intent": "video" }));
            await waitFor(() =>
                expect(ClarivaCalls.incomingCalls?.rings.map((r) => r.ringEventId)).toContain("$caught-up"),
            );
        });

        it("stays deaf before the client has synced at all and while it is stopped", async () => {
            syncState = null;
            ClarivaCalls.start(client);
            deliverTimeline(ringEvent("$initial-load", PEER));
            bus.emit(ClientEvent.Sync, SyncState.Syncing);
            bus.emit(ClientEvent.Sync, SyncState.Stopped);
            deliverTimeline(ringEvent("$stopped", PEER));
            await settle();
            expect(currentRingToast()).toBeUndefined();
        });

        it("keeps listening in Error: the response that recovers from an error is handled while the state is still Error", async () => {
            ClarivaCalls.start(client);
            bus.emit(ClientEvent.Sync, SyncState.Reconnecting);
            bus.emit(ClientEvent.Sync, SyncState.Error);
            deliverTimeline(ringEvent("$while-recovering", PEER, { "m.call.intent": "audio" }));
            await waitFor(() => expect(currentRingToast()).toBe("clariva_call_$while-recovering"));
        });

        it("an Error before the first sync does not open the gate", async () => {
            syncState = null;
            ClarivaCalls.start(client);
            bus.emit(ClientEvent.Sync, SyncState.Error);
            deliverTimeline(ringEvent("$too-early", PEER));
            await settle();
            expect(currentRingToast()).toBeUndefined();
        });

        it("never rings for history: cached or backfilled events and stale rings, whatever the sync state", async () => {
            syncState = SyncState.Prepared;
            ClarivaCalls.start(client);
            deliverTimeline(ringEvent("$cached", PEER), false); // replayed from the cache: not a live event
            const stale = ringEvent("$stale", PEER, { sender_ts: Date.now() - 120_000 });
            (stale as any).localTimestamp = Date.now() - 120_000;
            deliverTimeline(stale);
            await settle();
            expect(currentRingToast()).toBeUndefined();
        });
    });

    describe("receiving: encrypted rings (the DM is only known after decryption)", () => {
        beforeEach(() => {
            installWallet(1);
            memberships = [membershipEvent(PEER, Date.now() - 1000)];
        });

        it("parks a ring in a two-member room that m.direct does not know yet and rings once it decrypts", async () => {
            jest.mocked(getClarivaCallDmPeerId).mockReturnValue(null); // m.direct not loaded / never recorded
            ClarivaCalls.start(client);
            const encrypted = ringEvent("$ring", PEER, { "m.call.intent": "audio" }, true);
            deliverTimeline(encrypted);
            await settle();
            expect(currentRingToast()).toBeUndefined();

            jest.mocked(getClarivaCallDmPeerId).mockImplementation((r) => (r === room ? PEER : null)); // DM known by now
            encrypted.decrypting = false;
            bus.emit(MatrixEventEvent.Decrypted, encrypted);
            await waitFor(() => expect(currentRingToast()).toBe("clariva_call_$ring"));
        });

        it("a ring that cannot be decrypted yet rings when the late key arrives while it is still unexpired", async () => {
            ClarivaCalls.start(client);
            const encrypted = ringEvent("$ring", PEER, { "m.call.intent": "video" }, true);
            deliverTimeline(encrypted);

            encrypted.decrypting = false;
            encrypted.failed = true; // "unable to decrypt": the room key is not here yet
            bus.emit(MatrixEventEvent.Decrypted, encrypted);
            await settle();
            expect(currentRingToast()).toBeUndefined();

            encrypted.failed = false; // js-sdk retried when the key arrived
            bus.emit(MatrixEventEvent.Decrypted, encrypted);
            await waitFor(() => expect(currentRingToast()).toBe("clariva_call_$ring"));
            expect(ClarivaCalls.incomingCalls?.rings[0].mediaType).toBe("video");
        });

        it("stops waiting for the keys after the ring cap (90 s), even for a ring with a longer lifetime", async () => {
            jest.useFakeTimers();
            ClarivaCalls.start(client);
            const encrypted = ringEvent("$ring", PEER, { lifetime: 300_000 }, true);
            deliverTimeline(encrypted);
            jest.setSystemTime(Date.now() + 91_000);
            memberships = [membershipEvent(PEER, Date.now() - 1000)];
            encrypted.decrypting = false;
            bus.emit(MatrixEventEvent.Decrypted, encrypted);
            await settle();
            expect(currentRingToast()).toBeUndefined();
        });

        it("does not hold back events of rooms that cannot be a 1:1 chat (more than two active members, or not joined)", async () => {
            ClarivaCalls.start(client);
            roomMembers = { membership: "join", count: 3 };
            const group = ringEvent("$group", PEER, {}, true);
            deliverTimeline(group);
            roomMembers = { membership: "invite", count: 2 };
            const invite = ringEvent("$invite", PEER, {}, true);
            deliverTimeline(invite);

            roomMembers = { membership: "join", count: 2 };
            for (const ev of [group, invite]) {
                ev.decrypting = false;
                bus.emit(MatrixEventEvent.Decrypted, ev);
            }
            await settle();
            expect(currentRingToast()).toBeUndefined();
        });

        it("a decrypted ring of a room that turns out not to be a DM never rings", async () => {
            ClarivaCalls.start(client);
            const encrypted = ringEvent("$ring", PEER, {}, true);
            deliverTimeline(encrypted);
            jest.mocked(getClarivaCallDmPeerId).mockReturnValue(null);
            encrypted.decrypting = false;
            bus.emit(MatrixEventEvent.Decrypted, encrypted);
            await settle();
            expect(currentRingToast()).toBeUndefined();
        });

        it("forgets the events it was holding back when the runtime stops (sign-out)", async () => {
            ClarivaCalls.start(client);
            const encrypted = ringEvent("$ring", PEER, { "m.call.intent": "audio" }, true);
            deliverTimeline(encrypted);
            ClarivaCalls.stop();
            ClarivaCalls.start(client);
            encrypted.decrypting = false;
            bus.emit(MatrixEventEvent.Decrypted, encrypted);
            await settle();
            expect(currentRingToast()).toBeUndefined();
        });

        it("an event is routed once even if it is decrypted twice", async () => {
            ClarivaCalls.start(client);
            const encrypted = ringEvent("$ring", PEER, { "m.call.intent": "audio" }, true);
            deliverTimeline(encrypted);
            encrypted.decrypting = false;
            bus.emit(MatrixEventEvent.Decrypted, encrypted);
            bus.emit(MatrixEventEvent.Decrypted, encrypted);
            deliverTimeline(encrypted); // and re-delivered by the timeline
            await waitFor(() => expect(currentRingToast()).toBeDefined());
            expect(ClarivaCalls.incomingCalls?.rings).toHaveLength(1);
        });
    });

    describe("receiving: my own membership and a caller who is not seen", () => {
        beforeEach(() => {
            installWallet(1);
        });

        it("a membership my crashed tab left behind does not silence the ring", async () => {
            ClarivaCalls.start(client);
            memberships = [membershipEvent(PEER, Date.now() - 1000), membershipEvent(ME, Date.now() - 60 * 60_000)];
            deliverTimeline(ringEvent("$ring", PEER, { "m.call.intent": "audio" }));
            await waitFor(() => expect(currentRingToast()).toBe("clariva_call_$ring"));

            // and a state change while it rings does not end it either
            bus.emit(RoomStateEvent.Events, memberships[1]);
            await settle();
            expect(currentRingToast()).toBe("clariva_call_$ring");
        });

        it("a membership of mine from another device that joined after the ring does", async () => {
            ClarivaCalls.start(client);
            memberships = [membershipEvent(PEER, Date.now() - 1000), membershipEvent(ME, Date.now() + 500)];
            deliverTimeline(ringEvent("$ring", PEER, { "m.call.intent": "audio" }));
            await settle();
            expect(currentRingToast()).toBeUndefined();
        });

        it("a caller who is not in the call after 3 s leaves a missed-call notification instead of vanishing", async () => {
            jest.useFakeTimers();
            ClarivaCalls.start(client);
            memberships = [];
            deliverTimeline(ringEvent("$ring", PEER, { "m.call.intent": "audio" }));
            jest.advanceTimersByTime(3000);
            await settle();
            expect(currentRingToast()).toBeUndefined();
            expect(showCallNotification).toHaveBeenCalledTimes(1);
            expect(showCallNotification).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: "Dr Rao",
                    body: "Missed call",
                    tag: `clariva_missed_${ROOM_ID}`,
                    always: true, // the user never saw a ring: no trace is not an option, focused or not
                }),
            );
            expect(LegacyCallHandler.instance.play).not.toHaveBeenCalled();
        });

        it("a ring cut short by being busy in another call leaves the same trace, focus or not", async () => {
            ClarivaCalls.start(client);
            jest.spyOn(CallStore.instance, "connectedCalls", "get").mockReturnValue(new Set([{}]) as any);
            memberships = [membershipEvent(PEER, Date.now() - 1000)];
            deliverTimeline(ringEvent("$ring", PEER, { "m.call.intent": "audio" }));
            await settle();
            expect(currentRingToast()).toBeUndefined();
            expect(showCallNotification).toHaveBeenCalledWith(
                expect.objectContaining({ body: "Missed call", tag: `clariva_missed_${ROOM_ID}`, always: true }),
            );
        });

        it("a caller who gave up while the Wallet-API was asked is a missed call the user never saw", async () => {
            ClarivaCalls.start(client);
            memberships = [membershipEvent(PEER, Date.now() - 1000)];
            installFakeApi({
                "GET /v1/calls/type": () => {
                    memberships = []; // the caller leaves while the call type is being fetched
                    return mockResponse(200, { callType: "voice" });
                },
            });
            deliverTimeline(ringEvent("$ring", PEER)); // no m.call.intent: the Wallet-API is asked
            await waitFor(() => expect(showCallNotification).toHaveBeenCalled());
            expect(showCallNotification).toHaveBeenCalledWith(
                expect.objectContaining({ body: "Missed call", always: true }),
            );
            expect(currentRingToast()).toBeUndefined();
        });

        it("a ring that WAS on screen and ran out keeps the usual background-only rule (the user saw the toast)", async () => {
            jest.useFakeTimers();
            ClarivaCalls.start(client);
            memberships = [membershipEvent(PEER, Date.now() - 1000)];
            deliverTimeline(ringEvent("$ring", PEER, { "m.call.intent": "audio" }));
            await settle();
            expect(currentRingToast()).toBe("clariva_call_$ring");
            jest.mocked(showCallNotification).mockClear();

            jest.advanceTimersByTime(31_000);
            expect(showCallNotification).toHaveBeenCalledTimes(1);
            expect(showCallNotification).toHaveBeenCalledWith(
                expect.objectContaining({ body: "Missed call", tag: `clariva_missed_${ROOM_ID}`, always: false }),
            );
        });

        it("the live ring's notification still says what it is, and is not forced", async () => {
            ClarivaCalls.start(client);
            memberships = [membershipEvent(PEER, Date.now() - 1000)];
            deliverTimeline(ringEvent("$ring", PEER, { "m.call.intent": "video" }));
            await waitFor(() => expect(showCallNotification).toHaveBeenCalled());
            const options = jest.mocked(showCallNotification).mock.calls[0][0];
            expect(options).toMatchObject({ title: "Dr Rao", body: "Incoming video call", sticky: true });
            expect(options.always).toBeFalsy();
        });

        it("a handler that fails never throws into the SDK's event emitter", () => {
            ClarivaCalls.start(client);
            const broken = ringEvent("$broken", PEER);
            broken.getContent = () => {
                throw new Error("boom");
            };
            expect(() => deliverTimeline(broken)).not.toThrow();
        });
    });

    describe("receiving: being noticed (ringtone, hint, title)", () => {
        beforeEach(() => {
            installWallet(1);
            memberships = [membershipEvent(PEER, Date.now() - 1000)];
            document.title = "Clariva";
        });

        const ringUp = async (id = "$ring"): Promise<void> => {
            deliverTimeline(ringEvent(id, PEER, { "m.call.intent": "audio" }));
            await waitFor(() => expect(ClarivaCalls.incomingCalls?.getRing(id)).toBeDefined());
        };

        it("plays the ringtone; with sound allowed there is no hint", async () => {
            ClarivaCalls.start(client);
            await ringUp();
            expect(LegacyCallHandler.instance.play).toHaveBeenCalledWith("ringAudio");
            expect(isRingSoundBlocked()).toBe(false);
        });

        it("says so while the browser keeps the AudioContext suspended, and stops saying so when the ring ends", async () => {
            jest.mocked(LegacyCallHandler.instance.isAudioBlocked).mockReturnValue(true);
            ClarivaCalls.start(client);
            await ringUp();
            expect(isRingSoundBlocked()).toBe(true);

            await ClarivaCalls.incomingCalls!.reject("$ring");
            expect(isRingSoundBlocked()).toBe(false);
        });

        it("the first gesture resumes the audio, preloads the ring sound and lifts the hint", async () => {
            jest.mocked(LegacyCallHandler.instance.isAudioBlocked).mockReturnValue(true);
            ClarivaCalls.start(client);
            await ringUp();
            expect(isRingSoundBlocked()).toBe(true);

            jest.mocked(LegacyCallHandler.instance.isAudioBlocked).mockReturnValue(false); // resume() will work
            document.dispatchEvent(new Event("pointerdown"));
            await waitFor(() => expect(isRingSoundBlocked()).toBe(false));
            expect(LegacyCallHandler.instance.unlockAudio).toHaveBeenCalledTimes(1);

            // one-shot: once the context runs, the listeners are gone
            document.dispatchEvent(new Event("keydown"));
            document.dispatchEvent(new Event("pointerdown"));
            await settle();
            expect(LegacyCallHandler.instance.unlockAudio).toHaveBeenCalledTimes(1);
        });

        it("keeps listening until a gesture really worked (a bare modifier key does not unlock audio)", async () => {
            jest.mocked(LegacyCallHandler.instance.isAudioBlocked).mockReturnValue(true);
            ClarivaCalls.start(client);
            document.dispatchEvent(new Event("keydown"));
            await settle();
            document.dispatchEvent(new Event("keydown"));
            await settle();
            expect(LegacyCallHandler.instance.unlockAudio).toHaveBeenCalledTimes(2);

            jest.mocked(LegacyCallHandler.instance.isAudioBlocked).mockReturnValue(false);
            document.dispatchEvent(new Event("pointerup"));
            await settle();
            document.dispatchEvent(new Event("pointerup"));
            await settle();
            expect(LegacyCallHandler.instance.unlockAudio).toHaveBeenCalledTimes(3);
        });

        it("listens for pointer and key input in the capture phase while started, and not after stop()", () => {
            const add = jest.spyOn(document, "addEventListener");
            const remove = jest.spyOn(document, "removeEventListener");
            ClarivaCalls.start(client);
            const added = add.mock.calls.filter(([type]) => ["pointerdown", "pointerup", "keydown"].includes(type));
            expect(added.map(([type]) => type).sort()).toEqual(["keydown", "pointerdown", "pointerup"]);
            for (const [, , options] of added) expect(options).toBe(true); // capture

            ClarivaCalls.stop();
            for (const [type, handler] of added) expect(remove).toHaveBeenCalledWith(type, handler, true);
            document.dispatchEvent(new Event("pointerdown"));
            expect(LegacyCallHandler.instance.unlockAudio).not.toHaveBeenCalled();
        });

        it("flashes the page title while a ring is active and restores it exactly when it ends", async () => {
            ClarivaCalls.start(client);
            await ringUp();
            expect(document.title).toBe("(Incoming call) Clariva");

            await ClarivaCalls.incomingCalls!.reject("$ring");
            expect(document.title).toBe("Clariva");
        });

        it("restores the title Element set while it was ringing, not the one from when the ring began", async () => {
            ClarivaCalls.start(client);
            await ringUp();
            document.title = "Clariva [3] | Dr Rao"; // Element updating its unread count
            await ClarivaCalls.incomingCalls!.reject("$ring");
            expect(document.title).toBe("Clariva [3] | Dr Rao");
        });

        it("keeps flashing until the last ring is over", async () => {
            ClarivaCalls.start(client);
            await ringUp("$a");
            await ringUp("$b");
            await ClarivaCalls.incomingCalls!.reject("$a");
            expect(document.title).toBe("(Incoming call) Clariva");
            await ClarivaCalls.incomingCalls!.reject("$b");
            expect(document.title).toBe("Clariva");
        });

        it("an expired ring stops the flashing too", async () => {
            jest.useFakeTimers();
            ClarivaCalls.start(client);
            deliverTimeline(ringEvent("$ring", PEER, { "m.call.intent": "audio" }));
            await settle();
            expect(document.title).toBe("(Incoming call) Clariva");
            jest.advanceTimersByTime(31_000);
            expect(document.title).toBe("Clariva");
        });

        it("stop() while ringing restores the title, silences the sound hint and leaves no timer behind", async () => {
            jest.useFakeTimers();
            jest.mocked(LegacyCallHandler.instance.isAudioBlocked).mockReturnValue(true);
            ClarivaCalls.start(client);
            deliverTimeline(ringEvent("$ring", PEER, { "m.call.intent": "audio" }));
            await settle();
            expect(document.title).toBe("(Incoming call) Clariva");
            expect(isRingSoundBlocked()).toBe(true);
            expect(jest.getTimerCount()).toBeGreaterThan(0);

            ClarivaCalls.stop();
            expect(document.title).toBe("Clariva");
            expect(isRingSoundBlocked()).toBe(false);
            expect(jest.getTimerCount()).toBe(0); // including the late re-check of the sound hint
            expect(mockAudioStateListeners.size).toBe(0);
            expect(LegacyCallHandler.instance.pause).toHaveBeenCalledWith("ringAudio");
            expect(closeCallNotification).toHaveBeenCalledWith("clariva_ring_$ring");
        });

        describe("the sound hint after the ringtone started (the context may resume late)", () => {
            const ringWithTimers = async (id = "$ring"): Promise<void> => {
                jest.useFakeTimers();
                ClarivaCalls.start(client);
                deliverTimeline(ringEvent(id, PEER, { "m.call.intent": "audio" }));
                await settle();
                expect(ClarivaCalls.incomingCalls?.getRing(id)).toBeDefined();
            };

            it("looks again 250 ms after play() resolved: a context that resumed by itself (no gesture) lifts the hint", async () => {
                jest.mocked(LegacyCallHandler.instance.isAudioBlocked).mockReturnValue(true);
                await ringWithTimers();
                expect(isRingSoundBlocked()).toBe(true);

                // the browser let the sound through a moment after source.start(); no state change was reported
                jest.mocked(LegacyCallHandler.instance.isAudioBlocked).mockReturnValue(false);
                jest.advanceTimersByTime(249);
                expect(isRingSoundBlocked()).toBe(true);
                jest.advanceTimersByTime(1);
                expect(isRingSoundBlocked()).toBe(false);
            });

            it("keeps the hint when the context is still suspended at the re-check", async () => {
                jest.mocked(LegacyCallHandler.instance.isAudioBlocked).mockReturnValue(true);
                await ringWithTimers();
                jest.advanceTimersByTime(1000);
                expect(isRingSoundBlocked()).toBe(true);
            });

            it("the re-check does not outlive the ring: ending it leaves no timer and no state listener", async () => {
                jest.mocked(LegacyCallHandler.instance.isAudioBlocked).mockReturnValue(true);
                await ringWithTimers();
                expect(mockAudioStateListeners.size).toBe(1);

                await ClarivaCalls.incomingCalls!.reject("$ring");
                expect(jest.getTimerCount()).toBe(0);
                expect(mockAudioStateListeners.size).toBe(0);
                expect(isRingSoundBlocked()).toBe(false);

                // a late answer from the context changes nothing now
                jest.mocked(LegacyCallHandler.instance.isAudioBlocked).mockReturnValue(true);
                jest.advanceTimersByTime(1000);
                expect(isRingSoundBlocked()).toBe(false);
            });

            it("follows the context's statechange while the ring plays, in both directions", async () => {
                jest.mocked(LegacyCallHandler.instance.isAudioBlocked).mockReturnValue(true);
                ClarivaCalls.start(client);
                deliverTimeline(ringEvent("$ring", PEER, { "m.call.intent": "audio" }));
                await waitFor(() => expect(ClarivaCalls.incomingCalls?.getRing("$ring")).toBeDefined());
                expect(isRingSoundBlocked()).toBe(true);

                jest.mocked(LegacyCallHandler.instance.isAudioBlocked).mockReturnValue(false);
                for (const listener of [...mockAudioStateListeners]) listener();
                expect(isRingSoundBlocked()).toBe(false);

                jest.mocked(LegacyCallHandler.instance.isAudioBlocked).mockReturnValue(true); // suspended again
                for (const listener of [...mockAudioStateListeners]) listener();
                expect(isRingSoundBlocked()).toBe(true);
            });

            it("a ring that ended before play() resolved sets no timer and no hint", async () => {
                jest.useFakeTimers();
                jest.mocked(LegacyCallHandler.instance.isAudioBlocked).mockReturnValue(true);
                let resolvePlay: () => void = () => undefined;
                jest.mocked(LegacyCallHandler.instance.play).mockImplementationOnce(
                    () => new Promise<undefined>((resolve) => (resolvePlay = () => resolve(undefined))) as any,
                );
                ClarivaCalls.start(client);
                deliverTimeline(ringEvent("$ring", PEER, { "m.call.intent": "audio" }));
                await settle();
                await ClarivaCalls.incomingCalls!.reject("$ring");

                resolvePlay();
                await settle();
                expect(LegacyCallHandler.instance.pause).toHaveBeenCalledWith("ringAudio");
                expect(jest.getTimerCount()).toBe(0);
                expect(isRingSoundBlocked()).toBe(false);
            });
        });
    });

    describe("receiving: an accepted ring that cannot be joined", () => {
        const joinFailedToast = (): any =>
            ToastStore.sharedInstance()
                .getToasts()
                .find((t) => t.key === `clariva_call_join_failed_${ROOM_ID}`);

        const ringAndAccept = async (): Promise<void> => {
            ClarivaCalls.start(client);
            memberships = [membershipEvent(PEER, Date.now() - 1000)];
            deliverTimeline(ringEvent("$ring", PEER, { "m.call.intent": "audio" }));
            await waitFor(() => expect(currentRingToast()).toBeDefined());
            create.mockRejectedValueOnce(new Error("widget failed"));
            await ClarivaCalls.incomingCalls!.accept("$ring");
        };

        beforeEach(() => {
            installWallet(1);
        });

        it("shows an error toast with a Join button, and the ring toast is gone", async () => {
            await ringAndAccept();
            expect(currentRingToast()).toBeUndefined();
            const toast = joinFailedToast();
            expect(toast).toBeDefined();
            // it does not read like another ring, and it does not send the user to the (billed) chat path
            expect(toast.title).toBe("Couldn't join the call");
            expect(toast.props.description).toBe("The call is still running.");
            expect(toast.props.primaryLabel).toBe("Try again");
            expect(toast.props.secondaryLabel).toBe("Dismiss");
            // the stylesheet gives it the call sheet material and a coral title icon through this hook
            expect(toast.className).toBe("mx_ClarivaJoinFailedToast");
        });

        it("ranks below a ring, so a new ring is never hidden beneath it", async () => {
            await ringAndAccept();
            expect(joinFailedToast().priority).toBe(90);

            // the caller rings again while the failed-join toast is up
            deliverTimeline(ringEvent("$second", PEER, { "m.call.intent": "video" }));
            await waitFor(() => expect(currentRingToast()).toBe("clariva_call_$second"));
            const toasts = ToastStore.sharedInstance().getToasts();
            expect(toasts[0].key).toBe("clariva_call_$second");
            expect(toasts[0].priority).toBeGreaterThan(joinFailedToast().priority);
        });

        it("Join tries again with the same media type, and removes the toast", async () => {
            await ringAndAccept();
            create.mockClear();
            joinFailedToast().props.onPrimaryClick();
            await settle();
            expect(create).toHaveBeenCalledWith(room, true, "join_existing_dm_voice");
            expect(joinFailedToast()).toBeUndefined();
        });

        it("a retry that fails again puts the toast back", async () => {
            await ringAndAccept();
            create.mockRejectedValueOnce(new Error("still failing"));
            joinFailedToast().props.onPrimaryClick();
            await waitFor(() => expect(joinFailedToast()).toBeDefined());
        });

        it("Join never starts a call of its own: with the call over it only dismisses the toast", async () => {
            await ringAndAccept();
            create.mockClear();
            memberships = []; // the caller hung up
            joinFailedToast().props.onPrimaryClick();
            await settle();
            expect(create).not.toHaveBeenCalled();
            expect(joinFailedToast()).toBeUndefined();
        });

        it("Dismiss removes it", async () => {
            await ringAndAccept();
            joinFailedToast().props.onSecondaryClick();
            expect(joinFailedToast()).toBeUndefined();
        });

        it("the toast goes away by itself when the call ends", async () => {
            await ringAndAccept();
            memberships = [];
            bus.emit(
                RoomStateEvent.Events,
                fakeEvent({
                    id: "$leave",
                    type: "org.matrix.msc3401.call.member",
                    sender: PEER,
                    content: {},
                    stateKey: `_${PEER}_DEV_m.call`,
                }),
            );
            expect(joinFailedToast()).toBeUndefined();
        });

        it("the toast goes away when this tab ends up in the call", async () => {
            await ringAndAccept();
            CallStore.instance.emit(CallStoreEvent.ConnectedCalls, new Set([{ roomId: ROOM_ID }]) as any);
            expect(joinFailedToast()).toBeUndefined();
        });

        it("a room that is no longer a 1:1 chat is reported the same way", async () => {
            ClarivaCalls.start(client);
            memberships = [membershipEvent(PEER, Date.now() - 1000)];
            deliverTimeline(ringEvent("$ring", PEER, { "m.call.intent": "audio" }));
            await waitFor(() => expect(currentRingToast()).toBeDefined());
            jest.mocked(getClarivaCallDmPeerId).mockReturnValue(null);
            await ClarivaCalls.incomingCalls!.accept("$ring");
            expect(create).not.toHaveBeenCalled();
            expect(joinFailedToast()).toBeDefined();
        });

        it("is removed on stop()", async () => {
            await ringAndAccept();
            ClarivaCalls.stop();
            expect(joinFailedToast()).toBeUndefined();
        });
    });

    describe("the peer declines my call", () => {
        const decline = (sender: string, ringId: string): MatrixEvent =>
            fakeEvent({
                id: `$decline-${sender}-${ringId}`,
                type: "org.matrix.msc4310.rtc.decline",
                sender,
                content: { "m.relates_to": { rel_type: "m.reference", event_id: ringId } },
            });
        const route = (ev: MatrixEvent): void => {
            bus.emit(RoomEvent.Timeline, ev, room, false, false, {
                liveEvent: true,
                timeline: { getTimelineSet: () => ({ threadListType: null }) },
            } as any);
        };
        const ownRing = (id: string): MatrixEvent =>
            fakeEvent({ id, type: "org.matrix.msc4075.rtc.notification", sender: ME, content: {} });

        it("hangs up after EC's grace period when it did not leave by itself", async () => {
            installWallet(0);
            await startWallet();
            ClarivaCalls.start(client);
            timeline = [ownRing("$earlier-call")];
            await ClarivaCalls.startCall(room, false);

            // EC sent this call's ring
            timeline = [...timeline, ownRing("$this-call")];
            const disconnect = jest.fn(async () => undefined);
            jest.spyOn(CallStore.instance, "getActiveCall").mockReturnValue({ connected: true, disconnect } as any);

            jest.useFakeTimers();
            route(decline(PEER, "$earlier-call")); // stale decline of the previous call: ignored
            route(decline(ME, "$this-call")); // my own echo: ignored
            jest.advanceTimersByTime(5000);
            expect(disconnect).not.toHaveBeenCalled();

            route(decline(PEER, "$this-call"));
            jest.advanceTimersByTime(1999);
            expect(disconnect).not.toHaveBeenCalled();
            jest.advanceTimersByTime(1);
            expect(disconnect).toHaveBeenCalledTimes(1);
        });

        it("does nothing when EC has already left", async () => {
            installWallet(0);
            await startWallet();
            ClarivaCalls.start(client);
            await ClarivaCalls.startCall(room, true);
            timeline = [ownRing("$this-call")];
            const disconnect = jest.fn(async () => undefined);
            jest.spyOn(CallStore.instance, "getActiveCall").mockReturnValue({ connected: false, disconnect } as any);

            jest.useFakeTimers();
            route(decline(PEER, "$this-call"));
            jest.advanceTimersByTime(5000);
            expect(disconnect).not.toHaveBeenCalled();
        });

        it("a call that joins an existing call arms no watcher", async () => {
            installWallet(0);
            await startWallet();
            ClarivaCalls.start(client);
            memberships = [membershipEvent(PEER, Date.now() - 1000)];
            await ClarivaCalls.startCall(room, false); // a live call: this is a join_existing_dm
            timeline = [ownRing("$this-call")];
            const disconnect = jest.fn(async () => undefined);
            jest.spyOn(CallStore.instance, "getActiveCall").mockReturnValue({ connected: true, disconnect } as any);
            jest.useFakeTimers();
            route(decline(PEER, "$this-call"));
            jest.advanceTimersByTime(5000);
            expect(disconnect).not.toHaveBeenCalled();
        });
    });

    describe("lifecycle", () => {
        it("is dormant unless clariva.features.calls is on", () => {
            configureClariva();
            ClarivaCalls.start(client);
            expect(ClarivaCalls.started).toBe(false);
            expect(ClarivaCalls.incomingCalls).toBeNull();
            expect(client.listenerCount(RoomEvent.Timeline)).toBe(0);
        });

        it("start() is idempotent and stop() removes every listener", () => {
            ClarivaCalls.start(client);
            ClarivaCalls.start(client);
            expect(client.listenerCount(RoomEvent.Timeline)).toBe(1);
            expect(client.listenerCount(RoomStateEvent.Events)).toBe(1);
            expect(client.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);
            expect(client.listenerCount(ClientEvent.Sync)).toBe(1);
            ClarivaCalls.stop();
            expect(client.listenerCount(RoomEvent.Timeline)).toBe(0);
            expect(client.listenerCount(RoomStateEvent.Events)).toBe(0);
            expect(client.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
            expect(client.listenerCount(ClientEvent.Sync)).toBe(0);
            expect(ClarivaCalls.started).toBe(false);
        });

        it("turns on the settings Element's call code reads", () => {
            ClarivaCalls.start(client);
            expect(SdkConfig.get("features")?.feature_group_calls).toBe(true);
            expect(SdkConfig.get("element_call").use_exclusively).toBe(true);
        });
    });
});
