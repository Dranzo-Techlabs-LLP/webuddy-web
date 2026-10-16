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
    INITIAL_RECHARGE_STATE,
    MAX_RECHARGE,
    MIN_RECHARGE,
    QUICK_AMOUNTS,
    canSubmit,
    formatInr,
    isBusy,
    rechargeReducer,
    sanitizeAmountInput,
    validateRechargeAmount,
    type OrderInfo,
    type PaymentInfo,
    type RechargeAction,
    type RechargeState,
} from "../../src/clariva/wallet/rechargeMachine";

const order: OrderInfo = {
    orderId: "order_X",
    transactionId: "164",
    keyId: "rzp_test_x",
    amountInPaise: 50000,
    currency: "INR",
    amount: 500,
};
const payment: PaymentInfo = { orderId: "order_X", paymentId: "pay_Y", signature: "sig" };

const run = (actions: RechargeAction[], from: RechargeState = INITIAL_RECHARGE_STATE): RechargeState =>
    actions.reduce(rechargeReducer, from);

describe("recharge amount validation (min 1 / max 100000, whole credits)", () => {
    it("limits and chips match the website", () => {
        expect(MIN_RECHARGE).toBe(1);
        expect(MAX_RECHARGE).toBe(100000);
        expect(QUICK_AMOUNTS).toEqual([100, 500, 1000, 2000]);
    });

    it.each([
        ["1", 1],
        ["500", 500],
        [" 500 ", 500],
        ["100000", 100000],
    ])("accepts %j", (text, amount) => {
        expect(validateRechargeAmount(text)).toEqual({ ok: true, amount });
    });

    it("an empty field is not valid but has no message (nothing to shout about yet)", () => {
        expect(validateRechargeAmount("")).toEqual({ ok: false, reason: "empty", message: "" });
        expect(validateRechargeAmount("   ")).toEqual({ ok: false, reason: "empty", message: "" });
    });

    it.each(["0", "100001", "00", "999999999999999999999"])("rejects %j as out of range", (text) => {
        const v = validateRechargeAmount(text);
        expect(v.ok).toBe(false);
        if (!v.ok) {
            expect(v.reason).toBe("range");
            expect(v.message).toBe("Enter an amount between ₹1 and ₹1,00,000.");
        }
    });

    it.each(["12.5", "5e2", "-5", "abc", "1,000"])("rejects %j as not a whole number", (text) => {
        const v = validateRechargeAmount(text);
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.reason).toBe("not_integer");
    });

    it("sanitizes typing and pasting to at most six digits", () => {
        expect(sanitizeAmountInput("1,000")).toBe("1000");
        expect(sanitizeAmountInput("12.5")).toBe("125");
        expect(sanitizeAmountInput("abc")).toBe("");
        expect(sanitizeAmountInput("12345678")).toBe("123456");
    });

    it("formats rupees with Indian grouping like the website messages", () => {
        expect(formatInr(100000)).toBe("1,00,000");
        expect(formatInr(2000)).toBe("2,000");
    });
});

describe("recharge state machine (spec 02 section 3.5 / 6.4)", () => {
    it("happy path: submit -> order -> checkout -> payment -> verified", () => {
        let s = run([{ type: "submit", amount: 500 }]);
        expect(s.phase).toBe("creatingOrder");
        s = run([{ type: "orderCreated", order }], s);
        expect(s.phase).toBe("loadingCheckout");
        s = run([{ type: "checkoutOpened" }], s);
        expect(s.phase).toBe("checkoutOpen");
        s = run([{ type: "paymentSucceeded", payment }], s);
        expect(s.phase).toBe("verifying");
        expect(s.payment).toEqual(payment);
        s = run([{ type: "verifyOk", newBalance: 620 }], s);
        expect(s).toMatchObject({ phase: "success", newBalance: 620, error: null });
    });

    it("guards double clicks: submit is ignored while anything is in flight or finished", () => {
        const busy = run([{ type: "submit", amount: 500 }]);
        expect(isBusy(busy)).toBe(true);
        expect(canSubmit(busy)).toBe(false);
        expect(rechargeReducer(busy, { type: "submit", amount: 700 })).toBe(busy);

        const open = run([{ type: "orderCreated", order }, { type: "checkoutOpened" }], busy);
        expect(rechargeReducer(open, { type: "submit", amount: 700 })).toBe(open);

        const done = run(
            [
                { type: "paymentSucceeded", payment },
                { type: "verifyOk", newBalance: 1 },
            ],
            open,
        );
        expect(rechargeReducer(done, { type: "submit", amount: 700 })).toBe(done);
    });

    it("creating the order can fail (and a new attempt may start)", () => {
        const s = run([
            { type: "submit", amount: 500 },
            { type: "orderFailed", message: "Recharge failed: User not found" },
        ]);
        expect(s).toMatchObject({ phase: "failed", error: "Recharge failed: User not found", canRetryCheckout: false });
        expect(canSubmit(s)).toBe(true);
        expect(rechargeReducer(s, { type: "submit", amount: 100 }).phase).toBe("creatingOrder");
    });

    it("closing the checkout with nothing wrong is a silent cancel, not a failure", () => {
        const s = run([
            { type: "submit", amount: 500 },
            { type: "orderCreated", order },
            { type: "checkoutOpened" },
            { type: "dismissed" },
        ]);
        expect(s).toMatchObject({ phase: "cancelled", error: null });
        expect(canSubmit(s)).toBe(true);
    });

    it("payment.failed does not end the attempt (Razorpay keeps its window open); closing afterwards is a failure", () => {
        let s = run([
            { type: "submit", amount: 500 },
            { type: "orderCreated", order },
            { type: "checkoutOpened" },
            { type: "paymentFailed", message: "Recharge failed: card declined" },
        ]);
        expect(s.phase).toBe("checkoutOpen");
        expect(s.error).toBe("Recharge failed: card declined");
        s = run([{ type: "dismissed" }], s);
        expect(s).toMatchObject({ phase: "failed", error: "Recharge failed: card declined" });
    });

    it("a payment that succeeds after a failed attempt is still verified", () => {
        const s = run([
            { type: "submit", amount: 500 },
            { type: "orderCreated", order },
            { type: "checkoutOpened" },
            { type: "paymentFailed", message: "Recharge failed: card declined" },
            { type: "paymentSucceeded", payment },
        ]);
        expect(s).toMatchObject({ phase: "verifying", error: null });
    });

    it("a captured payment is verified from any phase except an already running/finished verification", () => {
        const cancelled = run([
            { type: "submit", amount: 500 },
            { type: "orderCreated", order },
            { type: "checkoutOpened" },
            { type: "dismissed" },
        ]);
        expect(rechargeReducer(cancelled, { type: "paymentSucceeded", payment }).phase).toBe("verifying");

        const verifying = rechargeReducer(cancelled, { type: "paymentSucceeded", payment });
        expect(rechargeReducer(verifying, { type: "paymentSucceeded", payment })).toBe(verifying);
        // a dismiss that arrives after the success handler must not turn it into a cancel
        expect(rechargeReducer(verifying, { type: "dismissed" })).toBe(verifying);
    });

    it("checkout script failure keeps the order so the SAME order can be opened again", () => {
        let s = run([
            { type: "submit", amount: 500 },
            { type: "orderCreated", order },
            { type: "checkoutLoadFailed", message: "load failed" },
        ]);
        expect(s).toMatchObject({ phase: "failed", canRetryCheckout: true, order });
        s = run([{ type: "retryCheckout" }], s);
        expect(s).toMatchObject({ phase: "loadingCheckout", order, error: null });
    });

    it("retryCheckout is refused when there is nothing to retry", () => {
        const failed = run([
            { type: "submit", amount: 500 },
            { type: "orderFailed", message: "x" },
        ]);
        expect(rechargeReducer(failed, { type: "retryCheckout" })).toBe(failed);
    });

    it("verification failure keeps the payment ids; retry goes back to verifying without a new order", () => {
        let s = run([
            { type: "submit", amount: 500 },
            { type: "orderCreated", order },
            { type: "checkoutOpened" },
            { type: "paymentSucceeded", payment },
            { type: "verifyFailed", message: "confirmation didn't complete", retryable: true },
        ]);
        expect(s).toMatchObject({ phase: "verifyFailed", retryable: true, payment, order });
        expect(canSubmit(s)).toBe(false); // a second order must not be created while this one is unconfirmed
        s = run([{ type: "reconciling", active: true }], s);
        expect(s.reconciling).toBe(true);
        s = run([{ type: "retryVerify" }], s);
        expect(s.phase).toBe("verifying");
        expect(s.order).toEqual(order);
        s = run(
            [
                { type: "verifyFailed", message: "again", retryable: true },
                { type: "verifyOk", newBalance: null },
            ],
            s,
        );
        expect(s).toMatchObject({ phase: "success", newBalance: null, reconciling: false });
    });

    it("the ledger poll can complete a payment whose verification failed", () => {
        const s = run([
            { type: "submit", amount: 500 },
            { type: "orderCreated", order },
            { type: "checkoutOpened" },
            { type: "paymentSucceeded", payment },
            { type: "verifyFailed", message: "m", retryable: false },
            { type: "verifyOk", newBalance: 700 },
        ]);
        expect(s).toMatchObject({ phase: "success", newBalance: 700 });
    });

    it("reset returns to idle", () => {
        expect(run([{ type: "submit", amount: 5 }, { type: "reset" }])).toEqual(INITIAL_RECHARGE_STATE);
    });

    it("ignores actions that make no sense in the current phase", () => {
        expect(rechargeReducer(INITIAL_RECHARGE_STATE, { type: "orderCreated", order })).toBe(INITIAL_RECHARGE_STATE);
        expect(rechargeReducer(INITIAL_RECHARGE_STATE, { type: "verifyOk", newBalance: 1 })).toBe(
            INITIAL_RECHARGE_STATE,
        );
        expect(rechargeReducer(INITIAL_RECHARGE_STATE, { type: "dismissed" })).toBe(INITIAL_RECHARGE_STATE);
        expect(rechargeReducer(INITIAL_RECHARGE_STATE, { type: "retryVerify" })).toBe(INITIAL_RECHARGE_STATE);
    });
});
