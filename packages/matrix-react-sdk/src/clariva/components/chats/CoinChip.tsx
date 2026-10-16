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

import React, { useEffect, useState } from "react";

import { isClarivaEnabled } from "../../config";
import { useWalletSnapshot } from "../../hooks/useWallet";
import { walletStrings as S } from "../../strings/wallet";
import { recoverPendingPayments } from "../../wallet/rechargeFlow";
import { CoinIcon } from "../../ui";
import { chipText } from "../wallet/WalletChip";
import { openWalletSettings } from "../wallet/openSettings";
import { useMediaQuery } from "../shell/useMediaQuery";

/** Hover is real on a mouse or trackpad; a touch screen has none, so it never gets a hover-only flourish. */
export const HOVER_IS_REAL_QUERY = "(hover: hover) and (pointer: fine)";

function isKeyboardFocus(target: HTMLElement): boolean {
    try {
        return target.matches(":focus-visible");
    } catch {
        return false; // an engine without :focus-visible: no glint rather than a wrong one
    }
}

/**
 * The balance chip of the Chats list header ("coin chip"): the amber coin and the balance in tabular numerals on thin
 * glass. Same behaviour as the stock `WalletChip` (it replaces it in the Clariva header): click opens the Wallet tab, the
 * accessible name is "Wallet, N credits", and a reload in the middle of a payment is recovered. The coin plays one
 * specular glint on mouse hover or keyboard focus, only where hover is real (never on a touch screen, never at rest).
 */
export function ClarivaCoinChip(): JSX.Element | null {
    const enabled = isClarivaEnabled();
    const { credits, loaded, isConsultant, userId } = useWalletSnapshot();
    const hoverIsReal = useMediaQuery(HOVER_IS_REAL_QUERY);
    const [glint, setGlint] = useState(false);

    // A reload in the middle of a payment: resolve whatever the previous page left in sessionStorage.
    useEffect(() => {
        if (enabled && userId) void recoverPendingPayments();
    }, [enabled, userId]);

    if (!enabled) return null;

    const text = chipText(credits, loaded);
    // Every role sees a balance (Android parity); a consultant's is the earnings accumulated from settled chats.
    const title = isConsultant === true ? S.chipTitleConsultant : S.chipTitleClient;

    return (
        <button
            type="button"
            className="mx_ClarivaCoinChip"
            onClick={() => openWalletSettings()}
            onMouseEnter={() => hoverIsReal && setGlint(true)}
            onMouseLeave={() => setGlint(false)}
            onFocus={(ev) => {
                if (hoverIsReal && isKeyboardFocus(ev.currentTarget)) setGlint(true);
            }}
            onBlur={() => setGlint(false)}
            title={title}
            aria-label={`${S.wallet}, ${text}`}
            data-testid="clariva-wallet-chip"
        >
            <CoinIcon className="mx_ClarivaCoinChip_coin" size={22} glint={glint} />
            <span className="mx_ClarivaCoinChip_text">{text}</span>
        </button>
    );
}

export default ClarivaCoinChip;
