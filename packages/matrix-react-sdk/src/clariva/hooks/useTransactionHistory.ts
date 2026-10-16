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

import { useEffect, useRef, useState } from "react";

import { ClarivaHttpError } from "../api/http";
import { WalletStore } from "../stores/WalletStore";
import { walletStrings as S } from "../strings/wallet";
import { HISTORY_PAGE_SIZE, HistoryModel, type HistoryFetcher, type HistoryState } from "../wallet/historyModel";
import { onLedgerChanged } from "../wallet/walletBus";

const storeFetcher: HistoryFetcher = (page, pageSize) => WalletStore.instance.getHistory(page, pageSize);

function describeHistoryError(e: unknown): string {
    // Surface the server's message when there is one (400 validation, 404 unknown wallet), otherwise the generic text.
    if (e instanceof ClarivaHttpError && e.serverMessage) return `${S.historyLoadFailed} ${e.serverMessage}`;
    return S.historyLoadFailed;
}

export interface TransactionHistory {
    state: HistoryState;
    loadMore: () => void;
    retry: () => void;
    refresh: () => void;
}

/**
 * The paged ledger for the Wallet tab. Loads page 1 on mount, reloads it when a recharge completes anywhere
 * (`notifyLedgerChanged`), and pages with "Load more" (10 rows at a time, newest first, de-duplicated by id).
 */
export function useTransactionHistory(fetcher: HistoryFetcher = storeFetcher): TransactionHistory {
    const modelRef = useRef<HistoryModel>();
    if (!modelRef.current) modelRef.current = new HistoryModel(fetcher, HISTORY_PAGE_SIZE, describeHistoryError);
    const model = modelRef.current;

    const [state, setState] = useState<HistoryState>(model.state);
    useEffect(() => {
        const unsubscribe = model.subscribe(setState);
        const unsubscribeLedger = onLedgerChanged(() => void model.loadFirst());
        setState(model.state);
        void model.loadFirst();
        return () => {
            unsubscribe();
            unsubscribeLedger();
            model.dispose();
        };
    }, [model]);

    return {
        state,
        loadMore: () => void model.loadMore(),
        retry: () => void model.retry(),
        refresh: () => void model.loadFirst(),
    };
}
