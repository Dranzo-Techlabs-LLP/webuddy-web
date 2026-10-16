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
import classNames from "classnames";
import { Button } from "@vector-im/compound-web";

import Modal from "../../../Modal";
import SettingsTab from "../../../components/views/settings/tabs/SettingsTab";
import { SettingsSection } from "../../../components/views/settings/shared/SettingsSection";
import { SettingsSubsection } from "../../../components/views/settings/shared/SettingsSubsection";
import { useTransactionHistory, type TransactionHistory } from "../../hooks/useTransactionHistory";
import { useWalletSnapshot } from "../../hooks/useWallet";
import { formatCredits } from "../../money";
import { WalletStore } from "../../stores/WalletStore";
import { CoinIcon } from "../../ui";
import { walletStrings as S } from "../../strings/wallet";
import { type WalletTransaction } from "../../api/types";
import { recoverPendingPayments, type RecoveredPayment } from "../../wallet/rechargeFlow";
import RechargeDialog from "./RechargeDialog";
import { TransactionList } from "./TransactionList";
import TransactionDetailDialog from "./TransactionDetailDialog";

/**
 * Consultants never recharge (spec 02 §3.1, §6.6): the Recharge button is hidden only when the role is *confirmed*
 * to be consultant. While the role is still unknown (null) it stays visible, exactly like Android.
 */
export function canRecharge(isConsultant: boolean | null): boolean {
    return isConsultant !== true;
}

interface BalanceProps {
    credits: number | null;
    loaded: boolean;
    balanceFailed: boolean;
    isConsultant: boolean | null;
    onRecharge: () => void;
    onRetry: () => void;
}

/**
 * The wallet card: "Current Balance", the hero "N credits" in the display face with the coin, and "Add credits" for clients.
 * Pure view, so it is testable on its own.
 */
export function BalanceHeader({
    credits,
    loaded,
    balanceFailed,
    isConsultant,
    onRecharge,
    onRetry,
}: BalanceProps): JSX.Element {
    const known = loaded && credits !== null;
    let value: React.ReactNode;
    if (known) {
        value = S.credits(formatCredits(credits, true));
    } else if (balanceFailed) {
        value = (
            <span className="mx_ClarivaWallet_unavailable" role="alert">
                {S.balanceUnavailable}{" "}
                <Button kind="secondary" size="sm" className="mx_Dialog_nonDialogButton" onClick={onRetry}>
                    {S.retry}
                </Button>
            </span>
        );
    } else {
        value = S.loading;
    }

    // a quiet line under the number; nothing while the role is still unknown
    const hint = isConsultant === true ? S.balanceHintConsultant : isConsultant === false ? S.balanceHintClient : null;

    return (
        <div className="mx_ClarivaWallet_balance" data-testid="clariva-wallet-balance">
            <span className="mx_ClarivaWallet_balanceIcon" aria-hidden="true">
                {/* the glint plays once, when the balance first becomes known (a state indication, not an idle shimmer) */}
                <CoinIcon size={36} glint={known} />
            </span>
            <div className="mx_ClarivaWallet_balanceText">
                <div className="mx_ClarivaWallet_balanceLabel">{S.currentBalance}</div>
                <div
                    className={classNames("mx_ClarivaWallet_balanceValue", {
                        mx_ClarivaWallet_balanceValue_pending: !known && !balanceFailed,
                    })}
                >
                    {value}
                </div>
                {hint && <div className="mx_ClarivaWallet_balanceHint">{hint}</div>}
            </div>
            {canRecharge(isConsultant) && (
                // mx_Dialog_nonDialogButton: the settings dialog would restyle a Compound button as an outlined pill
                <Button
                    kind="primary"
                    size="lg"
                    onClick={onRecharge}
                    className="mx_ClarivaWallet_recharge mx_Dialog_nonDialogButton"
                >
                    {S.addCredits}
                </Button>
            )}
        </div>
    );
}

interface Props {
    /** Test seams. */
    history?: TransactionHistory;
}

function WalletTabBody({ history }: { history: TransactionHistory }): JSX.Element {
    const { credits, loaded, isConsultant, balanceFailed } = useWalletSnapshot();
    const [recovered, setRecovered] = useState<RecoveredPayment[]>([]);

    useEffect(() => {
        let alive = true;
        void WalletStore.instance.refreshBalance();
        // a reload in the middle of a payment: resolve it now and tell the user
        void recoverPendingPayments().then((done) => {
            if (alive && done.length > 0) setRecovered(done);
        });
        return () => {
            alive = false;
        };
    }, []);

    const openRecharge = (): void => {
        Modal.createDialog(RechargeDialog, {}, undefined, /* isPriority */ false, /* isStatic */ false);
    };
    const openDetail = (transaction: WalletTransaction): void => {
        Modal.createDialog(TransactionDetailDialog, { transaction });
    };

    return (
        <SettingsTab data-testid="clariva-wallet-tab">
            <SettingsSection>
                <BalanceHeader
                    credits={credits}
                    loaded={loaded}
                    balanceFailed={!!balanceFailed}
                    isConsultant={isConsultant}
                    onRecharge={openRecharge}
                    onRetry={() => void WalletStore.instance.refreshBalance()}
                />
                {recovered.map((r) => (
                    <p className="mx_ClarivaWallet_notice" role="status" key={r.orderId}>
                        {S.recoveredPayment(formatCredits(r.amount, true))}
                    </p>
                ))}
                <SettingsSubsection heading={S.transactionHistory} stretchContent={true}>
                    <TransactionList
                        isConsultant={isConsultant}
                        state={history.state}
                        onLoadMore={history.loadMore}
                        onRetry={history.retry}
                        onSelect={openDetail}
                    />
                </SettingsSubsection>
            </SettingsSection>
        </SettingsTab>
    );
}

function WalletTabWithHistory(): JSX.Element {
    const history = useTransactionHistory();
    return <WalletTabBody history={history} />;
}

/** Settings > Wallet: balance, Add credits (clients), and the paged transaction history. */
export default function WalletTab({ history }: Props): JSX.Element {
    return history ? <WalletTabBody history={history} /> : <WalletTabWithHistory />;
}
