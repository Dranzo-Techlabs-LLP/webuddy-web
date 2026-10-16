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

import { BILLING_ANSWER_WINDOW_MS } from "./constants";

/**
 * "Bill when answered" (Android `chargeForCallWhenAnswered`, spec 04 §3.6.1), as a small state machine with every
 * outside dependency injected:
 *
 *     idle --start()--> watching --peer in call--> billing --> done(billed | failed)
 *                          |  \--window elapsed--> done(not-answered)
 *                          \----cancel()---------> done(cancelled)
 *
 * The peer counts as having answered as soon as `isPeerInCall()` is true — checked immediately (a peer who is already
 * in the call when we join) and again on every `subscribe` notification — and billing happens AT MOST ONCE. A call the
 * peer never joins within the window (default 2 minutes) is free.
 */

export type BillingOutcome = "billed" | "failed" | "not-answered" | "cancelled";

export type BillingWatcherState = "idle" | "watching" | "billing" | BillingOutcome;

export interface BillingWatcherDeps {
    /** Is the other party in the call right now? (The "live membership" predicate, evaluated fresh on every call.) */
    isPeerInCall(): boolean;
    /** Be told whenever room call state may have changed. Returns the unsubscribe function. */
    subscribe(onChange: () => void): () => void;
    /** The billing step (`initiateHold` + balance refresh). A rejection is logged and reported as `failed`. */
    bill(): Promise<void>;
    /** How long to wait for the peer to join. Default: 2 minutes. */
    windowMs?: number;
}

export class CallBillingWatcher {
    private stateInternal: BillingWatcherState = "idle";
    private timer: ReturnType<typeof setTimeout> | undefined;
    private unsubscribe: (() => void) | undefined;
    private result: Promise<BillingOutcome> | undefined;
    private settle: ((outcome: BillingOutcome) => void) | undefined;

    public constructor(private readonly deps: BillingWatcherDeps) {}

    public get state(): BillingWatcherState {
        return this.stateInternal;
    }

    /** Start watching. Idempotent: a second call returns the first call's promise. Never rejects. */
    public start(): Promise<BillingOutcome> {
        if (this.result) return this.result;
        if (this.stateInternal === "cancelled") {
            this.result = Promise.resolve("cancelled");
            return this.result;
        }
        this.result = new Promise<BillingOutcome>((resolve) => {
            this.settle = resolve;
        });
        this.stateInternal = "watching";
        this.timer = setTimeout(() => this.finish("not-answered"), this.deps.windowMs ?? BILLING_ANSWER_WINDOW_MS);
        this.unsubscribe = this.deps.subscribe(() => this.check());
        this.check(); // the peer may already be there
        return this.result;
    }

    /** Stop without billing (e.g. a newer call in the same room replaces this watcher). No effect once finished. */
    public cancel(): void {
        if (this.stateInternal === "idle") {
            this.stateInternal = "cancelled";
            return;
        }
        if (this.stateInternal === "watching") this.finish("cancelled");
    }

    private check(): void {
        if (this.stateInternal !== "watching") return;
        let answered = false;
        try {
            answered = this.deps.isPeerInCall();
        } catch (e) {
            logger.warn("Clariva calls: billing predicate failed", e);
        }
        if (!answered) return;

        this.stateInternal = "billing";
        this.stopWatching();
        Promise.resolve()
            .then(() => this.deps.bill())
            .then(
                () => this.finish("billed"),
                (e) => {
                    logger.warn("Clariva calls: billing a call failed", e);
                    this.finish("failed");
                },
            );
    }

    private stopWatching(): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }

    private finish(outcome: BillingOutcome): void {
        if (this.stateInternal === "billed" || this.stateInternal === "failed") return;
        if (this.stateInternal === "not-answered" || this.stateInternal === "cancelled") return;
        this.stopWatching();
        this.stateInternal = outcome;
        this.settle?.(outcome);
    }
}
