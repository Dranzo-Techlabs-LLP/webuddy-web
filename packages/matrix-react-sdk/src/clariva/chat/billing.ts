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

import { type HoldResult, type PeerWalletInfo } from "../stores/WalletStore";
import { isBillablePeer } from "./gate";

/**
 * The send-time billing algorithm (docs/clariva/spec/03-chat-gate-holds-refunds.md §3.4 + decision D5), written as a
 * dependency-injected class with NO React / Matrix / DOM imports so it can be unit-tested with fakes. The wiring to
 * the real WalletStore, localStorage and dialogs lives in `ClarivaBilling.ts`.
 *
 * Differences from Android (all deliberate, see PLAN D5 and spec 03 §7):
 *  - HOLD-FIRST: when no covering hold is confirmed, `initiate` is awaited BEFORE the message is sent and only an
 *    explicit "insufficient credits" blocks it. Network / 5xx / any other failure fails OPEN (the message goes out,
 *    the post-send step retries `initiate` once).
 *  - Only consultant peers with a price > 0 are billed (`bill_consultants_only`).
 *  - Single-flight per peer: two quick first sends neither show the dialog twice nor race two `initiate` calls.
 *  - An unknown own role is resolved first; if it stays unknown the send is simply not billed (fail open).
 *  - A stale cached `false` is re-checked on the spot before telling the user a "new session" starts (L2/L5).
 *
 * Android parity kept: consultants skip everything; the dialog is per consultant with a local opt-out; every text
 * send re-posts the idempotent `initiate` after the message (covers a hold that expired since the last check); the
 * balance is refreshed AFTER the hold (L4); voice messages bill after a successful send without a dialog.
 */

/** What `beforeSend` learned, handed back to `afterSend`. */
export type SendTicket =
    | { kind: "none" }
    /** A hold confirmed to cover this message. */
    | { kind: "covered"; peerId: string }
    /** We created / re-used the hold ourselves just now (hold-first). */
    | { kind: "created"; peerId: string }
    /** Billable but the hold could not be confirmed (failed open, or `hold_first` is off): `afterSend` initiates. */
    | { kind: "unconfirmed"; peerId: string };

export const NO_BILLING: SendTicket = Object.freeze({ kind: "none" });

export interface BillingWallet {
    readonly userId: string | null;
    /** `true` consultant · `false` client · `null` unknown. */
    readonly isConsultant: boolean | null;
    getPeer(peerId: string): Promise<PeerWalletInfo | null>;
    getCachedHoldExists(peerId: string): boolean | undefined;
    checkHoldExists(peerId: string): Promise<boolean | null>;
    initiateHold(peerId: string): Promise<HoldResult>;
    refreshBalance(): Promise<void>;
}

export interface NewSessionAnswer {
    proceed: boolean;
    neverRemind: boolean;
}

export interface BillingUi {
    /** The "Start a new session?" dialog. Resolves once the user decided. */
    confirmNewSession(peerId: string): Promise<NewSessionAnswer>;
    /** The server refused the hold for lack of credits; `message` is the server's own text. */
    showInsufficientCredits(message: string | undefined): void;
}

export interface BillingOptOut {
    isOptedOut(me: string, peerId: string): boolean;
    optOut(me: string, peerId: string): void;
}

/** Hooks into the gate controller so the UI learns about a new hold immediately, without waiting for a re-check. */
export interface BillingGate {
    /** The gate's current knowledge of the hold state, if a controller is live for this peer. */
    knownHoldExists(peerId: string): boolean | null | undefined;
    noteHoldExists(peerId: string, value: boolean): void;
    /** Re-check balance, hold and rate (a fresh round). Fire-and-forget. */
    revalidate(peerId: string): Promise<void>;
}

export interface BillingConfig {
    holdFirst: boolean;
    billConsultantsOnly: boolean;
}

export interface BillingDeps {
    wallet: BillingWallet;
    ui: BillingUi;
    optOut: BillingOptOut;
    gate: BillingGate;
    config: () => BillingConfig;
}

export class SendBilling {
    private readonly pending = new Map<string, Promise<SendTicket | null>>();

    public constructor(private readonly deps: BillingDeps) {}

    /**
     * Run BEFORE a text message is sent (and before the composer is cleared). Resolves to `null` when the send must
     * be aborted (the user cancelled the dialog, or the server refused the hold for lack of credits); the draft is
     * then left untouched. Otherwise resolves to the ticket to hand to `afterSend`.
     */
    public async beforeSend(peerId: string | null): Promise<SendTicket | null> {
        const { wallet } = this.deps;
        if (!peerId || !wallet.userId) return NO_BILLING;

        // Consultants never pay. An unknown role is resolved first (it arrives with the balance); if it stays unknown
        // we fail open and do not bill (Android would treat it as a client and let the server 403 it).
        let role = wallet.isConsultant;
        if (role === null) {
            await wallet.refreshBalance();
            role = wallet.isConsultant;
        }
        if (role !== false) return NO_BILLING;

        // Single flight: a second send while the dialog / `initiate` of the first is open joins it.
        const existing = this.pending.get(peerId);
        if (existing) return existing;
        const run = this.decide(peerId);
        this.pending.set(peerId, run);
        const clear = (): void => {
            if (this.pending.get(peerId) === run) this.pending.delete(peerId);
        };
        void run.then(clear, clear);
        return run;
    }

    private async decide(peerId: string): Promise<SendTicket | null> {
        const { wallet, ui, optOut, gate } = this.deps;
        const config = this.deps.config();
        const me = wallet.userId;
        if (!me) return NO_BILLING;

        // D5: is this chat billed at all?
        const peer = await wallet.getPeer(peerId);
        if (!isBillablePeer(peer, config.billConsultantsOnly)) return NO_BILLING;

        // What do we know about the hold? Gate state (live, revalidated) first, then the WalletStore cache. A confirmed
        // `true` needs no network: the message is covered.
        if ((gate.knownHoldExists(peerId) ?? wallet.getCachedHoldExists(peerId)) === true) {
            return { kind: "covered", peerId };
        }

        // Anything else (`false`, or `null` = never checked / last check failed) is resolved on the spot, ASSIGNED
        // DIRECTLY: `null` (unknown) when this check fails too. That resolves an unknown state so the first send of a
        // fresh session is not silently un-warned (L5), and it keeps a stale cached `false` from producing a wrong
        // "session ended" warning (L2: a failed re-check clears it, and a blip must not show a warning).
        const known = await wallet.checkHoldExists(peerId);
        if (known === true) {
            gate.noteHoldExists(peerId, true);
            return { kind: "covered", peerId };
        }

        // No covering hold (false); still unknown (null) skips the dialog and lets `initiate` (idempotent) decide.
        if (known === false && !optOut.isOptedOut(me, peerId)) {
            const answer = await ui.confirmNewSession(peerId);
            if (!answer.proceed) return null; // Cancel / dismiss: nothing sent, the draft stays
            if (answer.neverRemind) optOut.optOut(me, peerId);
        }

        if (!config.holdFirst) return { kind: "unconfirmed", peerId };

        // Hold-first: the message is only sent once the hold exists.
        const hold = await wallet.initiateHold(peerId);
        if (hold.ok) {
            if (hold.skipped) return NO_BILLING;
            gate.noteHoldExists(peerId, true);
            return { kind: "created", peerId };
        }
        if (hold.insufficientCredits) {
            ui.showInsufficientCredits(hold.message);
            void gate.revalidate(peerId); // the balance we gated on was stale: show the restricted bar if now due
            return null;
        }
        // Network / 5xx / unknown (also "consultant not found", "consultants cannot hold"): fail OPEN, retry in afterSend.
        logger.warn(`Clariva billing: hold for ${peerId} not confirmed (${hold.status}); sending anyway`);
        return { kind: "unconfirmed", peerId };
    }

    /**
     * Run once the message has been handed to the SDK. `sent` is the send promise: its outcome only decides whether
     * `initiate` is (re)posted, the balance / hold / rate are re-read either way. Never throws.
     */
    public async afterSend(ticket: SendTicket, sent?: Promise<unknown>): Promise<void> {
        if (ticket.kind === "none") return;
        const { wallet, gate } = this.deps;
        const { peerId } = ticket;
        try {
            let delivered = true;
            if (sent) {
                try {
                    await sent;
                } catch {
                    delivered = false; // the hold (if any) already exists; do not start a NEW one for an undelivered message
                }
            }
            if (delivered && ticket.kind !== "created") {
                // covered: the idempotent post Android does on every text send (safety net if the hold expired since the
                // last check). unconfirmed: the single retry of a failed / skipped hold-first `initiate`.
                const hold = await wallet.initiateHold(peerId);
                if (hold.ok && !hold.skipped) gate.noteHoldExists(peerId, true);
                else if (!hold.ok)
                    logger.debug(`Clariva billing: post-send hold for ${peerId} failed: ${hold.message}`);
            }
            await wallet.refreshBalance(); // L4: strictly AFTER the hold, or the refresh reads the pre-debit value
        } catch (e) {
            logger.warn("Clariva billing: post-send step failed", e);
        } finally {
            void gate.revalidate(peerId); // detached: re-check hold + rate (clients)
        }
    }

    /**
     * A voice message was sent: bill after the fact, no dialog (spec 03 §3.9). Same peer / role rules as text.
     */
    public async afterVoiceSend(peerId: string | null, sent?: Promise<unknown>): Promise<void> {
        const { wallet } = this.deps;
        if (!peerId || !wallet.userId) return;
        try {
            let role = wallet.isConsultant;
            if (role === null) {
                await wallet.refreshBalance();
                role = wallet.isConsultant;
            }
            if (role !== false) return;
            const peer = await wallet.getPeer(peerId);
            if (!isBillablePeer(peer, this.deps.config().billConsultantsOnly)) return;
        } catch (e) {
            logger.warn("Clariva billing: voice billing check failed", e);
            return;
        }
        await this.afterSend({ kind: "unconfirmed", peerId }, sent);
    }
}
