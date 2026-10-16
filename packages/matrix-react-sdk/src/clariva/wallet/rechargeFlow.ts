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

import { logger } from "matrix-js-sdk/src/logger";

import { ClarivaHttpError } from "../api/http";
import {
    type CreateOrderResponse,
    type TransactionHistoryResponse,
    type VerifyPaymentRequest,
    type VerifyPaymentResponse,
    type WalletTransaction,
} from "../api/types";
import { parseAmount } from "../money";
import {
    loadRazorpay,
    type RazorpayConstructor,
    type RazorpayFailureResponse,
    type RazorpaySuccessResponse,
} from "../razorpay";
import { WalletStore } from "../stores/WalletStore";
import { walletStrings as S } from "../strings/wallet";
import { type PendingPaymentsStore, pendingPayments } from "./pendingPayments";
import {
    INITIAL_RECHARGE_STATE,
    canSubmit,
    isBusy,
    rechargeReducer,
    validateRechargeAmount,
    type OrderInfo,
    type PaymentInfo,
    type RechargeAction,
    type RechargeState,
} from "./rechargeMachine";
import { notifyLedgerChanged } from "./walletBus";

/** `POST /v1/wallet/verify` is idempotent, so it is safe to retry on network/5xx errors. */
export const VERIFY_ATTEMPTS = 3;
export const VERIFY_BACKOFF_MS: readonly number[] = [1500, 4000];
/** After verification keeps failing, watch the ledger (the Razorpay webhook may credit the wallet first). */
export const RECONCILE_INTERVAL_MS = 10_000;
export const RECONCILE_TIMEOUT_MS = 3 * 60_000;

export interface RechargeFlowDeps {
    /** Matrix user id of the signed-in user (the wallet identifier), or null when signed out. */
    userId: () => string | null;
    createOrder: (amount: number) => Promise<CreateOrderResponse>;
    verifyPayment: (request: Omit<VerifyPaymentRequest, "userId">) => Promise<VerifyPaymentResponse>;
    getHistory: (page: number, pageSize: number) => Promise<TransactionHistoryResponse>;
    refreshBalance: () => Promise<void>;
    currentCredits: () => number | null;
    loadCheckout: () => Promise<RazorpayConstructor>;
    pending: PendingPaymentsStore;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
}

/** The production wiring: the wallet store, the on-demand Razorpay loader and `sessionStorage`. */
export function createDefaultRechargeDeps(): RechargeFlowDeps {
    const store = WalletStore.instance;
    return {
        userId: () => store.userId,
        createOrder: (amount) => store.createOrder(amount),
        verifyPayment: (request) => store.verifyPayment(request),
        getHistory: (page, pageSize) => store.getHistory(page, pageSize),
        refreshBalance: () => store.refreshBalance(),
        currentCredits: () => store.credits,
        loadCheckout: () => loadRazorpay(),
        pending: pendingPayments,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => Date.now(),
    };
}

type VerifyOutcome = { ok: true; newBalance: number | null } | { ok: false; retryable: boolean; detail: string };

function classifyVerifyError(e: unknown): { retryable: boolean; detail: string } {
    if (e instanceof ClarivaHttpError) {
        return { retryable: e.isNetwork || e.isServerError, detail: e.serverMessage ?? e.message };
    }
    return { retryable: false, detail: e instanceof Error ? e.message : String(e) };
}

/** What the user reads when creating the order failed. Network problems and server refusals read differently. */
export function describeOrderError(e: unknown): string {
    if (e instanceof ClarivaHttpError) {
        if (e.isNetwork) return S.rechargeFailed(S.networkErrorStarting);
        return S.rechargeFailed(e.serverMessage ?? e.message);
    }
    return S.rechargeFailed(S.couldntStartPayment);
}

/** Call `POST /v1/wallet/verify` with retries on transient failures only. */
async function verifyWithRetry(
    deps: RechargeFlowDeps,
    request: Omit<VerifyPaymentRequest, "userId">,
): Promise<VerifyOutcome> {
    let last: { retryable: boolean; detail: string } = { retryable: true, detail: "" };
    for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
        try {
            const response = await deps.verifyPayment(request);
            if (response.success !== true) {
                return { ok: false, retryable: false, detail: "The server did not confirm the payment" };
            }
            // `newBalance` is a number on the first credit and a DECIMAL string on an idempotent replay.
            return { ok: true, newBalance: parseAmount(response.newBalance) };
        } catch (e) {
            last = classifyVerifyError(e);
            logger.warn(`Clariva wallet: verify attempt ${attempt}/${VERIFY_ATTEMPTS} failed: ${last.detail}`);
            if (!last.retryable || attempt === VERIFY_ATTEMPTS) break;
            await deps.sleep(VERIFY_BACKOFF_MS[Math.min(attempt - 1, VERIFY_BACKOFF_MS.length - 1)]);
        }
    }
    return { ok: false, ...last };
}

function findLedgerRow(
    rows: readonly WalletTransaction[],
    orderId: string,
    transactionId: string | undefined,
): WalletTransaction | undefined {
    return rows.find(
        (r) =>
            (r.providerOrderId && r.providerOrderId === orderId) || (transactionId && String(r.id) === transactionId),
    );
}

/**
 * Drives one recharge from "Recharge" click to a confirmed balance (spec 02 §3.5, §6.4):
 *
 *   createOrder (404 self-heal in the store) -> remember the order in sessionStorage -> load checkout.js on demand ->
 *   open Razorpay -> on success verify (retrying transient failures; never with an empty signature) -> success.
 *
 * The flow is UI-independent: closing the dialog does not abandon a payment that is already being verified, and a
 * confirmed/recovered payment always refreshes the balance and tells open ledgers to reload. If verification cannot
 * be completed, the flow keeps the payment ids (so "Retry" never creates a second order) and watches the ledger for
 * the webhook to credit it.
 */
export class RechargeFlow {
    private current: RechargeState = INITIAL_RECHARGE_STATE;
    private readonly listeners = new Set<(state: RechargeState) => void>();
    private submitting = false;
    private verifying = false;
    private reconcileRunning = false;
    private disposed = false;

    public constructor(private readonly deps: RechargeFlowDeps = createDefaultRechargeDeps()) {}

    public get state(): RechargeState {
        return this.current;
    }

    public subscribe(listener: (state: RechargeState) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Stop background polling and detach UI listeners. An in-flight verification still completes. */
    public dispose(): void {
        this.disposed = true;
        this.listeners.clear();
    }

    private dispatch(action: RechargeAction): void {
        const next = rechargeReducer(this.current, action);
        if (next === this.current) return;
        this.current = next;
        for (const listener of [...this.listeners]) listener(next);
    }

    public reset(): void {
        if (isBusy(this.current) || this.current.phase === "verifyFailed") return;
        this.dispatch({ type: "reset" });
    }

    // ── step 1: order ────────────────────────────────────────────────────────

    /** Start a recharge for `amountText` (what the user typed). Ignored while another attempt is running. */
    public async submit(amountText: string | number): Promise<void> {
        if (this.submitting || !canSubmit(this.current)) return; // double-click guard
        const validation = validateRechargeAmount(String(amountText));
        if (!validation.ok) return;
        const userId = this.deps.userId();
        if (!userId) return;

        this.submitting = true;
        this.dispatch({ type: "submit", amount: validation.amount });
        try {
            let response: CreateOrderResponse;
            try {
                response = await this.deps.createOrder(validation.amount);
            } catch (e) {
                logger.warn("Clariva wallet: could not create the Razorpay order", e);
                this.dispatch({ type: "orderFailed", message: describeOrderError(e) });
                return;
            }
            if (!response?.orderId || !response.keyId) {
                this.dispatch({ type: "orderFailed", message: S.rechargeFailed(S.couldntStartPayment) });
                return;
            }
            const order: OrderInfo = {
                orderId: response.orderId,
                transactionId: String(response.transactionId ?? ""),
                keyId: response.keyId,
                amountInPaise: Number.isFinite(response.amountInPaise)
                    ? response.amountInPaise
                    : Math.round(validation.amount * 100),
                currency: response.currency || "INR",
                amount: validation.amount,
            };
            // Persist BEFORE the checkout opens: a reload mid-payment can then still be resolved.
            this.deps.pending.save({
                userId,
                orderId: order.orderId,
                transactionId: order.transactionId,
                amount: order.amount,
            });
            this.dispatch({ type: "orderCreated", order });
            await this.openCheckout(order);
        } finally {
            this.submitting = false;
        }
    }

    /** After "the payment window didn't open": open the SAME order again (no second order is created). */
    public async retryCheckout(): Promise<void> {
        const order = this.current.order;
        if (!order || this.submitting) return;
        const before = this.current;
        this.dispatch({ type: "retryCheckout" });
        if (this.current === before) return;
        this.submitting = true;
        try {
            await this.openCheckout(order);
        } finally {
            this.submitting = false;
        }
    }

    // ── step 2: checkout ─────────────────────────────────────────────────────

    private async openCheckout(order: OrderInfo): Promise<void> {
        let Razorpay: RazorpayConstructor;
        try {
            Razorpay = await this.deps.loadCheckout();
        } catch (e) {
            logger.warn("Clariva wallet: could not load Razorpay checkout", e);
            this.dispatch({ type: "checkoutLoadFailed", message: S.paymentLibraryFailed });
            return;
        }
        try {
            const checkout = new Razorpay({
                key: order.keyId,
                order_id: order.orderId,
                amount: order.amountInPaise,
                currency: order.currency,
                name: S.razorpayName,
                description: S.razorpayDescription,
                theme: { color: S.razorpayThemeColor },
                handler: (response) => this.onPaymentSuccess(order, response),
                modal: { ondismiss: () => this.dispatch({ type: "dismissed" }) },
            });
            checkout.on("payment.failed", (response: RazorpayFailureResponse) => {
                const description = response?.error?.description;
                this.dispatch({ type: "paymentFailed", message: S.rechargeFailed(description || "payment failed") });
            });
            checkout.open();
            this.dispatch({ type: "checkoutOpened" });
        } catch (e) {
            logger.warn("Clariva wallet: could not open Razorpay checkout", e);
            this.dispatch({ type: "checkoutLoadFailed", message: S.couldntOpenPayment });
        }
    }

    // ── step 3: verify ───────────────────────────────────────────────────────

    private onPaymentSuccess(order: OrderInfo, response: RazorpaySuccessResponse): void {
        const payment: PaymentInfo = {
            orderId: response.razorpay_order_id || order.orderId,
            paymentId: response.razorpay_payment_id ?? "",
            signature: response.razorpay_signature ?? "",
        };
        this.dispatch({ type: "paymentSucceeded", payment });

        const userId = this.deps.userId();
        if (!payment.paymentId || !payment.signature) {
            // Never send an empty signature: the server marks the ledger row FAILED for a bad one.
            logger.warn("Clariva wallet: checkout reported success without payment id/signature");
            this.dispatch({ type: "verifyFailed", message: S.verifyFailedNoId, retryable: false });
            void this.reconcile();
            return;
        }
        if (userId) this.deps.pending.attachPayment(userId, payment.orderId, payment.paymentId, payment.signature);
        void this.runVerify();
    }

    /** Verify the current payment (also behind the "Retry confirmation" button). Single-flight. */
    public async runVerify(): Promise<void> {
        const payment = this.current.payment;
        if (!payment || this.verifying) return;
        if (this.current.phase === "verifyFailed") this.dispatch({ type: "retryVerify" });
        if (this.current.phase !== "verifying") return;

        this.verifying = true;
        try {
            const userId = this.deps.userId();
            const transactionId =
                this.current.order?.orderId === payment.orderId
                    ? this.current.order.transactionId
                    : userId
                      ? this.deps.pending.get(userId, payment.orderId)?.transactionId
                      : undefined;
            if (!transactionId) {
                this.dispatch({ type: "verifyFailed", message: this.verifyFailureText(payment), retryable: false });
                void this.reconcile();
                return;
            }
            const outcome = await verifyWithRetry(this.deps, {
                transactionId,
                razorpay_order_id: payment.orderId,
                razorpay_payment_id: payment.paymentId,
                razorpay_signature: payment.signature,
            });
            if (outcome.ok) {
                await this.finishSuccess(payment.orderId, outcome.newBalance);
            } else {
                logger.warn(`Clariva wallet: payment ${payment.paymentId} could not be verified: ${outcome.detail}`);
                this.dispatch({
                    type: "verifyFailed",
                    message: this.verifyFailureText(payment),
                    retryable: outcome.retryable,
                });
                void this.reconcile();
            }
        } finally {
            this.verifying = false;
        }
    }

    private verifyFailureText(payment: PaymentInfo): string {
        return payment.paymentId ? S.verifyFailedWithId(payment.paymentId) : S.verifyFailedNoId;
    }

    private async finishSuccess(orderId: string, reportedBalance: number | null): Promise<void> {
        this.deps.pending.remove(orderId);
        // The store already applied `newBalance`; make sure the chip/header agree with the server.
        await this.deps.refreshBalance().catch(() => undefined);
        notifyLedgerChanged();
        this.dispatch({ type: "verifyOk", newBalance: reportedBalance ?? this.deps.currentCredits() });
    }

    /**
     * Verification failed: the webhook may still credit the wallet. Poll page 1 of the ledger until this order's row
     * is PAID (or FAILED, or ~3 minutes pass).
     */
    private async reconcile(): Promise<void> {
        const payment = this.current.payment;
        if (!payment || this.reconcileRunning) return;
        this.reconcileRunning = true;
        this.dispatch({ type: "reconciling", active: true });
        const userId = this.deps.userId();
        const transactionId =
            this.current.order?.transactionId ??
            (userId ? this.deps.pending.get(userId, payment.orderId)?.transactionId : undefined);
        const deadline = this.deps.now() + RECONCILE_TIMEOUT_MS;
        try {
            while (!this.disposed && this.deps.now() < deadline && this.current.phase === "verifyFailed") {
                await this.deps.sleep(RECONCILE_INTERVAL_MS);
                if (this.disposed || this.current.phase !== "verifyFailed") break;
                try {
                    const page = await this.deps.getHistory(1, 10);
                    const row = findLedgerRow(page.data ?? [], payment.orderId, transactionId);
                    const status = (row?.status ?? "").toUpperCase();
                    if (status === "PAID") {
                        await this.finishSuccess(payment.orderId, null);
                        return;
                    }
                    if (status === "FAILED") return; // definitive: stop waiting
                } catch (e) {
                    logger.debug("Clariva wallet: ledger poll failed while reconciling", e);
                }
            }
        } finally {
            this.reconcileRunning = false;
            this.dispatch({ type: "reconciling", active: false });
        }
    }
}

// ────────────────────────── recovery after a reload ──────────────────────────

export interface RecoveredPayment {
    orderId: string;
    amount: number;
    newBalance: number | null;
}

let recovering: Promise<RecoveredPayment[]> | null = null;

/**
 * Resolve payments that were interrupted by a page reload (entries in `sessionStorage`, spec 02 §6.8 #5):
 *
 *  - entries that already hold a payment id + signature are verified again (idempotent on the server);
 *  - entries without one are checked against the ledger once (the webhook may have credited them) and dropped
 *    when the server says PAID/FAILED or when they are old enough to be an abandoned checkout.
 *
 * Single-flight; safe to call on every mount. Returns the payments that were just confirmed.
 */
export function recoverPendingPayments(
    deps: RechargeFlowDeps = createDefaultRechargeDeps(),
): Promise<RecoveredPayment[]> {
    if (recovering) return recovering;
    const run = async (): Promise<RecoveredPayment[]> => {
        const userId = deps.userId();
        if (!userId) return [];
        const entries = deps.pending.list(userId);
        if (entries.length === 0) return [];

        const recovered: RecoveredPayment[] = [];
        let ledgerRows: readonly WalletTransaction[] | null = null;
        for (const entry of entries) {
            try {
                if (entry.paymentId && entry.signature) {
                    const outcome = await verifyWithRetry(deps, {
                        transactionId: entry.transactionId,
                        razorpay_order_id: entry.orderId,
                        razorpay_payment_id: entry.paymentId,
                        razorpay_signature: entry.signature,
                    });
                    if (outcome.ok) {
                        deps.pending.remove(entry.orderId);
                        recovered.push({
                            orderId: entry.orderId,
                            amount: entry.amount,
                            newBalance: outcome.newBalance,
                        });
                    } else if (!outcome.retryable) {
                        // 400/404: the server definitively refuses this payment; keeping it would retry forever
                        logger.warn(
                            `Clariva wallet: dropping unverifiable pending payment ${entry.paymentId}: ${outcome.detail}`,
                        );
                        deps.pending.remove(entry.orderId);
                    }
                    continue;
                }
                if (ledgerRows === null) ledgerRows = (await deps.getHistory(1, 10)).data ?? [];
                const status = (
                    findLedgerRow(ledgerRows, entry.orderId, entry.transactionId)?.status ?? ""
                ).toUpperCase();
                if (status === "PAID") {
                    deps.pending.remove(entry.orderId);
                    recovered.push({ orderId: entry.orderId, amount: entry.amount, newBalance: null });
                } else if (status === "FAILED" || deps.now() - entry.createdAt > 60 * 60 * 1000) {
                    deps.pending.remove(entry.orderId);
                }
            } catch (e) {
                logger.debug("Clariva wallet: could not recover pending payment", e);
            }
        }
        if (recovered.length > 0) {
            await deps.refreshBalance().catch(() => undefined);
            notifyLedgerChanged();
        }
        return recovered;
    };
    recovering = run().finally(() => {
        recovering = null;
    });
    return recovering;
}

export function resetRecoveryForTests(): void {
    recovering = null;
}
