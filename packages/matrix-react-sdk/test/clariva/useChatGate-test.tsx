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
import { act, cleanup, renderHook } from "@testing-library/react-hooks";

import SdkConfig from "../../src/SdkConfig";
import { WalletStore } from "../../src/clariva/stores/WalletStore";
import { ChatGateController } from "../../src/clariva/chat/ChatGateController";
import { getClarivaCallDmPeerId, getClarivaDmPeerId } from "../../src/clariva/chat/dmPeer";
import {
    evaluateChatGate,
    safeCallDmPeerId,
    safeDmPeerId,
    useChatGate,
    useClarivaCallDmPeerId,
    useClarivaCallRestriction,
    useClarivaDmPeerId,
} from "../../src/clariva/chat/useChatGate";
import { CONSULTANT, ME, configureClariva, installFakeApi, mockResponse, walletUser } from "./helpers";

jest.mock("../../src/clariva/chat/dmPeer", () => ({
    getClarivaDmPeerId: jest.fn(),
    getClarivaCallDmPeerId: jest.fn(),
}));

/** The BILLING / GATING peer (m.direct only) and the CALL peer (also an unlisted 1:1 chat). */
const mockPeer = getClarivaDmPeerId as jest.Mock;
const mockCallPeer = getClarivaCallDmPeerId as jest.Mock;
const enc = encodeURIComponent;

class FakeRoom extends EventEmitter {
    public roomId = "!dm:clarivahub.com";
    public currentState = new EventEmitter();
    public client = new EventEmitter();
}

interface ApiState {
    balance: string;
    isConsultant: 0 | 1;
    rate: string;
    peerIsConsultant: 0 | 1;
    exists: boolean | "error";
}

let api: ApiState;
let fetchMock: jest.Mock;

const callsTo = (needle: string): number => fetchMock.mock.calls.filter(([url]) => String(url).includes(needle)).length;

/** Let the (fake) network settle: every fake response is an already-resolved promise. */
const flush = async (): Promise<void> => {
    for (let i = 0; i < 60; i++) await Promise.resolve();
};

function installApi(over: Partial<ApiState> = {}): void {
    api = { balance: "20.00", isConsultant: 0, rate: "50.00", peerIsConsultant: 1, exists: false, ...over };
    fetchMock = installFakeApi({
        [`GET /v1/users/${enc(ME)}`]: () =>
            mockResponse(200, walletUser({ current_hold: api.balance, isConsultant: api.isConsultant })),
        [`GET /v1/users/${enc(CONSULTANT)}`]: () =>
            mockResponse(
                200,
                walletUser({ Webuddy_name: CONSULTANT, max_credits: api.rate, isConsultant: api.peerIsConsultant }),
            ),
        "GET /v1/pending-holds/exists": () =>
            api.exists === "error" ? mockResponse(500, { message: "boom" }) : mockResponse(200, { exists: api.exists }),
        "GET /v1/refund/pending-for-consultant": () => mockResponse(200, { clientIds: [] }),
    });
}

async function startWallet(): Promise<void> {
    WalletStore.instance.start(ME);
    await act(async () => {
        await flush();
    });
}

let hidden = false;
function setHidden(value: boolean): void {
    hidden = value;
    document.dispatchEvent(new Event("visibilitychange"));
}

const render = (room: FakeRoom = new FakeRoom()) => ({
    ...renderHook(() => useChatGate(room as any)),
    room,
});

describe("useChatGate", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        configureClariva();
        WalletStore.resetForTests();
        ChatGateController.resetForTests();
        mockPeer.mockReset().mockReturnValue(CONSULTANT);
        mockCallPeer.mockReset().mockReturnValue(CONSULTANT);
        hidden = false;
        Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
        installApi();
    });

    afterEach(async () => {
        await cleanup(); // unmount hooks BEFORE the stores are torn down (no stray updates outside act)
        ChatGateController.resetForTests();
        WalletStore.resetForTests();
        jest.useRealTimers();
    });

    it("restricts a client without a hold whose balance is below the consultant's price", async () => {
        await startWallet();
        const { result } = render();
        await act(async () => {
            await flush();
        });
        expect(result.current).toMatchObject({
            peerId: CONSULTANT,
            restricted: true,
            reason: "insufficient",
            balance: 20,
            rate: 50,
            holdExists: false,
            role: false,
            peerIsConsultant: true,
        });
    });

    it("fetches the hold state and the rate concurrently, not one after the other (L3)", async () => {
        await startWallet();
        const base = fetchMock.getMockImplementation()!;
        // the hold check never answers: the rate must still have been requested
        fetchMock.mockImplementation((url: string, init: RequestInit) =>
            String(url).includes("pending-holds/exists") ? new Promise(() => {}) : base(url, init),
        );
        fetchMock.mockClear();
        render();
        await act(async () => {
            await flush();
        });
        expect(callsTo("pending-holds/exists")).toBe(1);
        expect(callsTo(`/v1/users/${enc(CONSULTANT)}`)).toBe(1);
    });

    it("an existing hold keeps the chat open whatever the balance", async () => {
        installApi({ exists: true, balance: "0.00" });
        await startWallet();
        const { result } = render();
        await act(async () => {
            await flush();
        });
        expect(result.current).toMatchObject({ restricted: false, reason: "hold-covers", holdExists: true });
    });

    it("a failing hold check is unknown, not 'no hold': the chat stays open (L5)", async () => {
        installApi({ exists: "error", balance: "0.00" });
        await startWallet();
        const { result } = render();
        await act(async () => {
            await flush();
        });
        expect(result.current).toMatchObject({ restricted: false, reason: "hold-unknown", holdExists: null });
    });

    it("with enough credits the composer is open", async () => {
        installApi({ balance: "50.00" });
        await startWallet();
        const { result } = render();
        await act(async () => {
            await flush();
        });
        expect(result.current).toMatchObject({ restricted: false, reason: "sufficient" });
    });

    it("never gates a client-to-client chat (D5), nor an unknown peer role", async () => {
        installApi({ peerIsConsultant: 0, rate: "50.00" });
        await startWallet();
        const { result } = render();
        await act(async () => {
            await flush();
        });
        expect(result.current).toMatchObject({
            restricted: false,
            reason: "peer-not-billable",
            peerIsConsultant: false,
        });
    });

    it("consultants are never gated and skip the hold / rate lookups entirely (L6)", async () => {
        installApi({ isConsultant: 1 });
        await startWallet();
        fetchMock.mockClear();
        const { result } = render();
        await act(async () => {
            await flush();
        });
        expect(result.current).toMatchObject({ restricted: false, reason: "consultant" });
        expect(callsTo("pending-holds/exists")).toBe(0);
        expect(callsTo(`/v1/users/${enc(CONSULTANT)}`)).toBe(0);
        await act(async () => {
            jest.advanceTimersByTime(180_000);
            await flush();
        });
        expect(callsTo("pending-holds/exists")).toBe(0); // and no 60 s loop
    });

    it("non-DM rooms are never gated and trigger no requests", async () => {
        mockPeer.mockReturnValue(null);
        await startWallet();
        fetchMock.mockClear();
        const { result } = render();
        await act(async () => {
            await flush();
        });
        expect(result.current).toMatchObject({ peerId: null, restricted: false, reason: "no-peer" });
        expect(callsTo("pending-holds")).toBe(0);
        expect(callsTo(`/v1/users/${enc(CONSULTANT)}`)).toBe(0);
    });

    it("is completely dormant when Clariva is not configured", async () => {
        SdkConfig.reset();
        fetchMock = installFakeApi({});
        const { result } = render();
        await act(async () => {
            await flush();
        });
        expect(result.current.restricted).toBe(false);
        expect(result.current.peerId).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(evaluateChatGate(new FakeRoom() as any).restricted).toBe(false);
    });

    it("an unknown role (balance not loaded yet) does not restrict", async () => {
        fetchMock = installFakeApi({
            [`GET /v1/users/${enc(ME)}`]: () => new Promise<Response>(() => {}),
            [`GET /v1/users/${enc(CONSULTANT)}`]: () =>
                mockResponse(200, walletUser({ max_credits: "50.00", isConsultant: 1 })),
            "GET /v1/pending-holds/exists": () => mockResponse(200, { exists: false }),
        });
        WalletStore.instance.start(ME);
        const { result } = render();
        await act(async () => {
            await flush();
        });
        expect(result.current).toMatchObject({ restricted: false, reason: "role-unknown", role: null });
    });

    describe("first paint is seeded from the WalletStore caches (spec 03 §3.2)", () => {
        it("a re-opened chat is restricted on the very first render, before any request resolves", async () => {
            await startWallet();
            await WalletStore.instance.checkHoldExists(CONSULTANT);
            await WalletStore.instance.getPeer(CONSULTANT);
            ChatGateController.resetForTests();

            const { result } = render();
            expect(result.all[0]).toMatchObject({ restricted: true, balance: 20, rate: 50, holdExists: false });
        });
    });

    describe("revalidation assigns directly (L2)", () => {
        it("a failed re-check clears a stale cached `false` instead of leaving a paid client restricted", async () => {
            await startWallet();
            await WalletStore.instance.checkHoldExists(CONSULTANT); // cache: false
            await WalletStore.instance.getPeer(CONSULTANT);
            api.exists = "error"; // the client has actually paid, but the re-check blips

            const { result } = render();
            expect(result.all[0]).toMatchObject({ restricted: true }); // stale seed...
            await act(async () => {
                await flush();
            });
            expect(result.current).toMatchObject({ restricted: false, holdExists: null }); // ...cleared by the re-check
        });
    });

    describe("polling (confirmed clients only, never faster than gate_ms, paused while hidden)", () => {
        it("re-polls every 60 s and picks up a recharge", async () => {
            await startWallet();
            const { result } = render();
            await act(async () => {
                await flush();
            });
            expect(result.current.restricted).toBe(true);
            const before = callsTo("pending-holds/exists");

            api.balance = "80.00";
            await act(async () => {
                jest.advanceTimersByTime(59_000);
                await flush();
            });
            expect(callsTo("pending-holds/exists")).toBe(before); // not faster than 60 s

            await act(async () => {
                jest.advanceTimersByTime(2_000);
                await flush();
            });
            expect(callsTo("pending-holds/exists")).toBe(before + 1);
            expect(result.current).toMatchObject({ restricted: false, balance: 80 });
        });

        it("does not poll while the tab is hidden and refreshes when it becomes visible again", async () => {
            await startWallet();
            render();
            await act(async () => {
                await flush();
            });
            const before = callsTo("pending-holds/exists");
            act(() => setHidden(true));
            await act(async () => {
                jest.advanceTimersByTime(300_000);
                await flush();
            });
            expect(callsTo("pending-holds/exists")).toBe(before);

            await act(async () => {
                setHidden(false);
                await flush();
            });
            expect(callsTo("pending-holds/exists")).toBe(before + 1);
        });

        it("the loop is keyed on the ROLE: it starts once a client is confirmed", async () => {
            let release!: () => void;
            fetchMock = installFakeApi({
                [`GET /v1/users/${enc(ME)}`]: () =>
                    new Promise<Response>(
                        (resolve) =>
                            (release = () =>
                                resolve(mockResponse(200, walletUser({ current_hold: "20.00", isConsultant: 0 })))),
                    ),
                [`GET /v1/users/${enc(CONSULTANT)}`]: () =>
                    mockResponse(200, walletUser({ max_credits: "50.00", isConsultant: 1 })),
                "GET /v1/pending-holds/exists": () => mockResponse(200, { exists: false }),
            });
            WalletStore.instance.start(ME);
            render();
            await act(async () => {
                await flush();
            });
            const afterOpen = callsTo("pending-holds/exists");
            await act(async () => {
                jest.advanceTimersByTime(60_000);
                await flush();
            });
            expect(callsTo("pending-holds/exists")).toBe(afterOpen); // role unknown: no loop yet

            await act(async () => {
                release();
                await flush();
            });
            await act(async () => {
                jest.advanceTimersByTime(61_000);
                await flush();
            });
            expect(callsTo("pending-holds/exists")).toBeGreaterThan(afterOpen);
        });

        it("two components on the same chat (composer + header) share one controller and one poll", async () => {
            await startWallet();
            fetchMock.mockClear();
            const room = new FakeRoom();
            render(room);
            render(room);
            await act(async () => {
                await flush();
            });
            expect(callsTo("pending-holds/exists")).toBe(1);
            await act(async () => {
                jest.advanceTimersByTime(61_000);
                await flush();
            });
            expect(callsTo("pending-holds/exists")).toBe(2);
        });

        it("stops everything on unmount", async () => {
            await startWallet();
            const { unmount } = render();
            await act(async () => {
                await flush();
            });
            unmount();
            expect(ChatGateController.peek(CONSULTANT)).toBeUndefined();
            const before = callsTo("pending-holds/exists");
            await act(async () => {
                jest.advanceTimersByTime(300_000);
                await flush();
            });
            expect(callsTo("pending-holds/exists")).toBe(before);
        });
    });

    describe("peer detection follows the room", () => {
        it("re-evaluates when m.direct changes (a DM that was not recognised yet)", async () => {
            mockPeer.mockReturnValue(null);
            await startWallet();
            const { result, room } = render();
            await act(async () => {
                await flush();
            });
            expect(result.current.peerId).toBeNull();

            mockPeer.mockReturnValue(CONSULTANT);
            await act(async () => {
                room.client.emit("accountData", { getType: () => "m.direct" });
                await flush();
            });
            expect(result.current).toMatchObject({ peerId: CONSULTANT, restricted: true });
        });

        it("ignores other account data", async () => {
            mockPeer.mockReturnValue(null);
            await startWallet();
            const { result, room } = render();
            mockPeer.mockReturnValue(CONSULTANT);
            act(() => {
                room.client.emit("accountData", { getType: () => "m.push_rules" });
            });
            expect(result.current.peerId).toBeNull();
        });

        it("never throws when the DM map is not ready", async () => {
            mockPeer.mockImplementation(() => {
                throw new TypeError("DMRoomMap is undefined");
            });
            const { result } = render();
            expect(result.current.restricted).toBe(false);
        });
    });

    describe("useClarivaCallRestriction (consumed by the call buttons)", () => {
        it("is the same decision: true only while the composer bar is shown", async () => {
            await startWallet();
            const room = new FakeRoom();
            const { result } = renderHook(() => useClarivaCallRestriction(room as any));
            await act(async () => {
                await flush();
            });
            expect(result.current).toBe(true);

            api.exists = true;
            await act(async () => {
                jest.advanceTimersByTime(61_000);
                await flush();
            });
            expect(result.current).toBe(false); // a covering hold keeps calls available
        });

        it("is false for rooms without a peer, and for null rooms", () => {
            mockPeer.mockReturnValue(null);
            mockCallPeer.mockReturnValue(null);
            expect(renderHook(() => useClarivaCallRestriction(new FakeRoom() as any)).result.current).toBe(false);
            expect(renderHook(() => useClarivaCallRestriction(null)).result.current).toBe(false);
        });

        it("judges the room by its CALL peer: a call room m.direct does not list still hides the buttons of a client who cannot pay", async () => {
            mockPeer.mockReturnValue(null); // not a billed DM: no composer bar...
            mockCallPeer.mockReturnValue(CONSULTANT); // ...but a 1:1 call room
            await startWallet();
            const room = new FakeRoom();
            const gate = renderHook(() => useChatGate(room as any));
            const calls = renderHook(() => useClarivaCallRestriction(room as any));
            await act(async () => {
                await flush();
            });
            expect(gate.result.current).toMatchObject({ peerId: null, restricted: false, reason: "no-peer" });
            expect(calls.result.current).toBe(true);
        });

        it("and not by the billing peer: a room that is no call room has no call restriction", async () => {
            mockPeer.mockReturnValue(CONSULTANT);
            mockCallPeer.mockReturnValue(null);
            await startWallet();
            const room = new FakeRoom();
            const calls = renderHook(() => useClarivaCallRestriction(room as any));
            await act(async () => {
                await flush();
            });
            expect(calls.result.current).toBe(false);
        });
    });

    describe("the two peers (billing / gating vs. calls)", () => {
        it("safeDmPeerId and safeCallDmPeerId each ask their own helper, and neither ever throws", () => {
            mockPeer.mockReturnValue("@billing:clarivahub.com");
            mockCallPeer.mockReturnValue("@call:clarivahub.com");
            expect(safeDmPeerId({} as any)).toBe("@billing:clarivahub.com");
            expect(safeCallDmPeerId({} as any)).toBe("@call:clarivahub.com");

            mockPeer.mockImplementation(() => {
                throw new Error("DMRoomMap is undefined");
            });
            mockCallPeer.mockImplementation(() => {
                throw new Error("boom");
            });
            expect(safeDmPeerId({} as any)).toBeNull();
            expect(safeCallDmPeerId({} as any)).toBeNull();
        });

        it("the hooks follow their own helper and both re-evaluate when m.direct changes", () => {
            mockPeer.mockReturnValue(null);
            mockCallPeer.mockReturnValue(CONSULTANT);
            const room = new FakeRoom();
            const billing = renderHook(() => useClarivaDmPeerId(room as any));
            const calls = renderHook(() => useClarivaCallDmPeerId(room as any));
            expect(billing.result.current).toBeNull();
            expect(calls.result.current).toBe(CONSULTANT);

            mockPeer.mockReturnValue(CONSULTANT); // m.direct arrived and lists the room
            act(() => {
                room.client.emit("accountData", { getType: () => "m.direct" });
            });
            expect(billing.result.current).toBe(CONSULTANT);
            expect(calls.result.current).toBe(CONSULTANT);
        });

        it("both are null while Clariva is disabled (stock rooms are never touched)", () => {
            expect(renderHook(() => useClarivaCallDmPeerId(new FakeRoom() as any)).result.current).toBe(CONSULTANT);
            SdkConfig.reset(); // not a Clariva build
            expect(renderHook(() => useClarivaCallDmPeerId(new FakeRoom() as any)).result.current).toBeNull();
            expect(renderHook(() => useClarivaDmPeerId(new FakeRoom() as any)).result.current).toBeNull();
        });
    });

    describe("evaluateChatGate (non-React guards: forward, drag and drop)", () => {
        it("uses what is known right now and fails open on anything unknown", async () => {
            const room = new FakeRoom();
            expect(evaluateChatGate(room as any).restricted).toBe(false); // nothing known
            await startWallet();
            expect(evaluateChatGate(room as any).restricted).toBe(false); // no hold / rate known yet
            await WalletStore.instance.checkHoldExists(CONSULTANT);
            await WalletStore.instance.getPeer(CONSULTANT);
            expect(evaluateChatGate(room as any).restricted).toBe(true);
        });
    });
});
