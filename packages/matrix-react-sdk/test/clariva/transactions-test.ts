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

import { type WalletTransaction } from "../../src/clariva/api/types";
import {
    ABANDONED_AFTER_MS,
    directionLabel,
    formatTransactionDate,
    isAbandoned,
    isAwaitingPayment,
    isCredit,
    mergeTransactions,
    statusText,
    statusTone,
    transactionAmountText,
    transactionIdentity,
    transactionKey,
    transactionLabel,
    visibleTransactions,
} from "../../src/clariva/wallet/transactions";

const txn = (overrides: Partial<WalletTransaction> = {}): WalletTransaction => ({
    id: "1",
    amount: "500.00",
    type: "CREDIT",
    source: "RECHARGE",
    status: "PAID",
    createdAt: "2026-06-12T08:31:02.000Z",
    ...overrides,
});

describe("clariva transaction rules (spec 02 section 2.4)", () => {
    describe("labels", () => {
        it.each([
            ["RECHARGE", "CREDIT", "Recharge"],
            ["HOLD", "DEBIT", "Chat hold"],
            ["HOLD_SETTLED", "CREDIT", "Earnings"],
            ["REFUND", "CREDIT", "Refund"],
            ["REFERRAL", "BONUS", "Referral bonus"],
        ])("source %s -> %s", (source, type, label) => {
            expect(transactionLabel({ source, type })).toBe(label);
        });

        it("falls back to the type for legacy rows without a source", () => {
            expect(transactionLabel({ source: null, type: "BONUS" })).toBe("Bonus");
            expect(transactionLabel({ source: undefined, type: "CREDIT" })).toBe("Credit");
            expect(transactionLabel({ source: "  ", type: "DEBIT" })).toBe("Debit");
        });

        it("is case-insensitive and capitalises unknown keys like Android", () => {
            expect(transactionLabel({ source: "recharge", type: "credit" })).toBe("Recharge");
            expect(transactionLabel({ source: "HOLD_REFUND", type: "CREDIT" })).toBe("Hold_refund");
            expect(transactionKey({ source: "hold_settled", type: "CREDIT" })).toBe("HOLD_SETTLED");
        });
    });

    describe("direction", () => {
        it("everything except DEBIT is money in (even FAILED/CREATED recharges, as on Android)", () => {
            expect(isCredit({ type: "CREDIT" })).toBe(true);
            expect(isCredit({ type: "BONUS" })).toBe(true);
            expect(isCredit({ type: "debit" })).toBe(false);
            expect(directionLabel({ type: "DEBIT" })).toBe("Debit");
            expect(directionLabel({ type: "CREDIT" })).toBe("Credit");
        });
    });

    describe("status", () => {
        it("tones: paid/success/completed green, failed red, the rest grey", () => {
            expect(statusTone("PAID")).toBe("success");
            expect(statusTone("completed")).toBe("success");
            expect(statusTone("Success")).toBe("success");
            expect(statusTone("FAILED")).toBe("critical");
            expect(statusTone("CREATED")).toBe("secondary");
            expect(statusTone("PENDING")).toBe("secondary");
            expect(statusTone(undefined)).toBe("secondary");
        });

        it("text: first letter upper-cased, the rest lower-cased", () => {
            expect(statusText("PAID")).toBe("Paid");
            expect(statusText("created")).toBe("Created");
            expect(statusText(null)).toBe("");
        });
    });

    describe("amount", () => {
        it("whole numbers plain, cents only when present, never an invented 0", () => {
            expect(transactionAmountText({ amount: "500.00" })).toBe("500 cr");
            expect(transactionAmountText({ amount: "12.50" })).toBe("12.50 cr");
            expect(transactionAmountText({ amount: "0.00" })).toBe("0 cr");
            expect(transactionAmountText({ amount: "garbage" })).toBe("-");
        });
    });

    describe("abandoned checkouts", () => {
        const now = Date.parse("2026-06-12T12:00:00.000Z");

        it("a CREATED recharge older than an hour is abandoned and hidden", () => {
            const old = txn({ status: "CREATED", createdAt: new Date(now - ABANDONED_AFTER_MS - 1000).toISOString() });
            expect(isAbandoned(old, now)).toBe(true);
            expect(visibleTransactions([old, txn({ id: "2" })], now).map((t) => t.id)).toEqual(["2"]);
        });

        it("a young CREATED recharge stays, flagged as awaiting payment", () => {
            const young = txn({ status: "CREATED", createdAt: new Date(now - 5 * 60_000).toISOString() });
            expect(isAbandoned(young, now)).toBe(false);
            expect(isAwaitingPayment(young)).toBe(true);
            expect(visibleTransactions([young], now)).toHaveLength(1);
        });

        it("only recharges can be abandoned, and PAID/FAILED rows are never hidden", () => {
            const longAgo = new Date(now - 10 * ABANDONED_AFTER_MS).toISOString();
            expect(isAbandoned(txn({ status: "PAID", createdAt: longAgo }), now)).toBe(false);
            expect(isAbandoned(txn({ status: "FAILED", createdAt: longAgo }), now)).toBe(false);
            expect(isAbandoned(txn({ status: "CREATED", source: "HOLD", createdAt: longAgo }), now)).toBe(false);
        });
    });

    describe("date", () => {
        it("date only, in the requested time zone", () => {
            expect(formatTransactionDate("2026-06-12T23:30:00.000Z", "en-US", "UTC")).toBe("Jun 12, 2026");
            expect(formatTransactionDate("2026-06-12T23:30:00.000Z", "en-US", "Asia/Kolkata")).toBe("Jun 13, 2026");
        });

        it("is empty for a missing or invalid timestamp", () => {
            expect(formatTransactionDate(undefined)).toBe("");
            expect(formatTransactionDate("not a date")).toBe("");
        });
    });

    describe("merge / de-duplication", () => {
        it("appends only unseen ids and keeps the order", () => {
            const page1 = [txn({ id: "10" }), txn({ id: "9" })];
            const page2 = [txn({ id: "9" }), txn({ id: "8" })]; // an insert between the two loads repeats id 9
            expect(mergeTransactions(page1, page2).map((t) => t.id)).toEqual(["10", "9", "8"]);
        });

        it("falls back to the visible content when a row has no id", () => {
            const a = txn({ id: undefined, amount: "5.00" });
            expect(transactionIdentity(a)).toBe(transactionIdentity({ ...a }));
            expect(mergeTransactions([a], [{ ...a }, txn({ id: undefined, amount: "6.00" })])).toHaveLength(2);
        });
    });
});
