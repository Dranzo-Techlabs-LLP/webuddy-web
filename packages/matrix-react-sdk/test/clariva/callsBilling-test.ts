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

import { CallBillingWatcher, type BillingWatcherDeps } from "../../src/clariva/calls/billingWatcher";
import { type CallBillingGate, type CallBillingWallet, billPeerAnswered } from "../../src/clariva/calls/callBilling";
import { BILLING_ANSWER_WINDOW_MS } from "../../src/clariva/calls/constants";
import { type HoldResult } from "../../src/clariva/stores/WalletStore";

const PEER = "@rao:clarivahub.com";

/** Let the promise chain behind `start()` / `bill()` settle. */
const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("CallBillingWatcher (bill when answered, spec 04 §3.6.1)", () => {
    let peerIn: boolean;
    let notify: (() => void) | undefined;
    let unsubscribed: number;
    let bill: jest.Mock;

    const deps = (overrides: Partial<BillingWatcherDeps> = {}): BillingWatcherDeps => ({
        isPeerInCall: () => peerIn,
        subscribe: (onChange) => {
            notify = onChange;
            return () => {
                unsubscribed++;
                notify = undefined;
            };
        },
        bill,
        ...overrides,
    });

    beforeEach(() => {
        jest.useFakeTimers();
        peerIn = false;
        notify = undefined;
        unsubscribed = 0;
        bill = jest.fn(async () => undefined);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("bills once when the peer joins, and stops watching", async () => {
        const watcher = new CallBillingWatcher(deps());
        const outcome = watcher.start();
        expect(watcher.state).toBe("watching");
        expect(bill).not.toHaveBeenCalled();

        jest.advanceTimersByTime(30_000);
        peerIn = true;
        notify?.();
        await expect(outcome).resolves.toBe("billed");
        expect(bill).toHaveBeenCalledTimes(1);
        expect(watcher.state).toBe("billed");
        expect(unsubscribed).toBe(1);

        // a later notification (or the old window timer) must not bill again
        notify?.();
        jest.advanceTimersByTime(BILLING_ANSWER_WINDOW_MS * 2);
        await settle();
        expect(bill).toHaveBeenCalledTimes(1);
    });

    it("bills at once when the peer is already in the call (Join case)", async () => {
        peerIn = true;
        const watcher = new CallBillingWatcher(deps());
        await expect(watcher.start()).resolves.toBe("billed");
        expect(bill).toHaveBeenCalledTimes(1);
    });

    it("a call nobody answers within 2 minutes is free", async () => {
        const watcher = new CallBillingWatcher(deps());
        const outcome = watcher.start();
        jest.advanceTimersByTime(BILLING_ANSWER_WINDOW_MS - 1);
        expect(watcher.state).toBe("watching");
        jest.advanceTimersByTime(1);
        await expect(outcome).resolves.toBe("not-answered");
        expect(bill).not.toHaveBeenCalled();
        expect(unsubscribed).toBe(1);

        // too late: joining after the window does not bill
        peerIn = true;
        notify?.();
        await settle();
        expect(bill).not.toHaveBeenCalled();
    });

    it("the window is 2 minutes by default and can be shortened", async () => {
        expect(BILLING_ANSWER_WINDOW_MS).toBe(120_000);
        const watcher = new CallBillingWatcher(deps({ windowMs: 5_000 }));
        const outcome = watcher.start();
        jest.advanceTimersByTime(5_000);
        await expect(outcome).resolves.toBe("not-answered");
    });

    it("cancel() stops without billing; cancelling before start() keeps it cancelled", async () => {
        const watcher = new CallBillingWatcher(deps());
        const outcome = watcher.start();
        watcher.cancel();
        await expect(outcome).resolves.toBe("cancelled");
        peerIn = true;
        notify?.();
        jest.advanceTimersByTime(BILLING_ANSWER_WINDOW_MS);
        await settle();
        expect(bill).not.toHaveBeenCalled();

        const early = new CallBillingWatcher(deps());
        early.cancel();
        await expect(early.start()).resolves.toBe("cancelled");
        expect(bill).not.toHaveBeenCalled();
    });

    it("cancel() cannot take back a bill that is already in flight", async () => {
        let finishBill: () => void = () => undefined;
        bill = jest.fn(() => new Promise<void>((resolve) => (finishBill = resolve)));
        peerIn = true;
        const watcher = new CallBillingWatcher(deps());
        const outcome = watcher.start();
        await settle();
        expect(watcher.state).toBe("billing");
        watcher.cancel();
        expect(watcher.state).toBe("billing");
        finishBill();
        await expect(outcome).resolves.toBe("billed");
    });

    it("reports a failed bill without throwing", async () => {
        bill = jest.fn(async () => {
            throw new Error("network");
        });
        peerIn = true;
        const watcher = new CallBillingWatcher(deps());
        await expect(watcher.start()).resolves.toBe("failed");
        expect(watcher.state).toBe("failed");
    });

    it("a throwing predicate is treated as 'not answered yet'", async () => {
        let boom = true;
        const watcher = new CallBillingWatcher(
            deps({
                isPeerInCall: () => {
                    if (boom) throw new Error("state not ready");
                    return true;
                },
            }),
        );
        const outcome = watcher.start();
        expect(watcher.state).toBe("watching");
        boom = false;
        notify?.();
        await expect(outcome).resolves.toBe("billed");
    });

    it("start() is idempotent", async () => {
        peerIn = true;
        const watcher = new CallBillingWatcher(deps());
        const a = watcher.start();
        const b = watcher.start();
        expect(b).toBe(a);
        await a;
        expect(bill).toHaveBeenCalledTimes(1);
    });
});

describe("billPeerAnswered (the money step)", () => {
    let calls: string[];
    let wallet: CallBillingWallet & { role: boolean | null; hold: HoldResult };
    let gate: CallBillingGate;
    let peer: { maxCredits: number | null; isConsultant: boolean | null; fetchedAt: number } | null;

    beforeEach(() => {
        calls = [];
        peer = { maxCredits: 100, isConsultant: true, fetchedAt: 0 };
        wallet = {
            userId: "@asha:clarivahub.com",
            role: false,
            hold: { ok: true, skipped: false },
            get isConsultant() {
                return this.role;
            },
            refreshBalance: async () => {
                calls.push("refreshBalance");
            },
            getPeer: async () => peer,
            initiateHold: async (id: string) => {
                calls.push(`initiateHold:${id}`);
                return wallet.hold;
            },
        };
        gate = {
            noteHoldExists: (id, value) => {
                calls.push(`noteHoldExists:${id}:${value}`);
            },
            revalidate: async (id) => {
                calls.push(`revalidate:${id}`);
            },
        };
    });

    it("a client calling a consultant pays: hold, hold known immediately, balance AFTER the hold", async () => {
        await expect(billPeerAnswered(PEER, wallet, gate, true)).resolves.toBe("billed");
        expect(calls).toEqual([
            `initiateHold:${PEER}`,
            `noteHoldExists:${PEER}:true`,
            "refreshBalance",
            `revalidate:${PEER}`,
        ]);
    });

    it("consultants never pay", async () => {
        wallet.role = true;
        await expect(billPeerAnswered(PEER, wallet, gate, true)).resolves.toBe("skipped");
        expect(calls).toEqual([]);
    });

    it("an unknown role is resolved first; if it stays unknown nothing is billed (fail open)", async () => {
        wallet.role = null;
        await expect(billPeerAnswered(PEER, wallet, gate, true)).resolves.toBe("skipped");
        expect(calls).toEqual(["refreshBalance"]);
    });

    it("an unknown role that resolves to client is billed", async () => {
        wallet.role = null;
        wallet.refreshBalance = async () => {
            calls.push("refreshBalance");
            wallet.role = false;
        };
        await expect(billPeerAnswered(PEER, wallet, gate, true)).resolves.toBe("billed");
    });

    it("decision D5: client-to-client and unknown peers are not billed", async () => {
        peer = { maxCredits: null, isConsultant: false, fetchedAt: 0 };
        await expect(billPeerAnswered(PEER, wallet, gate, true)).resolves.toBe("skipped");
        peer = null;
        await expect(billPeerAnswered(PEER, wallet, gate, true)).resolves.toBe("skipped");
        peer = { maxCredits: 0, isConsultant: true, fetchedAt: 0 };
        await expect(billPeerAnswered(PEER, wallet, gate, true)).resolves.toBe("skipped");
        expect(calls).toEqual([]);
        // with the flag off Android's behaviour: every DM peer is billable
        peer = { maxCredits: null, isConsultant: false, fetchedAt: 0 };
        await expect(billPeerAnswered(PEER, wallet, gate, false)).resolves.toBe("billed");
    });

    it("a refused hold leaves the call free: no retry, no 'hold exists', balance still refreshed", async () => {
        wallet.hold = {
            ok: false,
            status: 400,
            message: "Insufficient credits: need 100, have 20.",
            insufficientCredits: true,
            isNetwork: false,
        };
        await expect(billPeerAnswered(PEER, wallet, gate, true)).resolves.toBe("failed");
        expect(calls).toEqual([`initiateHold:${PEER}`, "refreshBalance", `revalidate:${PEER}`]);
    });

    it("a hold the store skipped (consultant short-circuit) is not a bill", async () => {
        wallet.hold = { ok: true, skipped: true };
        await expect(billPeerAnswered(PEER, wallet, gate, true)).resolves.toBe("skipped");
        expect(calls).toEqual([`initiateHold:${PEER}`]);
    });

    it("signed out: nothing happens", async () => {
        (wallet as any).userId = null;
        await expect(billPeerAnswered(PEER, wallet, gate, true)).resolves.toBe("skipped");
        expect(calls).toEqual([]);
    });
});
