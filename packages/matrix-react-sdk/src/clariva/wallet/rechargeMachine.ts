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

import { walletStrings as S } from "../strings/wallet";

/**
 * The recharge state machine (spec 02 §3.5 + §6.4) as a pure reducer, plus amount validation.
 *
 *   idle ──submit──▶ creatingOrder ──orderCreated──▶ loadingCheckout ──checkoutOpened──▶ checkoutOpen
 *     ▲                    │ orderFailed                  │ checkoutLoadFailed                 │
 *     │                    ▼                              ▼                                    │ paymentSucceeded
 *     └──── reset ──── failed ◀───────────────────── (order kept: retryCheckout)               ▼
 *                        ▲  ▲                                                             verifying ──verifyOk──▶ success
 *                        │  └── dismissed (after a payment.failed)                            │ verifyFailed
 *              cancelled ◀── dismissed (nothing went wrong)                                   ▼
 *                                                                                        verifyFailed ──retryVerify──▶ verifying
 *
 * Money rules baked in here:
 *  - a double submit is ignored while anything is in flight (one order per click);
 *  - `payment.failed` does NOT end the attempt: Razorpay keeps its window open so the user can pay another way,
 *    and a later success must still be verified; only closing the window ends it (cancelled vs failed);
 *  - a success handler is honoured from every phase except an already-running/finished verification, because a
 *    captured payment must always be verified, whatever the UI believes;
 *  - "payment went through but verification failed" keeps the payment ids so Retry re-verifies the same order.
 */

export const MIN_RECHARGE = 1;
export const MAX_RECHARGE = 100_000;
/** Quick-pick chips of the clarivahub.com recharge page. */
export const QUICK_AMOUNTS: readonly number[] = [100, 500, 1000, 2000];

export type AmountValidation =
    | { ok: true; amount: number }
    | { ok: false; reason: "empty" | "not_integer" | "range"; message: string };

/** `1,00,000` style (Indian grouping) used by the website's messages. */
export function formatInr(amount: number): string {
    return amount.toLocaleString("en-IN");
}

/** Keep digits only and at most 6 of them (100000 is the largest legal amount). */
export function sanitizeAmountInput(text: string): string {
    return text.replace(/\D+/g, "").slice(0, String(MAX_RECHARGE).length);
}

/**
 * Validate what the user typed. Whole numbers 1..100000 only: the server accepts decimals but Android never sends
 * them, and a fractional rupee amount makes no sense for "credits". Surrounding whitespace is tolerated.
 */
export function validateRechargeAmount(text: string): AmountValidation {
    const trimmed = text.trim();
    if (trimmed === "") return { ok: false, reason: "empty", message: "" };
    if (!/^\d+$/.test(trimmed)) return { ok: false, reason: "not_integer", message: S.amountWholeNumber };
    const amount = Number(trimmed);
    if (!Number.isSafeInteger(amount) || amount < MIN_RECHARGE || amount > MAX_RECHARGE) {
        return { ok: false, reason: "range", message: S.amountRange };
    }
    return { ok: true, amount };
}

// ─────────────────────────────── state ───────────────────────────────

export interface OrderInfo {
    orderId: string;
    transactionId: string;
    keyId: string;
    amountInPaise: number;
    currency: string;
    /** Credits (= rupees) the user asked for. */
    amount: number;
}

/** What Razorpay's `handler` hands back. */
export interface PaymentInfo {
    orderId: string;
    paymentId: string;
    signature: string;
}

export type RechargePhase =
    | "idle"
    | "creatingOrder"
    | "loadingCheckout"
    | "checkoutOpen"
    | "verifying"
    | "verifyFailed"
    | "success"
    | "cancelled"
    | "failed";

export interface RechargeState {
    phase: RechargePhase;
    /** The amount of the current/last attempt. */
    amount: number | null;
    order: OrderInfo | null;
    payment: PaymentInfo | null;
    /** `failed`: why. `checkoutOpen`: the last `payment.failed` text (the window is still open). `verifyFailed`: why. */
    error: string | null;
    /** `verifyFailed`: a retry makes sense (network/5xx) as opposed to a definitive server refusal. */
    retryable: boolean;
    /** `verifyFailed`: we are polling the ledger for the payment in the background. */
    reconciling: boolean;
    newBalance: number | null;
    /** Retrying the checkout of the SAME order is possible (the failure happened after the order was created). */
    canRetryCheckout: boolean;
}

export const INITIAL_RECHARGE_STATE: RechargeState = {
    phase: "idle",
    amount: null,
    order: null,
    payment: null,
    error: null,
    retryable: false,
    reconciling: false,
    newBalance: null,
    canRetryCheckout: false,
};

export type RechargeAction =
    | { type: "submit"; amount: number }
    | { type: "orderCreated"; order: OrderInfo }
    | { type: "orderFailed"; message: string }
    | { type: "checkoutOpened" }
    | { type: "checkoutLoadFailed"; message: string }
    | { type: "retryCheckout" }
    | { type: "paymentFailed"; message: string }
    | { type: "dismissed" }
    | { type: "paymentSucceeded"; payment: PaymentInfo }
    | { type: "verifyOk"; newBalance: number | null }
    | { type: "verifyFailed"; message: string; retryable: boolean }
    | { type: "reconciling"; active: boolean }
    | { type: "retryVerify" }
    | { type: "reset" };

/** Phases in which a new recharge may start. */
export function canSubmit(state: RechargeState): boolean {
    return state.phase === "idle" || state.phase === "cancelled" || state.phase === "failed";
}

/** Something is running; the form must be locked. */
export function isBusy(state: RechargeState): boolean {
    return (
        state.phase === "creatingOrder" ||
        state.phase === "loadingCheckout" ||
        state.phase === "checkoutOpen" ||
        state.phase === "verifying"
    );
}

export function rechargeReducer(state: RechargeState, action: RechargeAction): RechargeState {
    switch (action.type) {
        case "submit":
            if (!canSubmit(state)) return state; // double-click / re-entrancy guard
            return { ...INITIAL_RECHARGE_STATE, phase: "creatingOrder", amount: action.amount };

        case "orderCreated":
            if (state.phase !== "creatingOrder") return state;
            return { ...state, phase: "loadingCheckout", order: action.order, error: null };

        case "orderFailed":
            if (state.phase !== "creatingOrder") return state;
            return { ...state, phase: "failed", error: action.message, canRetryCheckout: false };

        case "checkoutOpened":
            if (state.phase !== "loadingCheckout") return state;
            return { ...state, phase: "checkoutOpen", error: null };

        case "checkoutLoadFailed":
            if (state.phase !== "loadingCheckout") return state;
            // the order exists (a CREATED ledger row): offer to open the same one again instead of creating another
            return { ...state, phase: "failed", error: action.message, canRetryCheckout: true };

        case "retryCheckout":
            if (state.phase !== "failed" || !state.canRetryCheckout || !state.order) return state;
            return { ...state, phase: "loadingCheckout", error: null, canRetryCheckout: false };

        case "paymentFailed":
            // Razorpay keeps its window open after payment.failed: remember the text, stay in checkoutOpen.
            if (state.phase !== "checkoutOpen" && state.phase !== "loadingCheckout") return state;
            return { ...state, error: action.message };

        case "dismissed":
            if (state.phase !== "checkoutOpen" && state.phase !== "loadingCheckout") return state;
            // closed after a failed attempt -> that is a failure; closed with nothing wrong -> a silent cancel
            return state.error
                ? { ...state, phase: "failed", canRetryCheckout: false }
                : { ...state, phase: "cancelled", error: null, canRetryCheckout: false };

        case "paymentSucceeded":
            if (state.phase === "verifying" || state.phase === "success") return state;
            return {
                ...state,
                phase: "verifying",
                payment: action.payment,
                error: null,
                retryable: false,
                reconciling: false,
                canRetryCheckout: false,
            };

        case "verifyOk":
            if (state.phase !== "verifying" && state.phase !== "verifyFailed") return state;
            return { ...state, phase: "success", newBalance: action.newBalance, error: null, reconciling: false };

        case "verifyFailed":
            if (state.phase !== "verifying") return state;
            return { ...state, phase: "verifyFailed", error: action.message, retryable: action.retryable };

        case "reconciling":
            if (state.phase !== "verifyFailed") return state;
            return { ...state, reconciling: action.active };

        case "retryVerify":
            if (state.phase !== "verifyFailed" || !state.payment) return state;
            return { ...state, phase: "verifying", error: null };

        case "reset":
            return INITIAL_RECHARGE_STATE;
    }
}
