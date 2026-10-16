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

import { WalletStore, WalletStoreEvent } from "../../src/clariva/stores/WalletStore";
import { CLIENT, CONSULTANT, ME, configureClariva, installFakeApi, mockResponse, walletUser } from "./helpers";

const enc = encodeURIComponent;

/** Let pending microtasks (the fire-and-forget refresh in start()) settle. */
const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("WalletStore", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        configureClariva();
        WalletStore.resetForTests();
    });

    afterEach(() => {
        WalletStore.resetForTests();
        jest.useRealTimers();
    });

    describe("own balance / role", () => {
        it("loads balance, price and role; keeps decimals; flags loaded", async () => {
            installFakeApi({
                [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser({ current_hold: "1195.50", max_credits: "100.00", isConsultant: 1 })),
                "GET /v1/refund/pending-for-consultant": () => mockResponse(200, { clientIds: [CLIENT] }),
            });
            const store = WalletStore.instance;
            store.start(ME);
            await settle();
            expect(store.credits).toBe(1195.5);
            expect(store.maxCredits).toBe(100);
            expect(store.isConsultant).toBe(true);
            expect(store.loaded).toBe(true);
            expect([...store.pendingRefundClients]).toEqual([CLIENT]);
        });

        it("seeds the role from the login response, and the server answer wins", async () => {
            installFakeApi({ [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser({ isConsultant: 0 })) });
            const store = WalletStore.instance;
            store.start(ME, { isConsultant: true });
            expect(store.isConsultant).toBe(true);
            await settle();
            expect(store.isConsultant).toBe(false);
        });

        it("L9: a failed or unparseable refresh never clobbers the last good value and never invents 0/100", async () => {
            let body: unknown = walletUser({ current_hold: "75.00" });
            let status = 200;
            installFakeApi({ [`GET /v1/users/${enc(ME)}`]: () => mockResponse(status, body) });
            const store = WalletStore.instance;
            store.start(ME);
            await settle();
            expect(store.credits).toBe(75);

            body = { current_hold: null, max_credits: "garbage" };
            await store.refreshBalance();
            expect(store.credits).toBe(75);

            status = 500;
            body = { message: "boom" };
            await store.refreshBalance();
            expect(store.credits).toBe(75);
            expect(store.maxCredits).toBe(0);
        });

        it("starts with unknown (null), not 0, while nothing has loaded", () => {
            installFakeApi({ [`GET /v1/users/${enc(ME)}`]: () => new Promise<Response>(() => {}) });
            WalletStore.instance.start(ME);
            expect(WalletStore.instance.credits).toBeNull();
            expect(WalletStore.instance.isConsultant).toBeNull();
            expect(WalletStore.instance.loaded).toBe(false);
        });

        it("single-flights concurrent refreshes", async () => {
            const fetchMock = installFakeApi({ [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser()) });
            const store = WalletStore.instance;
            store.start(ME);
            await Promise.all([store.refreshBalance(), store.refreshBalance(), store.refreshBalance()]);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("404 → one provisioning attempt (isConsultant always sent) → one retry", async () => {
            let created = false;
            const fetchMock = installFakeApi({
                [`GET /v1/users/${enc(ME)}`]: () => (created ? mockResponse(200, walletUser()) : mockResponse(404, { message: "User not found" })),
                "POST /v1/users": (_url, init) => {
                    created = true;
                    expect(JSON.parse(String(init.body))).toEqual({ name: ME, Webuddy_name: ME, isConsultant: 0 });
                    return mockResponse(201, walletUser());
                },
            });
            const store = WalletStore.instance;
            store.start(ME);
            await settle();
            await settle();
            expect(store.credits).toBe(120);
            expect(fetchMock.mock.calls.filter(([, i]) => (i as RequestInit).method === "POST")).toHaveLength(1);
        });

        it("ignores a provisioning answer for a different Matrix ID (orphan-row guard)", async () => {
            installFakeApi({
                [`GET /v1/users/${enc(ME)}`]: () => mockResponse(404, { message: "nope" }),
                "POST /v1/users": () => mockResponse(201, walletUser({ matrixUserId: "@some-uuid:clarivahub.com" })),
            });
            const store = WalletStore.instance;
            store.start(ME);
            await settle();
            await settle();
            expect(store.credits).toBeNull();
        });

        it("B6: switching user flushes balance, role and caches", async () => {
            installFakeApi({
                [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser({ current_hold: "50.00", isConsultant: 1 })),
                [`GET /v1/users/${enc(CLIENT)}`]: () => new Promise<Response>(() => {}),
                "GET /v1/refund/pending-for-consultant": () => mockResponse(200, { clientIds: [CLIENT] }),
            });
            const store = WalletStore.instance;
            store.start(ME);
            await settle();
            expect(store.credits).toBe(50);
            store.start(CLIENT);
            expect(store.credits).toBeNull();
            expect(store.isConsultant).toBeNull();
            expect(store.pendingRefundClients.size).toBe(0);
        });
    });

    describe("peers", () => {
        it("fetches a peer's price and role, caches within the TTL and never touches own state (L8)", async () => {
            const fetchMock = installFakeApi({
                [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser({ max_credits: "10.00" })),
                [`GET /v1/users/${enc(CONSULTANT)}`]: () => mockResponse(200, walletUser({ Webuddy_name: CONSULTANT, max_credits: "100.00", isConsultant: 1 })),
            });
            const store = WalletStore.instance;
            store.start(ME);
            await settle();
            const peer = await store.getPeer(CONSULTANT);
            expect(peer).toMatchObject({ maxCredits: 100, isConsultant: true });
            expect(store.maxCredits).toBe(10); // own price untouched

            await store.getPeer(CONSULTANT);
            expect(fetchMock.mock.calls.filter(([u]) => String(u).includes(enc(CONSULTANT)))).toHaveLength(1);

            jest.advanceTimersByTime(61_000);
            await store.getPeer(CONSULTANT);
            expect(fetchMock.mock.calls.filter(([u]) => String(u).includes(enc(CONSULTANT)))).toHaveLength(2);
        });

        it("room-list rate is only shown for consultants", async () => {
            installFakeApi({
                [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser()),
                [`GET /v1/users/${enc(CONSULTANT)}`]: () => mockResponse(200, walletUser({ max_credits: "100.00", isConsultant: 1 })),
                [`GET /v1/users/${enc(CLIENT)}`]: () => mockResponse(200, walletUser({ max_credits: "100.00", isConsultant: 0 })),
            });
            const store = WalletStore.instance;
            store.start(ME);
            expect(await store.getConsultantRate(CONSULTANT)).toBe(100);
            expect(await store.getConsultantRate(CLIENT)).toBeNull();
        });

        it("a peer without a wallet row is looked up once, then backed off", async () => {
            const fetchMock = installFakeApi({
                [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser()),
                [`GET /v1/users/${enc("@bridge:other.org")}`]: () => mockResponse(404, { message: "nope" }),
            });
            const store = WalletStore.instance;
            store.start(ME);
            expect(await store.getPeer("@bridge:other.org")).toBeNull();
            expect(await store.getPeer("@bridge:other.org")).toBeNull();
            expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("bridge"))).toHaveLength(1);
        });
    });

    describe("holds", () => {
        it("checkHoldExists returns null (unknown) on error — never false (L5) — and caches successes", async () => {
            let fail = false;
            installFakeApi({
                [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser()),
                "GET /v1/pending-holds/exists": () => (fail ? mockResponse(500, { message: "x" }) : mockResponse(200, { exists: true })),
            });
            const store = WalletStore.instance;
            store.start(ME);
            expect(store.getCachedHoldExists(CONSULTANT)).toBeUndefined();
            expect(await store.checkHoldExists(CONSULTANT)).toBe(true);
            expect(store.getCachedHoldExists(CONSULTANT)).toBe(true);
            fail = true;
            expect(await store.checkHoldExists(CONSULTANT)).toBeNull();
        });

        it("initiateHold: payer = me, payee = peer; success sets the cache", async () => {
            const fetchMock = installFakeApi({
                [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser()),
                "POST /v1/pending-holds/initiate": () => mockResponse(201, { id: 1 }),
            });
            const store = WalletStore.instance;
            store.start(ME);
            await settle();
            expect(await store.initiateHold(CONSULTANT)).toEqual({ ok: true, skipped: false });
            expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body))).toEqual({ clientId: ME, consultantId: CONSULTANT });
            expect(store.getCachedHoldExists(CONSULTANT)).toBe(true);
        });

        it("initiateHold is a no-op for consultants (they never pay)", async () => {
            const fetchMock = installFakeApi({ [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser({ isConsultant: 1 })), "GET /v1/refund/pending-for-consultant": () => mockResponse(200, { clientIds: [] }) });
            const store = WalletStore.instance;
            store.start(ME);
            await settle();
            expect(await store.initiateHold(CLIENT)).toEqual({ ok: true, skipped: true });
            expect(fetchMock.mock.calls.some(([u]) => String(u).includes("initiate"))).toBe(false);
        });

        it("initiateHold failure drops the cache entry and classifies insufficient credits / network", async () => {
            let mode: "insufficient" | "network" = "insufficient";
            installFakeApi({
                [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser()),
                "GET /v1/pending-holds/exists": () => mockResponse(200, { exists: true }),
                "POST /v1/pending-holds/initiate": () => {
                    if (mode === "network") throw new TypeError("Failed to fetch");
                    return mockResponse(400, { message: "Insufficient credits: need 100, have 20. Please recharge to start this chat." });
                },
            });
            const store = WalletStore.instance;
            store.start(ME);
            await settle();
            await store.checkHoldExists(CONSULTANT);
            expect(store.getCachedHoldExists(CONSULTANT)).toBe(true);

            const r1 = await store.initiateHold(CONSULTANT);
            expect(r1).toMatchObject({ ok: false, status: 400, insufficientCredits: true, isNetwork: false });
            expect(store.getCachedHoldExists(CONSULTANT)).toBeUndefined();

            mode = "network";
            const r2 = await store.initiateHold(CONSULTANT);
            expect(r2).toMatchObject({ ok: false, status: 0, insufficientCredits: false, isNetwork: true });
        });

        it("single-flights initiate per pair (two quick first sends cannot double-charge)", async () => {
            let calls = 0;
            installFakeApi({
                [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser()),
                "POST /v1/pending-holds/initiate": async () => {
                    calls++;
                    await new Promise((r) => setTimeout(r, 50));
                    return mockResponse(201, {});
                },
            });
            const store = WalletStore.instance;
            store.start(ME);
            await settle();
            const a = store.initiateHold(CONSULTANT);
            const b = store.initiateHold(CONSULTANT);
            await jest.advanceTimersByTimeAsync(60);
            await Promise.all([a, b]);
            expect(calls).toBe(1);
        });
    });

    describe("consultant refund pills", () => {
        it("keeps the previous set when a refresh fails and emits only on real changes", async () => {
            let ids: string[] | "error" = [CLIENT];
            installFakeApi({
                [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser({ isConsultant: 1 })),
                "GET /v1/refund/pending-for-consultant": () => (ids === "error" ? mockResponse(500, {}) : mockResponse(200, { clientIds: ids })),
            });
            const store = WalletStore.instance;
            const changes = jest.fn();
            store.on(WalletStoreEvent.PendingRefunds, changes);
            store.start(ME);
            await settle();
            await settle();
            expect([...store.pendingRefundClients]).toEqual([CLIENT]);
            const emitted = changes.mock.calls.length;

            await store.refreshPendingRefunds(); // same set → no event
            expect(changes).toHaveBeenCalledTimes(emitted);

            ids = "error";
            await store.refreshPendingRefunds();
            expect([...store.pendingRefundClients]).toEqual([CLIENT]);

            ids = [];
            await store.refreshPendingRefunds();
            expect(store.pendingRefundClients.size).toBe(0);
        });
    });

    describe("polling", () => {
        it("polls at the configured cadence, never faster than the floor, and pauses while hidden", async () => {
            configureClariva({ polling: { balance_ms: 1000 } }); // clamped to the 5 s floor
            const fetchMock = installFakeApi({ [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser()) });
            const store = WalletStore.instance;
            store.start(ME);
            await settle();
            expect(fetchMock).toHaveBeenCalledTimes(1);

            await jest.advanceTimersByTimeAsync(4_900);
            expect(fetchMock).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(200);
            expect(fetchMock).toHaveBeenCalledTimes(2);

            Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
            document.dispatchEvent(new Event("visibilitychange"));
            await jest.advanceTimersByTimeAsync(60_000);
            expect(fetchMock).toHaveBeenCalledTimes(2);

            Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
            document.dispatchEvent(new Event("visibilitychange")); // refreshes immediately on return
            await settle();
            expect(fetchMock).toHaveBeenCalledTimes(3);
        });

        it("stop() cancels everything", async () => {
            const fetchMock = installFakeApi({ [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser()) });
            const store = WalletStore.instance;
            store.start(ME);
            await settle();
            store.stop();
            await jest.advanceTimersByTimeAsync(120_000);
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(store.credits).toBeNull();
            expect(store.userId).toBeNull();
        });
    });

    describe("recharge + history", () => {
        it("createOrder self-heals one 404; verifyPayment applies a numeric or string newBalance", async () => {
            let orders = 0;
            installFakeApi({
                [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser()),
                "POST /v1/wallet/recharge": () => {
                    orders++;
                    return orders === 1 ? mockResponse(404, { message: "User not found" }) : mockResponse(201, { keyId: "rzp_test_x", orderId: "order_1", amountInPaise: 50000, currency: "INR", transactionId: "7" });
                },
                "POST /v1/users": () => mockResponse(201, walletUser()),
                "POST /v1/wallet/verify": () => mockResponse(201, { success: true, newBalance: "620.00", transactionId: "7" }),
            });
            const store = WalletStore.instance;
            store.start(ME);
            await settle();
            const order = await store.createOrder(500);
            expect(order.orderId).toBe("order_1");
            expect(orders).toBe(2);

            const res = await store.verifyPayment({ transactionId: "7", razorpay_order_id: "order_1", razorpay_payment_id: "pay_1", razorpay_signature: "sig" });
            expect(res.success).toBe(true);
            expect(store.credits).toBe(620);
        });

        it("history clamps paging inputs to sane integers", async () => {
            const fetchMock = installFakeApi({
                [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser()),
                "GET /v1/wallet/history": () => mockResponse(200, { data: [], page: 1, pageSize: 10, totalPages: 0 }),
            });
            const store = WalletStore.instance;
            store.start(ME);
            await settle();
            await store.getHistory(-3, 2);
            const url = new URL(String(fetchMock.mock.calls.at(-1)![0]));
            expect(url.searchParams.get("page")).toBe("1");
            expect(url.searchParams.get("pageSize")).toBe("10");
            expect(url.searchParams.get("userId")).toBe(ME);
        });
    });
});
