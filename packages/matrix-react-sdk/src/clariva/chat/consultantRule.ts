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

import Modal from "../../Modal";
import ErrorDialog from "../../components/views/dialogs/ErrorDialog";
import { isClarivaEnabled } from "../config";
import { WalletStore } from "../stores/WalletStore";
import { chatStrings } from "../strings/chat";

/**
 * Consultants may only chat with clients (Android ee053dc156). A consultant must not CREATE a DM with another
 * consultant; an EXISTING consultant <-> consultant DM still opens, but its composer is replaced by a bar (see
 * `decideGate`, row "consultant-peer").
 */

/** Android `ConsultantChatNotAllowedException`: retrying cannot succeed, so it is shown without a retry. */
export class ConsultantChatNotAllowedError extends Error {
    public readonly name = "ConsultantChatNotAllowedError";

    public constructor() {
        super(chatStrings.consultantChatNotAllowedMessage);
        Object.setPrototypeOf(this, ConsultantChatNotAllowedError.prototype);
    }
}

/**
 * The one peer the rule applies to, or null: Clariva must be configured and the targets must be exactly one Matrix
 * user other than me (an e-mail invite, a group chat or a chat with yourself is never refused).
 */
export function consultantRulePeer(myUserId: string | null, targetIds: readonly string[]): string | null {
    if (!isClarivaEnabled() || targetIds.length !== 1) return null;
    const [peerId] = targetIds;
    if (!peerId.startsWith("@") || peerId === myUserId) return null;
    return peerId;
}

/**
 * True only when BOTH users are CONFIRMED consultants (Android `DefaultStartDMAction.isConsultantToConsultant`). My role
 * comes from the wallet snapshot (re-read once when it is still unknown), the peer's from the cache-first peer lookup.
 * Clients never look the peer up. An unknown role, or any failure, fails open.
 */
export async function isConsultantToConsultant(peerId: string): Promise<boolean> {
    try {
        const wallet = WalletStore.instance;
        if (!wallet.userId) return false;
        if (wallet.isConsultant === null) await wallet.refreshBalance();
        if (wallet.isConsultant !== true) return false;
        const peer = await wallet.getPeer(peerId);
        return peer?.isConsultant === true;
    } catch (e) {
        logger.debug("Clariva: could not check the consultant chat rule", e);
        return false;
    }
}

/** The warning of Android's StartChatView / UserProfileView: "Can't start chat", a single OK, no retry. */
export function showConsultantChatNotAllowed(): Promise<void> {
    const { finished } = Modal.createDialog(ErrorDialog, {
        title: chatStrings.consultantChatNotAllowedTitle,
        description: chatStrings.consultantChatNotAllowedMessage,
    });
    return finished.then(() => undefined);
}

/**
 * Call where a DM is about to be CREATED (no DM with the target exists). Resolves true, after showing the warning,
 * when the consultant <-> consultant rule refuses it; the caller then must not create anything.
 */
export async function refuseConsultantDm(myUserId: string | null, targetIds: readonly string[]): Promise<boolean> {
    const peerId = consultantRulePeer(myUserId, targetIds);
    if (!peerId || !(await isConsultantToConsultant(peerId))) return false;
    void showConsultantChatNotAllowed();
    return true;
}

/**
 * `create()` unless the rule refuses the DM. Runs `create` synchronously when the rule cannot apply (stock Element Web,
 * group chats...), so callers outside Clariva keep their exact timing.
 */
export function createDmUnlessRefused(myUserId: string | null, targetIds: readonly string[], create: () => void): void {
    if (!consultantRulePeer(myUserId, targetIds)) {
        create();
        return;
    }
    void refuseConsultantDm(myUserId, targetIds).then((refused) => {
        if (!refused) create();
    });
}
