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

import { useWalletSnapshot, usePendingRefundClients } from "../../hooks/useWallet";
import { formatCredits } from "../../money";
import { homeStrings as S } from "../../strings/home";
import { walletStrings } from "../../strings/wallet";
import { CoinIcon, Skeleton } from "../../ui";
import { openWalletSettings } from "../wallet/openSettings";
import { reviewRefunds } from "./recentChats";

/**
 * The balance on the Home dashboard: a thick glass lens with the balance as the hero number (Fraunces, whose proportional
 * numerals are fine at this size with nothing to align to) and ONE action that depends on the role.
 *  - a client (or a role that is not known yet) gets "Add credits", which opens the Wallet tab like the coin chip does (the
 *    recharge dialog lives there);
 *  - a consultant never recharges, so the card shows how many refund requests are waiting and "Review refunds", which opens
 *    the most recently active chat among the clients who asked (the refund banner and the Approve dialog are in that chat).
 * Data comes from the stores the coin chip and the Refund pill already use: no request is made from here.
 */
export function WalletCard(): JSX.Element {
    const { credits, loaded, isConsultant, balanceFailed } = useWalletSnapshot();
    const pendingClients = usePendingRefundClients();
    const consultant = isConsultant === true;
    const waiting = pendingClients.size;

    let balance: JSX.Element;
    if (loaded && credits !== null) {
        balance = (
            <>
                <span className="mx_ClarivaWalletCard_amount" data-testid="clariva-home-balance">
                    {formatCredits(credits, true)}
                </span>
                <span className="mx_ClarivaWalletCard_unit">{S.creditsUnit}</span>
            </>
        );
    } else if (balanceFailed) {
        balance = (
            <span className="mx_ClarivaWalletCard_unavailable" data-testid="clariva-home-balance-unavailable">
                {walletStrings.balanceUnavailable}
            </span>
        );
    } else {
        balance = <Skeleton width={148} height={44} radius="sm" />;
    }

    return (
        <section
            className="mx_ClarivaWalletCard"
            aria-label={S.walletCardLabel}
            aria-busy={!loaded && !balanceFailed}
            data-testid="clariva-home-wallet"
        >
            <div className="mx_ClarivaWalletCard_balance">
                <span className="mx_ClarivaWalletCard_caption">
                    {consultant ? S.earningsCaption : S.balanceCaption}
                </span>
                <div className="mx_ClarivaWalletCard_figure">
                    <CoinIcon className="mx_ClarivaWalletCard_coin" size={32} />
                    {balance}
                </div>
                <span className="mx_ClarivaWalletCard_hint">
                    {consultant ? walletStrings.balanceHintConsultant : walletStrings.balanceHintClient}
                </span>
            </div>
            <div className="mx_ClarivaWalletCard_action">
                {consultant ? (
                    <>
                        <p className="mx_ClarivaWalletCard_refunds" data-testid="clariva-home-refund-count">
                            {waiting > 0 ? S.pendingRefunds(waiting) : S.noPendingRefunds}
                        </p>
                        {waiting > 0 && (
                            <button
                                type="button"
                                className="mx_ClarivaHome_cta"
                                onClick={() => reviewRefunds(pendingClients)}
                                data-testid="clariva-home-review-refunds"
                            >
                                {S.reviewRefunds}
                            </button>
                        )}
                    </>
                ) : (
                    <button
                        type="button"
                        className="mx_ClarivaHome_cta"
                        onClick={() => openWalletSettings()}
                        data-testid="clariva-home-add-credits"
                    >
                        {S.addCredits}
                    </button>
                )}
            </div>
        </section>
    );
}

export default WalletCard;
