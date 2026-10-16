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

import { ClarivaHttpError } from "../../src/clariva/api/http";
import {
    VERIFY_ATTEMPTS,
    describeOrderError,
    recoverPendingPayments,
    resetRecoveryForTests,
} from "../../src/clariva/wallet/rechargeFlow";
import { onLedgerChanged } from "../../src/clariva/wallet/walletBus";
import { ME } from "./helpers";
import { FakeRazorpay, harness, type Harness } from "./rechargeHarness";

/** Let promise chains (several awaits deep) settle. */
const settle = async (ticks = 60): Promise<void> => {
    for (let i = 0; i < ticks; i++) await Promise.resolve();
};

describe("RechargeFlow (spec 02 section 3.5 / 6.4)", () => {
    beforeEach(() => {
        FakeRazorpay.last = undefined;
        FakeRazorpay.all = [];
        FakeRazorpay.onOpen = undefined;
        resetRecoveryForTests();
    });

    it("creates ONE order, persists it, opens Razorpay with the documented options, verifies and succeeds", async () => {
        const h = harness();
        const ledger = jest.fn();
        const off = onLedgerChanged(ledger);

        // the order must be in storage BEFORE the checkout opens (a reload mid-payment can then recover it)
        h.loadCheckout.mockImplementation(async () => {
            expect(h.deps.pending.get(ME, "order_ABC")).toMatchObject({ transactionId: "164", amount: 500 });
            return FakeRazorpay as never;
        });

        await h.flow.submit("500");
        expect(h.createOrder).toHaveBeenCalledWith(500);
        expect(h.flow.state.phase).toBe("checkoutOpen");

        const rzp = FakeRazorpay.last!;
        expect(rzp.open).toHaveBeenCalledTimes(1);
        expect(rzp.options).toMatchObject({
            key: "rzp_test_abc",
            order_id: "order_ABC",
            amount: 50000,
            currency: "INR",
            name: "Clariva",
            description: "Wallet Recharge",
            theme: { color: "#00BFA5" },
        });
        expect(typeof rzp.options.handler).toBe("function");
        expect(typeof rzp.options.modal.ondismiss).toBe("function");
        expect(typeof rzp.handlers["payment.failed"]).toBe("function");

        rzp.succeed();
        await settle();

        expect(h.verifyPayment).toHaveBeenCalledTimes(1);
        expect(h.verifyPayment).toHaveBeenCalledWith({
            transactionId: "164",
            razorpay_order_id: "order_ABC",
            razorpay_payment_id: "pay_123",
            razorpay_signature: "sig_456",
        });
        expect(h.flow.state).toMatchObject({ phase: "success", newBalance: 620 });
        expect(h.deps.pending.list(ME)).toEqual([]); // cleaned up
        expect(h.refreshBalance).toHaveBeenCalled();
        expect(ledger).toHaveBeenCalled();
        off();
    });

    it("accepts newBalance as a DECIMAL string (the idempotent verify branch)", async () => {
        const h = harness();
        h.verifyPayment.mockResolvedValue({ success: true, newBalance: "250.00", transactionId: 164 });
        await h.flow.submit(500);
        FakeRazorpay.last!.succeed();
        await settle();
        expect(h.flow.state).toMatchObject({ phase: "success", newBalance: 250 });
    });

    it("falls back to the store's balance when verify reports no usable newBalance", async () => {
        const h = harness();
        h.verifyPayment.mockResolvedValue({ success: true, newBalance: "n/a" });
        await h.flow.submit(500);
        FakeRazorpay.last!.succeed();
        await settle();
        expect(h.flow.state).toMatchObject({ phase: "success", newBalance: 620 }); // currentCredits()
    });

    it("guards double clicks: two quick submits create a single order", async () => {
        const h = harness();
        await Promise.all([h.flow.submit(500), h.flow.submit(500)]);
        expect(h.createOrder).toHaveBeenCalledTimes(1);
        await h.flow.submit(500); // still in checkoutOpen: ignored
        expect(h.createOrder).toHaveBeenCalledTimes(1);
        expect(FakeRazorpay.all).toHaveLength(1);
    });

    it("ignores an invalid amount without calling the API", async () => {
        const h = harness();
        await h.flow.submit("0");
        await h.flow.submit("100001");
        await h.flow.submit("abc");
        expect(h.createOrder).not.toHaveBeenCalled();
        expect(h.flow.state.phase).toBe("idle");
    });

    it("closing the checkout without paying is a silent cancel and the user can start over", async () => {
        const h = harness();
        await h.flow.submit(500);
        FakeRazorpay.last!.options.modal.ondismiss();
        expect(h.flow.state).toMatchObject({ phase: "cancelled", error: null });
        expect(h.verifyPayment).not.toHaveBeenCalled();

        await h.flow.submit(100);
        expect(h.createOrder).toHaveBeenCalledTimes(2);
        expect(h.flow.state.phase).toBe("checkoutOpen");
    });

    it("payment.failed keeps the window open; closing it afterwards reports the failure", async () => {
        const h = harness();
        await h.flow.submit(500);
        FakeRazorpay.last!.handlers["payment.failed"]({ error: { description: "Your card was declined" } });
        expect(h.flow.state).toMatchObject({ phase: "checkoutOpen", error: "Recharge failed: Your card was declined" });
        FakeRazorpay.last!.options.modal.ondismiss();
        expect(h.flow.state).toMatchObject({ phase: "failed", error: "Recharge failed: Your card was declined" });
    });

    it("a payment that succeeds after payment.failed is verified", async () => {
        const h = harness();
        await h.flow.submit(500);
        FakeRazorpay.last!.handlers["payment.failed"]({ error: { description: "declined" } });
        FakeRazorpay.last!.succeed();
        await settle();
        expect(h.flow.state.phase).toBe("success");
    });

    it("order creation errors show the server's own message", async () => {
        const h = harness();
        h.createOrder.mockRejectedValue(new ClarivaHttpError(404, "User not found", "http", "User not found"));
        await h.flow.submit(500);
        expect(h.flow.state).toMatchObject({ phase: "failed", error: "Recharge failed: User not found" });
        expect(h.deps.pending.list(ME)).toEqual([]);
        expect(FakeRazorpay.last).toBeUndefined();
    });

    it("describeOrderError separates network trouble from a refusal and from programming errors", () => {
        expect(describeOrderError(new ClarivaHttpError(0, "Failed to fetch", "network"))).toBe(
            "Recharge failed: Network error starting the payment.",
        );
        expect(
            describeOrderError(new ClarivaHttpError(400, "HTTP 400", "http", "amount must not be greater than 100000")),
        ).toBe("Recharge failed: amount must not be greater than 100000");
        expect(describeOrderError(new ClarivaHttpError(502, "HTTP 502 Bad Gateway", "http"))).toBe(
            "Recharge failed: HTTP 502 Bad Gateway",
        );
        expect(describeOrderError(new TypeError("x"))).toBe(
            "Recharge failed: Couldn’t start the payment. Please try again.",
        );
    });

    it("a checkout script that fails to load keeps the order; retry opens the SAME order (no second order)", async () => {
        const h = harness();
        h.loadCheckout.mockRejectedValueOnce(new Error("offline"));
        await h.flow.submit(500);
        expect(h.flow.state).toMatchObject({ phase: "failed", canRetryCheckout: true });
        expect(h.flow.state.error).toContain("Payment library didn");

        await h.flow.retryCheckout();
        expect(h.createOrder).toHaveBeenCalledTimes(1);
        expect(h.flow.state.phase).toBe("checkoutOpen");
        expect(FakeRazorpay.last!.options.order_id).toBe("order_ABC");
    });

    it("an exception while opening the checkout is reported as a failure of the same order", async () => {
        const h = harness();
        FakeRazorpay.onOpen = () => {
            throw new Error("boom");
        };
        await h.flow.submit(500);
        expect(h.flow.state).toMatchObject({ phase: "failed", canRetryCheckout: true });
        expect(h.flow.state.error).toBe("Couldn’t open the payment window.");
    });

    describe("verification", () => {
        it("retries transient failures (network, 5xx) with back-off, then succeeds", async () => {
            const h = harness();
            h.verifyPayment
                .mockRejectedValueOnce(new ClarivaHttpError(0, "offline", "network"))
                .mockRejectedValueOnce(new ClarivaHttpError(502, "HTTP 502", "http"))
                .mockResolvedValueOnce({ success: true, newBalance: 700 });
            await h.flow.submit(500);
            FakeRazorpay.last!.succeed();
            await settle();
            expect(h.verifyPayment).toHaveBeenCalledTimes(3);
            expect(h.flow.state).toMatchObject({ phase: "success", newBalance: 700 });
            expect(h.createOrder).toHaveBeenCalledTimes(1);
        });

        it("does not retry a definitive refusal (400 invalid signature) and says the payment went through", async () => {
            const h = harness();
            h.verifyPayment.mockRejectedValue(
                new ClarivaHttpError(400, "HTTP 400", "http", "Invalid payment signature"),
            );
            await h.flow.submit(500);
            FakeRazorpay.last!.succeed();
            await settle();
            expect(h.verifyPayment).toHaveBeenCalledTimes(1);
            expect(h.flow.state).toMatchObject({ phase: "verifyFailed", retryable: false });
            expect(h.flow.state.error).toBe(
                "Payment went through, but confirmation didn’t complete. Your wallet will update shortly — if not, contact support with payment id pay_123",
            );
            // the ids stay in storage so a reload can still resolve it
            expect(h.deps.pending.get(ME, "order_ABC")).toMatchObject({ paymentId: "pay_123", signature: "sig_456" });
        });

        it("after the attempts are exhausted, Retry re-verifies the same payment without creating another order", async () => {
            const h = harness();
            h.verifyPayment.mockRejectedValue(new ClarivaHttpError(0, "offline", "network"));
            await h.flow.submit(500);
            FakeRazorpay.last!.succeed();
            await settle();
            expect(h.verifyPayment).toHaveBeenCalledTimes(VERIFY_ATTEMPTS);
            expect(h.flow.state).toMatchObject({ phase: "verifyFailed", retryable: true });

            h.verifyPayment.mockReset();
            h.verifyPayment.mockResolvedValue({ success: true, newBalance: "640.00" });
            await h.flow.runVerify();
            expect(h.verifyPayment).toHaveBeenCalledTimes(1);
            expect(h.verifyPayment).toHaveBeenCalledWith(
                expect.objectContaining({ transactionId: "164", razorpay_payment_id: "pay_123" }),
            );
            expect(h.flow.state).toMatchObject({ phase: "success", newBalance: 640 });
            expect(h.createOrder).toHaveBeenCalledTimes(1);
            expect(FakeRazorpay.all).toHaveLength(1);
            expect(h.deps.pending.list(ME)).toEqual([]);
        });

        it("never sends an empty signature: it reports the confirmation problem instead", async () => {
            const h = harness();
            await h.flow.submit(500);
            FakeRazorpay.last!.succeed({ razorpay_signature: undefined });
            await settle();
            expect(h.verifyPayment).not.toHaveBeenCalled();
            expect(h.flow.state.phase).toBe("verifyFailed");
            expect(h.flow.state.error).toBe(
                "Payment went through, but we couldn’t confirm it here. It should reflect shortly.",
            );
        });

        it("treats success:false as a failure, not as a credit", async () => {
            const h = harness();
            h.verifyPayment.mockResolvedValue({ success: false });
            await h.flow.submit(500);
            FakeRazorpay.last!.succeed();
            await settle();
            expect(h.flow.state.phase).toBe("verifyFailed");
        });

        it("keeps verifying after the dialog went away (dispose only stops background polling)", async () => {
            const h = harness();
            await h.flow.submit(500);
            const rzp = FakeRazorpay.last!;
            h.flow.dispose();
            rzp.succeed();
            await settle();
            expect(h.verifyPayment).toHaveBeenCalledTimes(1);
            expect(h.deps.pending.list(ME)).toEqual([]);
        });
    });

    describe("reconciling through the ledger (webhook may credit first)", () => {
        it("a PAID row for the order completes a payment whose verification failed", async () => {
            const h = harness({}, { parkReconcile: false });
            h.verifyPayment.mockRejectedValue(new ClarivaHttpError(400, "HTTP 400", "http", "Order ID mismatch"));
            let polls = 0;
            h.getHistory.mockImplementation(async () => {
                polls++;
                const paid = polls >= 2;
                return {
                    data: [
                        {
                            id: "164",
                            amount: "500.00",
                            type: "CREDIT",
                            source: "RECHARGE",
                            status: paid ? "PAID" : "CREATED",
                            providerOrderId: "order_ABC",
                        },
                    ],
                    total: 1,
                    page: 1,
                    pageSize: 10,
                    totalPages: 1,
                };
            });
            await h.flow.submit(500);
            FakeRazorpay.last!.succeed();
            await settle();
            expect(polls).toBe(2);
            expect(h.flow.state).toMatchObject({ phase: "success", reconciling: false });
            expect(h.deps.pending.list(ME)).toEqual([]);
        });

        it("a FAILED row stops the wait, and the user keeps the retry option", async () => {
            const h = harness({}, { parkReconcile: false });
            h.verifyPayment.mockRejectedValue(
                new ClarivaHttpError(400, "HTTP 400", "http", "Invalid payment signature"),
            );
            h.getHistory.mockResolvedValue({
                data: [
                    {
                        id: "164",
                        amount: "500.00",
                        type: "CREDIT",
                        source: "RECHARGE",
                        status: "FAILED",
                        providerOrderId: "order_ABC",
                    },
                ],
                total: 1,
                page: 1,
                pageSize: 10,
                totalPages: 1,
            });
            await h.flow.submit(500);
            FakeRazorpay.last!.succeed();
            await settle();
            expect(h.flow.state).toMatchObject({ phase: "verifyFailed", reconciling: false });
        });

        it("gives up after about three minutes", async () => {
            const h = harness({}, { parkReconcile: false });
            h.verifyPayment.mockRejectedValue(new ClarivaHttpError(400, "HTTP 400", "http", "x"));
            await h.flow.submit(500);
            FakeRazorpay.last!.succeed();
            await settle(1000);
            expect(h.flow.state).toMatchObject({ phase: "verifyFailed", reconciling: false });
            // 3 min / 10 s = 18 polls at most
            expect(h.getHistory.mock.calls.length).toBeLessThanOrEqual(18);
            expect(h.getHistory.mock.calls.length).toBeGreaterThan(0);
        });
    });
});

describe("recoverPendingPayments (a reload in the middle of a payment)", () => {
    beforeEach(() => resetRecoveryForTests());

    const seed = (h: Harness, extra: Record<string, unknown> = {}): void =>
        h.deps.pending.save({
            userId: ME,
            orderId: "order_ABC",
            transactionId: "164",
            amount: 500,
            ...extra,
        } as never);

    it("re-verifies an entry that already holds the payment id and signature", async () => {
        const h = harness();
        seed(h);
        h.deps.pending.attachPayment(ME, "order_ABC", "pay_123", "sig_456");
        const ledger = jest.fn();
        const off = onLedgerChanged(ledger);

        const recovered = await recoverPendingPayments(h.deps);

        expect(h.verifyPayment).toHaveBeenCalledWith({
            transactionId: "164",
            razorpay_order_id: "order_ABC",
            razorpay_payment_id: "pay_123",
            razorpay_signature: "sig_456",
        });
        expect(recovered).toEqual([{ orderId: "order_ABC", amount: 500, newBalance: 620 }]);
        expect(h.deps.pending.list(ME)).toEqual([]);
        expect(h.refreshBalance).toHaveBeenCalled();
        expect(ledger).toHaveBeenCalled();
        off();
    });

    it("drops an entry the server definitively refuses (it would retry forever)", async () => {
        const h = harness();
        seed(h);
        h.deps.pending.attachPayment(ME, "order_ABC", "pay_123", "sig_456");
        h.verifyPayment.mockRejectedValue(new ClarivaHttpError(404, "HTTP 404", "http", "Transaction not found"));
        expect(await recoverPendingPayments(h.deps)).toEqual([]);
        expect(h.deps.pending.list(ME)).toEqual([]);
    });

    it("keeps an entry when the failure is transient (network)", async () => {
        const h = harness();
        seed(h);
        h.deps.pending.attachPayment(ME, "order_ABC", "pay_123", "sig_456");
        h.verifyPayment.mockRejectedValue(new ClarivaHttpError(0, "offline", "network"));
        expect(await recoverPendingPayments(h.deps)).toEqual([]);
        expect(h.deps.pending.list(ME)).toHaveLength(1);
    });

    it("an entry without payment info is resolved from the ledger when the webhook already credited it", async () => {
        const h = harness();
        seed(h);
        h.getHistory.mockResolvedValue({
            data: [
                {
                    id: "164",
                    amount: "500.00",
                    type: "CREDIT",
                    source: "RECHARGE",
                    status: "PAID",
                    providerOrderId: "order_ABC",
                },
            ],
            total: 1,
            page: 1,
            pageSize: 10,
            totalPages: 1,
        });
        const recovered = await recoverPendingPayments(h.deps);
        expect(h.verifyPayment).not.toHaveBeenCalled(); // never verify without a signature
        expect(recovered).toEqual([{ orderId: "order_ABC", amount: 500, newBalance: null }]);
        expect(h.deps.pending.list(ME)).toEqual([]);
    });

    it("an unpaid entry without payment info stays for an hour and is then forgotten", async () => {
        const h = harness();
        seed(h);
        expect(await recoverPendingPayments(h.deps)).toEqual([]);
        expect(h.deps.pending.list(ME)).toHaveLength(1);

        resetRecoveryForTests();
        h.clock.now += 61 * 60_000;
        await recoverPendingPayments(h.deps);
        expect(h.deps.pending.list(ME)).toEqual([]);
    });

    it("is single-flight and does nothing for a signed-out user or without entries", async () => {
        const h = harness();
        expect(await recoverPendingPayments(h.deps)).toEqual([]);
        expect(h.getHistory).not.toHaveBeenCalled();

        const out = harness({ userId: () => null });
        expect(await recoverPendingPayments(out.deps)).toEqual([]);

        seed(h);
        h.deps.pending.attachPayment(ME, "order_ABC", "pay_123", "sig_456");
        const [a, b] = [recoverPendingPayments(h.deps), recoverPendingPayments(h.deps)];
        expect(a).toBe(b);
        await a;
        expect(h.verifyPayment).toHaveBeenCalledTimes(1);
    });
});
