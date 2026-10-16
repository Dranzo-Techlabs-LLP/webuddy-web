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

import React, { useEffect } from "react";
import classNames from "classnames";

import { isClarivaEnabled } from "../../config";
import { useWalletSnapshot } from "../../hooks/useWallet";
import { formatCredits } from "../../money";
import { walletStrings as S } from "../../strings/wallet";
import { recoverPendingPayments } from "../../wallet/rechargeFlow";
import { openWalletSettings } from "./openSettings";
import { WalletIcon } from "./icons";

interface Props {
    /** The left panel is collapsed to icons: show the glyph only (the full text stays in the tooltip/label). */
    isMinimized?: boolean;
}

/** The text of the chip: "N credits" once the first balance arrived, "Loading..." until then (never an invented 0). */
export function chipText(credits: number | null, loaded: boolean): string {
    return loaded && credits !== null ? S.credits(formatCredits(credits)) : S.loading;
}

function WalletChipInner({ isMinimized }: Props): JSX.Element {
    const { credits, loaded, isConsultant, userId } = useWalletSnapshot();

    // A reload in the middle of a payment: resolve whatever the previous page left in sessionStorage.
    useEffect(() => {
        if (userId) void recoverPendingPayments();
    }, [userId]);

    const text = chipText(credits, loaded);
    // Every role sees a balance (Android parity); a consultant's is the earnings accumulated from settled chats.
    const title = isConsultant === true ? S.chipTitleConsultant : S.chipTitleClient;

    return (
        <button
            type="button"
            className={classNames("mx_ClarivaWalletChip", { mx_ClarivaWalletChip_minimized: isMinimized })}
            onClick={() => openWalletSettings()}
            title={isMinimized ? `${title}: ${text}` : title}
            aria-label={`${S.wallet}, ${text}`}
            data-testid="clariva-wallet-chip"
        >
            <WalletIcon className="mx_ClarivaWalletChip_icon" aria-hidden="true" />
            {!isMinimized && <span className="mx_ClarivaWalletChip_text">{text}</span>}
        </button>
    );
}

/**
 * The balance chip at the top of the left panel (Android: the wallet chip in the home top bar). Click opens the
 * Wallet tab of the settings dialog. Renders nothing when Clariva is not configured.
 */
export function WalletChip(props: Props): JSX.Element | null {
    if (!isClarivaEnabled()) return null;
    return (
        <div className="mx_ClarivaWalletBar">
            <WalletChipInner {...props} />
        </div>
    );
}

export default WalletChip;
