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

import Modal from "../../../Modal";
import ErrorDialog from "../../../components/views/dialogs/ErrorDialog";
import QuestionDialog from "../../../components/views/dialogs/QuestionDialog";
import { chatStrings } from "../../strings/chat";
import { type BillingUi, type NewSessionAnswer } from "../../chat/billing";
import { type GateReason } from "../../chat/gate";
import { openWalletSettings } from "../wallet/openSettings";
import { NewSessionDialog } from "./NewSessionDialog";

/** Show the "Start a new session?" dialog and resolve with the user's decision. */
export async function confirmNewSession(): Promise<NewSessionAnswer> {
    const { finished } = Modal.createDialog(NewSessionDialog, {});
    // Closing by Esc / clicking outside resolves with no arguments: that is a Cancel.
    const [proceed, neverRemind] = await finished;
    return { proceed: proceed === true, neverRemind: proceed === true && neverRemind === true };
}

/**
 * The server refused the hold (400 "Insufficient credits: need X, have Y. Please recharge to start this chat."). Show
 * the server's own message (spec 03 §4.12) with a shortcut to the Wallet tab. The draft stays in the composer.
 */
export function showInsufficientCredits(message: string | undefined): void {
    Modal.createDialog(QuestionDialog, {
        title: chatStrings.sessionInsufficientTitle,
        description: message?.trim() || chatStrings.sessionInsufficientFallback,
        button: chatStrings.gateRecharge,
        cancelButton: chatStrings.sessionInsufficientClose,
        onFinished: (recharge?: boolean) => {
            if (recharge) openWalletSettings();
        },
    });
}

/** The title a guard without a composer bar shows for a restricted chat (worded like the bar for that reason). */
export function chatRestrictedTitle(reason: GateReason | null | undefined): string {
    return reason === "consultant-peer" ? chatStrings.gateConsultantPeerTitle : chatStrings.gateRestricted;
}

/**
 * A restricted chat was sent to through a path that has no composer bar (drag-and-drop, paste, attach). A
 * consultant <-> consultant DM gets the bar's own wording (Android DisabledComposerView), not the wallet text.
 */
export function showChatRestrictedNotice(reason?: GateReason | null): void {
    Modal.createDialog(ErrorDialog, {
        title: chatRestrictedTitle(reason),
        description: reason === "consultant-peer" ? chatStrings.gateConsultantPeerSubtitle : undefined,
        button: chatStrings.sessionInsufficientClose,
    });
}

/** The UI half of the billing wiring. */
export const billingUi: BillingUi = {
    confirmNewSession: () => confirmNewSession(),
    showInsufficientCredits,
};
