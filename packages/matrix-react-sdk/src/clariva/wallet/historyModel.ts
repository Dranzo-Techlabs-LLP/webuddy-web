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

import { type TransactionHistoryResponse, type WalletTransaction } from "../api/types";
import { mergeTransactions } from "./transactions";

/** Android always uses 10 rows per page (spec 02 §3.7). */
export const HISTORY_PAGE_SIZE = 10;

export type HistoryStatus =
    /** nothing requested yet */
    | "idle"
    /** first page (or a refresh) in flight; `items` may still hold the previous list */
    | "loading"
    /** a following page in flight */
    | "loadingMore"
    /** the last request succeeded */
    | "ready"
    /** the last request failed; `errorWhileLoadingMore` says which one */
    | "error";

export interface HistoryState {
    status: HistoryStatus;
    /** Newest first, de-duplicated by id. */
    items: WalletTransaction[];
    /** Last page that was merged into `items` (0 = none). */
    page: number;
    totalPages: number;
    error: string | null;
    errorWhileLoadingMore: boolean;
}

export type HistoryFetcher = (page: number, pageSize: number) => Promise<TransactionHistoryResponse>;

const INITIAL: HistoryState = {
    status: "idle",
    items: [],
    page: 0,
    totalPages: 0,
    error: null,
    errorWhileLoadingMore: false,
};

/** More pages exist (Android: `response.page < response.totalPages`). */
export function canLoadMore(state: Pick<HistoryState, "page" | "totalPages">): boolean {
    return state.page > 0 && state.page < state.totalPages;
}

/** "Empty" only means a successful first load that really returned nothing (a failure is never "empty"). */
export function isEmptyHistory(state: HistoryState): boolean {
    return state.status === "ready" && state.items.length === 0;
}

/**
 * Paged ledger state, framework-free so the rules are unit-testable:
 *
 *  - `loadFirst()` replaces the list with page 1 (used on open, after a payment, and for Retry on a first-page error);
 *  - `loadMore()` appends the next page, is ignored while any request is running (Android's guard) or when no
 *    further page exists, and de-duplicates by id;
 *  - a failed request keeps the rows that are already on screen and reports an error (never "No transactions found");
 *  - a stale response (a newer `loadFirst` was started meanwhile) is discarded.
 */
export class HistoryModel {
    private current: HistoryState = INITIAL;
    private readonly listeners = new Set<(state: HistoryState) => void>();
    private inFlight = false;
    private generation = 0;
    private disposed = false;

    public constructor(
        private readonly fetchPage: HistoryFetcher,
        private readonly pageSize: number = HISTORY_PAGE_SIZE,
        private readonly describeError: (e: unknown) => string = defaultDescribeError,
    ) {}

    public get state(): HistoryState {
        return this.current;
    }

    public get busy(): boolean {
        return this.inFlight;
    }

    public subscribe(listener: (state: HistoryState) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    public dispose(): void {
        this.disposed = true;
        this.generation++;
        this.listeners.clear();
    }

    /** Reload from page 1. Always runs (a refresh supersedes whatever is in flight). */
    public async loadFirst(): Promise<void> {
        const generation = ++this.generation;
        this.inFlight = true;
        this.set({ ...this.current, status: "loading", error: null, errorWhileLoadingMore: false });
        try {
            const res = await this.fetchPage(1, this.pageSize);
            if (generation !== this.generation) return;
            this.set({
                status: "ready",
                items: mergeTransactions([], res.data ?? []),
                page: res.page || 1,
                totalPages: res.totalPages ?? 0,
                error: null,
                errorWhileLoadingMore: false,
            });
        } catch (e) {
            if (generation !== this.generation) return;
            logger.warn("Clariva wallet: failed to load transaction history", e);
            this.set({ ...this.current, status: "error", error: this.describeError(e), errorWhileLoadingMore: false });
        } finally {
            if (generation === this.generation) this.inFlight = false;
        }
    }

    /** Append the next page. No-op while a request runs or when everything is loaded. */
    public async loadMore(): Promise<void> {
        if (this.inFlight || !canLoadMore(this.current)) return;
        const generation = this.generation;
        const nextPage = this.current.page + 1;
        this.inFlight = true;
        this.set({ ...this.current, status: "loadingMore", error: null, errorWhileLoadingMore: false });
        try {
            const res = await this.fetchPage(nextPage, this.pageSize);
            if (generation !== this.generation) return;
            this.set({
                status: "ready",
                items: mergeTransactions(this.current.items, res.data ?? []),
                page: res.page || nextPage,
                totalPages: res.totalPages ?? this.current.totalPages,
                error: null,
                errorWhileLoadingMore: false,
            });
        } catch (e) {
            if (generation !== this.generation) return;
            logger.warn("Clariva wallet: failed to load more transactions", e);
            this.set({ ...this.current, status: "error", error: this.describeError(e), errorWhileLoadingMore: true });
        } finally {
            if (generation === this.generation) this.inFlight = false;
        }
    }

    /** Retry whatever failed: the first page, or the page after the last one that loaded. */
    public retry(): Promise<void> {
        return this.current.errorWhileLoadingMore ? this.loadMore() : this.loadFirst();
    }

    private set(next: HistoryState): void {
        this.current = next;
        if (this.disposed) return;
        for (const listener of [...this.listeners]) listener(next);
    }
}

function defaultDescribeError(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
