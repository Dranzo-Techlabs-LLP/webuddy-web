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

import { getClarivaConfig } from "../config";
import { isBillablePeer } from "../chat/gate";
import { ChatGateController } from "../chat/ChatGateController";
import { type HoldResult, type PeerWalletInfo, WalletStore } from "../stores/WalletStore";

/**
 * The money step of "bill when answered" (spec 04 §3.6.2 / §6.10). Same rules as a voice message (spec 03 §3.9) and the
 * same 24 h hold the chat uses, so a call inside a paid window costs nothing extra:
 *
 *  - consultants never pay (and an unknown role fails open: not billed);
 *  - decision D5: only a peer that is a consultant with a price > 0 is billed (`bill_consultants_only`);
 *  - ONE `initiate` (the server re-uses a live hold), no retry, no UI: a refusal (insufficient credits since the gate
 *    ran, network) leaves the call free, exactly as on Android;
 *  - `holdExists` is set to `true` right after success (fixes Android's 60 s window where a client who just paid is
 *    shown as restricted), and the balance is refreshed strictly AFTER the hold so it reads the debited value.
 */

export interface CallBillingWallet {
    readonly userId: string | null;
    /** `true` consultant · `false` client · `null` unknown. */
    readonly isConsultant: boolean | null;
    refreshBalance(): Promise<void>;
    getPeer(peerId: string): Promise<PeerWalletInfo | null>;
    initiateHold(peerId: string): Promise<HoldResult>;
}

export interface CallBillingGate {
    noteHoldExists(peerId: string, value: boolean): void;
    revalidate(peerId: string): Promise<void>;
}

export type CallBillingResult = "billed" | "skipped" | "failed";

export async function billPeerAnswered(
    peerId: string,
    wallet: CallBillingWallet,
    gate: CallBillingGate,
    billConsultantsOnly: boolean,
): Promise<CallBillingResult> {
    if (!wallet.userId) return "skipped";

    let role = wallet.isConsultant;
    if (role === null) {
        await wallet.refreshBalance();
        role = wallet.isConsultant;
    }
    if (role !== false) return "skipped";

    const peer = await wallet.getPeer(peerId);
    if (!isBillablePeer(peer, billConsultantsOnly)) return "skipped";

    const hold = await wallet.initiateHold(peerId);
    let result: CallBillingResult = "billed";
    if (hold.ok) {
        if (hold.skipped) return "skipped";
        gate.noteHoldExists(peerId, true);
    } else {
        logger.warn(`Clariva calls: hold for ${peerId} refused after the call was answered: ${hold.message}`);
        result = "failed";
    }

    await wallet.refreshBalance(); // L4: strictly after the hold
    void gate.revalidate(peerId).catch(() => undefined);
    return result;
}

/** The production wiring: always the CURRENT `WalletStore.instance` (tests and account switches replace it). */
export function billPeerAnsweredForSession(peerId: string): Promise<CallBillingResult> {
    const wallet: CallBillingWallet = {
        get userId() {
            return WalletStore.instance.userId;
        },
        get isConsultant() {
            return WalletStore.instance.isConsultant;
        },
        refreshBalance: () => WalletStore.instance.refreshBalance(),
        getPeer: (id) => WalletStore.instance.getPeer(id),
        initiateHold: (id) => WalletStore.instance.initiateHold(id),
    };
    const gate: CallBillingGate = {
        noteHoldExists: (id, value) => ChatGateController.noteHoldExists(id, value),
        revalidate: async (id) => {
            const live = ChatGateController.peek(id);
            if (live) return live.revalidate({ fresh: true });
            await Promise.all([WalletStore.instance.refreshBalance(), WalletStore.instance.checkHoldExists(id)]);
        },
    };
    return billPeerAnswered(peerId, wallet, gate, getClarivaConfig().bill_consultants_only);
}
