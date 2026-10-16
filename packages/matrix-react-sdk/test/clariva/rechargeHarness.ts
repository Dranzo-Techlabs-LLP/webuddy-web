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

import { type CreateOrderResponse, type VerifyPaymentResponse } from "../../src/clariva/api/types";
import { type RazorpayCheckoutOptions } from "../../src/clariva/razorpay";
import { PendingPaymentsStore } from "../../src/clariva/wallet/pendingPayments";
import { RECONCILE_INTERVAL_MS, RechargeFlow, type RechargeFlowDeps } from "../../src/clariva/wallet/rechargeFlow";
import { ME } from "./helpers";

/** Shared fakes for the recharge tests: a Razorpay checkout double, in-memory sessionStorage and a deps bundle. */

export const ORDER: CreateOrderResponse = {
    keyId: "rzp_test_abc",
    orderId: "order_ABC",
    amountInPaise: 50000,
    currency: "INR",
    transactionId: 164,
};

/** The Razorpay checkout as a test double: remembers the options and the `payment.failed` listener. */
export class FakeRazorpay {
    public static last: FakeRazorpay | undefined;
    public static all: FakeRazorpay[] = [];
    /** Set by a test to make `open()` throw. */
    public static onOpen: (() => void) | undefined;
    public handlers: Record<string, (r: unknown) => void> = {};
    public open = jest.fn(() => {
        FakeRazorpay.onOpen?.();
    });

    public constructor(public readonly options: RazorpayCheckoutOptions) {
        FakeRazorpay.last = this;
        FakeRazorpay.all.push(this);
    }

    public on(event: string, handler: (r: unknown) => void): void {
        this.handlers[event] = handler;
    }

    public succeed(overrides: Record<string, string | undefined> = {}): void {
        this.options.handler({
            razorpay_payment_id: "pay_123",
            razorpay_order_id: "order_ABC",
            razorpay_signature: "sig_456",
            ...overrides,
        });
    }
}

/** A minimal in-memory `Storage`. */
export function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
        data,
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => void data.set(k, v),
        removeItem: (k) => void data.delete(k),
    };
}

export interface Harness {
    deps: RechargeFlowDeps;
    flow: RechargeFlow;
    storage: ReturnType<typeof memoryStorage>;
    createOrder: jest.Mock;
    verifyPayment: jest.Mock;
    getHistory: jest.Mock;
    refreshBalance: jest.Mock;
    loadCheckout: jest.Mock;
    clock: { now: number };
}

export function harness(overrides: Partial<RechargeFlowDeps> = {}, { parkReconcile = true } = {}): Harness {
    const storage = memoryStorage();
    const clock = { now: 1_000_000 };
    const createOrder = jest.fn(async () => ORDER);
    const verifyPayment = jest.fn(
        async (): Promise<VerifyPaymentResponse> => ({ success: true, newBalance: 620, transactionId: 164 }),
    );
    const getHistory = jest.fn(async () => ({ data: [], total: 0, page: 1, pageSize: 10, totalPages: 0 }));
    const refreshBalance = jest.fn(async () => undefined);
    const loadCheckout = jest.fn(async () => FakeRazorpay as never);
    const deps: RechargeFlowDeps = {
        userId: () => ME,
        createOrder,
        verifyPayment,
        getHistory,
        refreshBalance,
        currentCredits: () => 620,
        loadCheckout,
        pending: new PendingPaymentsStore(
            () => storage,
            () => clock.now,
        ),
        // verify back-offs are instant; the 10 s ledger poll is parked unless a test wants it
        sleep: (ms) => {
            if (parkReconcile && ms === RECONCILE_INTERVAL_MS) return new Promise<void>(() => {});
            clock.now += ms;
            return Promise.resolve();
        },
        now: () => clock.now,
        ...overrides,
    };
    return {
        deps,
        flow: new RechargeFlow(deps),
        storage,
        createOrder,
        verifyPayment,
        getHistory,
        refreshBalance,
        loadCheckout,
        clock,
    };
}
