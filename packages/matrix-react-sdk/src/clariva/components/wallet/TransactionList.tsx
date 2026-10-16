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
import ArrowUpIcon from "@vector-im/compound-design-tokens/assets/web/icons/arrow-up";
import ArrowDownIcon from "@vector-im/compound-design-tokens/assets/web/icons/arrow-down";
import ChartIcon from "@vector-im/compound-design-tokens/assets/web/icons/chart";
import RestartIcon from "@vector-im/compound-design-tokens/assets/web/icons/restart";
import FavouriteIcon from "@vector-im/compound-design-tokens/assets/web/icons/favourite";
import CheckIcon from "@vector-im/compound-design-tokens/assets/web/icons/check";
import ErrorIcon from "@vector-im/compound-design-tokens/assets/web/icons/error";
import TimeIcon from "@vector-im/compound-design-tokens/assets/web/icons/time";

import { type WalletTransaction } from "../../api/types";
import { walletStrings as S } from "../../strings/wallet";
import { canLoadMore, type HistoryState } from "../../wallet/historyModel";
import {
    directionLabel,
    formatTransactionDate,
    isAwaitingPayment,
    isCredit,
    statusText,
    statusTone,
    transactionAmountText,
    transactionIdentity,
    transactionKey,
    transactionLabel,
    visibleTransactions,
    type StatusTone,
} from "../../wallet/transactions";
import Spinner from "../../../components/views/elements/Spinner";
import { Skeleton } from "../../ui";
import { EmptyHistoryArt } from "./icons";

interface Props {
    state: HistoryState;
    onLoadMore: () => void;
    onRetry: () => void;
    onSelect: (transaction: WalletTransaction) => void;
    /** Only picks the wording of the empty state (clients recharge, consultants earn). `null`/omitted = unknown. */
    isConsultant?: boolean | null;
    /** Injectable for tests (the "abandoned checkout" rule depends on the clock). */
    now?: number;
}

/** The glyph in a row's round chip: direction by default, a dedicated one for earnings / refunds / bonuses. */
export function TransactionGlyph({ transaction: t }: { transaction: WalletTransaction }): JSX.Element {
    switch (transactionKey(t)) {
        case "HOLD_SETTLED":
            return <ChartIcon aria-hidden="true" />;
        case "REFUND":
            return <RestartIcon aria-hidden="true" />;
        case "REFERRAL":
        case "BONUS":
            return <FavouriteIcon aria-hidden="true" />;
        default:
            return isCredit(t) ? <ArrowUpIcon aria-hidden="true" /> : <ArrowDownIcon aria-hidden="true" />;
    }
}

function StatusGlyph({ tone }: { tone: StatusTone }): JSX.Element {
    if (tone === "success") return <CheckIcon aria-hidden="true" />;
    if (tone === "critical") return <ErrorIcon aria-hidden="true" />;
    return <TimeIcon aria-hidden="true" />;
}

/**
 * Status chip: icon + text + colour (never colour alone). The tone class sits on the element that owns the text, so the
 * list and the details dialog share it.
 */
export function TransactionStatus({ status }: { status: string | null | undefined }): JSX.Element {
    const tone = statusTone(status);
    return (
        <span className={classNames("mx_ClarivaTxn_status", `mx_ClarivaTxn_status_${tone}`)}>
            <StatusGlyph tone={tone} />
            {statusText(status)}
        </span>
    );
}

function emptyHint(isConsultant: boolean | null | undefined): string {
    if (isConsultant === true) return S.noTransactionsHintConsultant;
    if (isConsultant === false) return S.noTransactionsHintClient;
    return S.noTransactionsHint;
}

/**
 * Placeholder rows shown while the first page loads (instead of a lone spinner in an empty card): the Skeleton primitive
 * (a quiet block with the shared 1.2 s opacity pulse), shaped like a row. `mx_ClarivaSkel` is the layout hook.
 */
function SkeletonRows(): JSX.Element {
    return (
        <ul className="mx_ClarivaTxns_list mx_ClarivaTxns_skeleton" aria-hidden="true">
            {[0, 1, 2].map((i) => (
                <li key={i} className="mx_ClarivaTxns_item">
                    <div className="mx_ClarivaTxn mx_ClarivaTxn_placeholder">
                        <Skeleton className="mx_ClarivaSkel mx_ClarivaSkel_icon" width={40} height={40} radius="sm" />
                        <span className="mx_ClarivaTxn_main">
                            <Skeleton className="mx_ClarivaSkel" width="60%" height={14} />
                            <Skeleton className="mx_ClarivaSkel" width="36%" height={12} />
                        </span>
                        <span className="mx_ClarivaTxn_side">
                            <Skeleton className="mx_ClarivaSkel" width={64} height={14} />
                        </span>
                    </div>
                </li>
            ))}
        </ul>
    );
}

/**
 * The transaction history, newest first, as a list of tappable rows (icon chip, label + date, signed amount + status),
 * with its loading / empty / error states (spec 02 §2.3, §3.14). A list rather than a four-column table: it needs no
 * horizontal room, so it reads the same on a phone and in the settings dialog.
 */
export function TransactionList({ state, onLoadMore, onRetry, onSelect, isConsultant, now }: Props): JSX.Element {
    const rows = visibleTransactions(state.items, now);
    const loadingFirst = (state.status === "idle" || state.status === "loading") && state.items.length === 0;
    const firstLoadFailed = state.status === "error" && !state.errorWhileLoadingMore && state.items.length === 0;
    const empty = state.status === "ready" && rows.length === 0 && !canLoadMore(state);

    let body: JSX.Element | null = null;
    if (loadingFirst) {
        body = (
            <div className="mx_ClarivaTxns_loading" role="status" data-testid="clariva-txns-loading">
                <span className="mx_ClarivaVisuallyHidden">{S.loading}</span>
                <SkeletonRows />
            </div>
        );
    } else if (firstLoadFailed) {
        body = (
            <div className="mx_ClarivaTxns_status mx_ClarivaTxns_error" role="alert" data-testid="clariva-txns-error">
                <span>{state.error ?? S.historyLoadFailed}</span>
                <Button kind="secondary" size="sm" className="mx_Dialog_nonDialogButton" onClick={onRetry}>
                    {S.retry}
                </Button>
            </div>
        );
    } else if (empty) {
        body = (
            <div className="mx_ClarivaTxns_empty" data-testid="clariva-txns-empty">
                <EmptyHistoryArt className="mx_ClarivaTxns_emptyArt" />
                <p className="mx_ClarivaTxns_emptyTitle">{S.noTransactions}</p>
                <p className="mx_ClarivaTxns_emptyHint">{emptyHint(isConsultant)}</p>
            </div>
        );
    } else {
        body = (
            <ul className="mx_ClarivaTxns_list" data-testid="clariva-txns-table">
                {rows.map((t) => (
                    <li key={transactionIdentity(t)} className="mx_ClarivaTxns_item">
                        <TransactionRow transaction={t} onSelect={onSelect} />
                    </li>
                ))}
            </ul>
        );
    }

    const loadingMore = state.status === "loadingMore";
    // A failure with rows already on screen (a failed "Load more" or a failed refresh): keep the rows, add an error.
    const moreFailed = state.status === "error" && state.items.length > 0;

    return (
        <div className="mx_ClarivaTxns" aria-busy={loadingFirst || loadingMore}>
            {body}
            {loadingMore && (
                <div className="mx_ClarivaTxns_status" data-testid="clariva-txns-loading-more">
                    <Spinner w={20} h={20} message={S.loadingMore} onFinished={noop} />
                </div>
            )}
            {moreFailed && (
                <div className="mx_ClarivaTxns_status mx_ClarivaTxns_error" role="alert">
                    <span>{state.error ?? S.historyLoadFailed}</span>
                    <Button kind="secondary" size="sm" className="mx_Dialog_nonDialogButton" onClick={onRetry}>
                        {S.retry}
                    </Button>
                </div>
            )}
            {canLoadMore(state) && !loadingMore && !moreFailed && state.status === "ready" && (
                <div className="mx_ClarivaTxns_more">
                    <Button kind="secondary" size="lg" className="mx_Dialog_nonDialogButton" onClick={onLoadMore}>
                        {S.loadMore}
                    </Button>
                </div>
            )}
        </div>
    );
}

function noop(): void {}

function TransactionRow({
    transaction: t,
    onSelect,
}: {
    transaction: WalletTransaction;
    onSelect: (t: WalletTransaction) => void;
}): JSX.Element {
    const credit = isCredit(t);
    const label = transactionLabel(t);
    // A native <button>: Enter / Space activate it for free and it is one tab stop per row. mx_Dialog_nonDialogButton
    // keeps the settings dialog from restyling every <button> inside it as a pill.
    return (
        <button
            type="button"
            className="mx_ClarivaTxn mx_Dialog_nonDialogButton"
            title={S.viewDetails}
            onClick={() => onSelect(t)}
            data-testid="clariva-txn-row"
        >
            <span
                className={classNames("mx_ClarivaTxn_icon", {
                    mx_ClarivaTxn_credit: credit,
                    mx_ClarivaTxn_debit: !credit,
                })}
            >
                <TransactionGlyph transaction={t} />
                <span className="mx_ClarivaVisuallyHidden">{directionLabel(t)}</span>
            </span>
            <span className="mx_ClarivaTxn_main">
                <span className="mx_ClarivaTxn_label">
                    {label}
                    {isAwaitingPayment(t) && <span className="mx_ClarivaTxn_hint">{S.awaitingPayment}</span>}
                </span>
                <span className="mx_ClarivaTxn_date">{formatTransactionDate(t.createdAt)}</span>
            </span>
            <span className="mx_ClarivaTxn_side">
                <span
                    className={classNames("mx_ClarivaTxn_amount", {
                        mx_ClarivaTxn_amount_credit: credit,
                        mx_ClarivaTxn_amount_debit: !credit,
                    })}
                >
                    <span className="mx_ClarivaTxn_sign" aria-hidden="true">
                        {credit ? "+" : "−"}
                    </span>
                    {transactionAmountText(t)}
                </span>
                <TransactionStatus status={t.status} />
            </span>
        </button>
    );
}
