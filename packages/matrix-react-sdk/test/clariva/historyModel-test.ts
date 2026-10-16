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

import { type TransactionHistoryResponse, type WalletTransaction } from "../../src/clariva/api/types";
import { ClarivaHttpError } from "../../src/clariva/api/http";
import { HistoryModel, canLoadMore, isEmptyHistory } from "../../src/clariva/wallet/historyModel";

const row = (id: number): WalletTransaction => ({
    id: String(id),
    amount: "10.00",
    type: "CREDIT",
    source: "RECHARGE",
    status: "PAID",
    createdAt: "2026-06-12T08:31:02.000Z",
});

const page = (ids: number[], p: number, totalPages: number): TransactionHistoryResponse => ({
    data: ids.map(row),
    total: 25,
    page: p,
    pageSize: 10,
    totalPages,
});

/** A fetcher whose responses the test resolves by hand. */
function controlledFetcher(): {
    fetchPage: jest.Mock<Promise<TransactionHistoryResponse>, [number, number]>;
    resolve: (index: number, value: TransactionHistoryResponse) => void;
} {
    const pending: { resolve: (v: TransactionHistoryResponse) => void }[] = [];
    const fetchPage = jest.fn(
        (_page: number, _size: number) =>
            new Promise<TransactionHistoryResponse>((resolve) => {
                pending.push({ resolve });
            }),
    );
    return { fetchPage, resolve: (i, v) => pending[i].resolve(v) };
}

describe("HistoryModel (spec 02 section 3.7)", () => {
    it("loads page 1 with 10 rows per page and exposes canLoadMore", async () => {
        const fetchPage = jest.fn(async () => page([30, 29, 28], 1, 3));
        const model = new HistoryModel(fetchPage);
        expect(model.state.status).toBe("idle");
        await model.loadFirst();
        expect(fetchPage).toHaveBeenCalledWith(1, 10);
        expect(model.state.status).toBe("ready");
        expect(model.state.items.map((t) => t.id)).toEqual(["30", "29", "28"]);
        expect(canLoadMore(model.state)).toBe(true);
    });

    it("appends the next page, de-duplicating by id, until the last page", async () => {
        const fetchPage = jest.fn(async (p: number) => (p === 1 ? page([10, 9], 1, 2) : page([9, 8], 2, 2))); // id 9 repeats (offset paging)
        const model = new HistoryModel(fetchPage);
        await model.loadFirst();
        await model.loadMore();
        expect(model.state.items.map((t) => t.id)).toEqual(["10", "9", "8"]);
        expect(canLoadMore(model.state)).toBe(false);
        await model.loadMore(); // nothing left: no request
        expect(fetchPage).toHaveBeenCalledTimes(2);
    });

    it("ignores loadMore while another load is running (Android's guard)", async () => {
        const c = controlledFetcher();
        const model = new HistoryModel(c.fetchPage);
        const first = model.loadFirst();
        c.resolve(0, page([2, 1], 1, 3));
        await first;

        const more = model.loadMore();
        void model.loadMore();
        void model.loadMore();
        expect(c.fetchPage).toHaveBeenCalledTimes(2); // page 1 + exactly one page 2
        c.resolve(1, page([0], 2, 3));
        await more;
        expect(model.state.items).toHaveLength(3);
    });

    it("a failed first load is an error, never an empty list", async () => {
        const model = new HistoryModel(
            async () => {
                throw new ClarivaHttpError(500, "boom", "http");
            },
            10,
            () => "Could not load",
        );
        await model.loadFirst();
        expect(model.state.status).toBe("error");
        expect(model.state.error).toBe("Could not load");
        expect(isEmptyHistory(model.state)).toBe(false);
    });

    it("only a successful empty first load is empty", async () => {
        const model = new HistoryModel(async () => page([], 1, 0));
        await model.loadFirst();
        expect(isEmptyHistory(model.state)).toBe(true);
    });

    it("keeps the rows when loading more fails, and retry loads the same next page", async () => {
        let fail = true;
        const fetchPage = jest.fn(async (p: number) => {
            if (p === 2 && fail) throw new Error("offline");
            return p === 1 ? page([2, 1], 1, 2) : page([0], 2, 2);
        });
        const model = new HistoryModel(fetchPage);
        await model.loadFirst();
        await model.loadMore();
        expect(model.state.status).toBe("error");
        expect(model.state.errorWhileLoadingMore).toBe(true);
        expect(model.state.items).toHaveLength(2);

        fail = false;
        await model.retry();
        expect(model.state.status).toBe("ready");
        expect(model.state.items.map((t) => t.id)).toEqual(["2", "1", "0"]);
        expect(fetchPage).toHaveBeenLastCalledWith(2, 10);
    });

    it("retry after a failed first load reloads page 1", async () => {
        let fail = true;
        const fetchPage = jest.fn(async () => {
            if (fail) throw new Error("offline");
            return page([1], 1, 1);
        });
        const model = new HistoryModel(fetchPage);
        await model.loadFirst();
        fail = false;
        await model.retry();
        expect(model.state.items).toHaveLength(1);
        expect(model.state.status).toBe("ready");
    });

    it("a refresh supersedes a load more that is still in flight (its late answer is discarded)", async () => {
        const c = controlledFetcher();
        const model = new HistoryModel(c.fetchPage);
        const first = model.loadFirst();
        c.resolve(0, page([3, 2], 1, 3));
        await first;

        const more = model.loadMore(); // request #1 (page 2)
        const refresh = model.loadFirst(); // request #2 (page 1 again)
        c.resolve(2, page([5, 4, 3, 2], 1, 1));
        await refresh;
        c.resolve(1, page([99], 2, 3)); // stale
        await more;

        expect(model.state.items.map((t) => t.id)).toEqual(["5", "4", "3", "2"]);
        expect(model.state.totalPages).toBe(1);
    });

    it("notifies subscribers and stops after unsubscribe", async () => {
        const model = new HistoryModel(async () => page([1], 1, 1));
        const listener = jest.fn();
        const off = model.subscribe(listener);
        await model.loadFirst();
        expect(listener).toHaveBeenCalled();
        off();
        listener.mockClear();
        await model.loadFirst();
        expect(listener).not.toHaveBeenCalled();
    });
});
