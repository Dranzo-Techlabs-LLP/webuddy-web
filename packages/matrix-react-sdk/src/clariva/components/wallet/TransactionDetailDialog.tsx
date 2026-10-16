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
import classNames from "classnames";
import { Button } from "@vector-im/compound-web";

import BaseDialog from "../../../components/views/dialogs/BaseDialog";
import CopyableText from "../../../components/views/elements/CopyableText";
import { type WalletTransaction } from "../../api/types";
import { walletStrings as S } from "../../strings/wallet";
import {
    directionLabel,
    formatTransactionDateTime,
    isCredit,
    parseTimestamp,
    statusText,
    statusTone,
    transactionAmountText,
    transactionKey,
    transactionLabel,
} from "../../wallet/transactions";
import { TransactionGlyph, TransactionStatus } from "./TransactionList";

interface Props {
    transaction: WalletTransaction;
    onFinished: () => void;
}

interface DetailRow {
    label: string;
    value: string;
    /** Shown in monospace with a copy button. */
    copy?: boolean;
    tone?: "success" | "critical" | "secondary";
}

/** The rows of the details view, in display order, skipping what the server did not send. Pure, so it is testable. */
export function transactionDetailRows(t: WalletTransaction): DetailRow[] {
    const ms = parseTimestamp(t.createdAt);
    const rows: (DetailRow | null)[] = [
        { label: S.detailId, value: t.id !== undefined && t.id !== null ? String(t.id) : "", copy: true },
        { label: S.detailDate, value: formatTransactionDateTime(t.createdAt) },
        ms !== null ? { label: `${S.detailDate} (${S.detailUtc})`, value: new Date(ms).toISOString() } : null,
        { label: S.detailType, value: transactionLabel(t) },
        { label: S.detailDirection, value: directionLabel(t) },
        { label: S.detailSource, value: transactionKey(t) },
        { label: S.detailAmount, value: transactionAmountText(t) },
        { label: S.detailCurrency, value: t.currency ?? "" },
        { label: S.detailStatus, value: statusText(t.status), tone: statusTone(t.status) },
        { label: S.detailProvider, value: t.provider ?? "" },
        { label: S.detailOrderId, value: t.providerOrderId ?? "", copy: true },
        { label: S.detailPaymentId, value: t.providerPaymentId ?? "", copy: true },
    ];
    return rows.filter((r): r is DetailRow => r !== null && r.value !== "");
}

/** Android has no transaction details; this is the web addition (spec 02 §2.4): one row per ledger field. */
export default function TransactionDetailDialog({ transaction, onFinished }: Props): JSX.Element {
    const rows = transactionDetailRows(transaction);
    const credit = isCredit(transaction);
    return (
        <BaseDialog
            className="mx_ClarivaTxnDetail"
            title={S.detailTitle}
            onFinished={onFinished}
            hasCancel={true}
            fixedWidth={false}
        >
            {/* the headline: what it was and how much, readable at a glance before the ledger fields */}
            <div className="mx_ClarivaTxnDetail_hero">
                <span
                    className={classNames("mx_ClarivaTxn_icon", {
                        mx_ClarivaTxn_credit: credit,
                        mx_ClarivaTxn_debit: !credit,
                    })}
                >
                    <TransactionGlyph transaction={transaction} />
                </span>
                <span className="mx_ClarivaTxnDetail_heroText">
                    <span className="mx_ClarivaTxnDetail_heroLabel">{transactionLabel(transaction)}</span>
                    <span
                        className={classNames("mx_ClarivaTxnDetail_heroAmount", {
                            mx_ClarivaTxn_amount_credit: credit,
                            mx_ClarivaTxn_amount_debit: !credit,
                        })}
                    >
                        <span aria-hidden="true">{credit ? "+" : "−"}</span>
                        {transactionAmountText(transaction)}
                    </span>
                </span>
            </div>
            <dl className="mx_ClarivaTxnDetail_list" data-testid="clariva-txn-detail">
                {rows.map((row) => (
                    <div className="mx_ClarivaTxnDetail_row" key={row.label}>
                        <dt>{row.label}</dt>
                        <dd>
                            {row.copy ? (
                                <CopyableText getTextToCopy={() => row.value} border={false}>
                                    <code className="mx_ClarivaTxnDetail_code">{row.value}</code>
                                </CopyableText>
                            ) : row.tone ? (
                                <TransactionStatus status={transaction.status} />
                            ) : (
                                <span>{row.value}</span>
                            )}
                        </dd>
                    </div>
                ))}
            </dl>
            <div className="mx_ClarivaDialog_buttons">
                <Button kind="primary" className="mx_Dialog_nonDialogButton" onClick={onFinished}>
                    {S.close}
                </Button>
            </div>
        </BaseDialog>
    );
}
