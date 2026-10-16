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

import { type Room } from "matrix-js-sdk/src/matrix";

import { getClarivaConfig, isClarivaEnabled } from "../config";
import { WalletStore } from "../stores/WalletStore";
import { billingUi } from "../components/chat/gateDialogs";
import { type BillingGate, type BillingWallet, NO_BILLING, SendBilling, type SendTicket } from "./billing";
import { ChatGateController } from "./ChatGateController";
import { localStorageOptOut } from "./optOut";
import { safeDmPeerId } from "./useChatGate";

/**
 * Delegates to the CURRENT `WalletStore.instance` on every call (the singleton is replaced by tests and its state is
 * flushed on account switches), never to a captured reference.
 */
const wallet: BillingWallet = {
    get userId() {
        return WalletStore.instance.userId;
    },
    get isConsultant() {
        return WalletStore.instance.isConsultant;
    },
    getPeer: (peerId) => WalletStore.instance.getPeer(peerId),
    getCachedHoldExists: (peerId) => WalletStore.instance.getCachedHoldExists(peerId),
    checkHoldExists: (peerId) => WalletStore.instance.checkHoldExists(peerId),
    initiateHold: (peerId) => WalletStore.instance.initiateHold(peerId),
    refreshBalance: () => WalletStore.instance.refreshBalance(),
};

const gate: BillingGate = {
    knownHoldExists: (peerId) => ChatGateController.peek(peerId)?.holdExists,
    noteHoldExists: (peerId, value) => ChatGateController.noteHoldExists(peerId, value),
    revalidate: async (peerId) => {
        const live = ChatGateController.peek(peerId);
        if (live) return live.revalidate({ fresh: true });
        // No chat open for this peer (e.g. a voice message finishing after navigating away): refresh the shared
        // caches so the next open starts from the truth.
        await Promise.all([WalletStore.instance.refreshBalance(), WalletStore.instance.checkHoldExists(peerId)]);
    },
};

let instance: SendBilling | undefined;

/** Rooms with a `beforeSend` currently waiting on the network or a dialog (see `ClarivaBilling.beforeSend`). */
const sendsInProgress = new Set<string>();

function billing(): SendBilling {
    instance ??= new SendBilling({
        wallet,
        ui: billingUi,
        optOut: localStorageOptOut,
        gate,
        config: () => {
            const { hold_first: holdFirst, bill_consultants_only: billConsultantsOnly } = getClarivaConfig();
            return { holdFirst, billConsultantsOnly };
        },
    });
    return instance;
}

/**
 * Entry points for the upstream send paths (all no-ops when Clariva is disabled or the room is not a billable DM).
 *
 *     const ticket = await ClarivaBilling.beforeSend(room);   // BEFORE the composer is cleared
 *     if (!ticket) return;                                     // dismissed dialog / refused hold: keep the draft
 *     const sent = client.sendMessage(...);
 *     ClarivaBilling.afterSend(ticket, sent);                  // fire and forget
 *
 * Text messages only: edits, attachments, polls, stickers and forwards are not billed (decision, parity with
 * Android for non-text sends).
 */
export const ClarivaBilling = {
    /**
     * `null` = abort the send (the user cancelled the new-session dialog, the server refused for lack of credits, or
     * another send from this room is already waiting on its dialog / hold: a second Enter must not send the same
     * draft twice).
     */
    async beforeSend(room: Room): Promise<SendTicket | null> {
        if (!isClarivaEnabled()) return NO_BILLING;
        const peerId = safeDmPeerId(room);
        if (!peerId) return NO_BILLING; // non-DM rooms are never touched
        if (sendsInProgress.has(room.roomId)) return null;
        sendsInProgress.add(room.roomId);
        try {
            return await billing().beforeSend(peerId);
        } finally {
            sendsInProgress.delete(room.roomId);
        }
    },

    /**
     * Same as `beforeSend` for the (labs) WYSIWYG composer, whose content is a string that may be HTML. Blank content and
     * slash commands (`/invite ...`) are not billed: they are not chat messages.
     */
    async beforeSendRichText(room: Room, content: string): Promise<SendTicket | null> {
        const plain = content.replace(/<[^>]*>/g, "").trim();
        if (!plain || (plain.startsWith("/") && !plain.startsWith("//"))) return NO_BILLING;
        return ClarivaBilling.beforeSend(room);
    },

    /** Never throws, never blocks the caller. `sent` is the send promise (used only to decide whether to re-post `initiate`). */
    afterSend(ticket: SendTicket, sent?: Promise<unknown>): void {
        void billing().afterSend(ticket, sent);
    },

    /** A voice message was queued: bill after the fact, no dialog. */
    afterVoiceSend(room: Room, sent?: Promise<unknown>): void {
        if (!isClarivaEnabled()) return;
        void billing().afterVoiceSend(safeDmPeerId(room), sent);
    },

    /** Test helper. */
    resetForTests(): void {
        instance = undefined;
        sendsInProgress.clear();
    },
};
