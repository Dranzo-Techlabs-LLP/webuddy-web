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

import React from "react";
import { Button } from "@vector-im/compound-web";
import InfoIcon from "@vector-im/compound-design-tokens/assets/web/icons/info";

import { chatStrings } from "../../strings/chat";
import { formatCredits } from "../../money";
import { openWalletSettings } from "../wallet/openSettings";

interface Props {
    /** My balance, or `null` while unknown. */
    credits: number | null;
    /** The consultant's price per 24 h chat, or `null` while unknown. */
    required: number | null;
    /**
     * Both sides are consultants (Android `isConsultantPeerBlocked`): say why instead of the wallet reason, and offer no
     * Recharge (more credits would not help).
     */
    consultantPeer?: boolean;
}

/**
 * The "Chat restricted" bar (spec 03 U1) that REPLACES the whole composer when a client without a covering hold cannot
 * afford the consultant's session price. Line 2 only when both numbers are known. The "Recharge" button is a web
 * improvement (Android's bar has no action): a real secondary <button> that opens the Wallet settings tab.
 *
 * In a consultant <-> consultant chat the same bar reads "You can't chat with other consultants." / "Consultants can
 * only chat with clients." (Android DisabledComposerView), without the Recharge button.
 */
export function ChatRestrictedBar({ credits, required, consultantPeer = false }: Props): JSX.Element {
    if (consultantPeer) {
        return (
            <div
                className="mx_ClarivaChatRestricted mx_ClarivaChatRestricted_consultantPeer"
                role="status"
                data-testid="clariva-chat-restricted"
                data-reason="consultant-peer"
            >
                <InfoIcon className="mx_ClarivaChatRestricted_icon" width="20px" height="20px" aria-hidden="true" />
                <div className="mx_ClarivaChatRestricted_text">
                    <div className="mx_ClarivaChatRestricted_title">{chatStrings.gateConsultantPeerTitle}</div>
                    <div className="mx_ClarivaChatRestricted_amounts">{chatStrings.gateConsultantPeerSubtitle}</div>
                </div>
            </div>
        );
    }
    const showAmounts = credits !== null && required !== null;
    return (
        <div className="mx_ClarivaChatRestricted" role="status" data-testid="clariva-chat-restricted">
            <InfoIcon className="mx_ClarivaChatRestricted_icon" width="20px" height="20px" aria-hidden="true" />
            <div className="mx_ClarivaChatRestricted_text">
                <div className="mx_ClarivaChatRestricted_title">{chatStrings.gateRestricted}</div>
                {showAmounts && (
                    <div className="mx_ClarivaChatRestricted_amounts">
                        {chatStrings.gateCurrentRequired(formatCredits(credits), formatCredits(required))}
                    </div>
                )}
            </div>
            <Button
                kind="secondary"
                size="sm"
                className="mx_ClarivaChatRestricted_recharge"
                onClick={openWalletSettings}
                data-testid="clariva-chat-restricted-recharge"
            >
                {chatStrings.gateRecharge}
            </Button>
        </div>
    );
}
