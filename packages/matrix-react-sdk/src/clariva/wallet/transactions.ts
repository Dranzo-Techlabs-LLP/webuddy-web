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

import { type WalletTransaction } from "../api/types";
import { formatCredits, parseAmount } from "../money";
import { walletStrings as S } from "../strings/wallet";

/**
 * Pure rules for rendering a Wallet-API ledger row. Mirrors Android's WalletView (spec 02 §2.4, §6.5) plus the web
 * improvements listed there (accessible direction, abandoned-checkout handling). No React, no I/O.
 */

export type StatusTone = "success" | "critical" | "secondary";

/** The server hides `CREATED` recharges older than this (abandoned checkouts); we enforce it client-side too. */
export const ABANDONED_AFTER_MS = 60 * 60 * 1000;

/** `(source ?: type).uppercase()`, with a blank source counting as missing. */
export function transactionKey(t: Pick<WalletTransaction, "source" | "type">): string {
    const source = typeof t.source === "string" ? t.source.trim() : "";
    const type = typeof t.type === "string" ? t.type.trim() : "";
    return (source || type).toUpperCase();
}

const LABELS: Readonly<Record<string, string>> = {
    RECHARGE: S.labelRecharge,
    HOLD: S.labelHold,
    HOLD_SETTLED: S.labelHoldSettled,
    REFUND: S.labelRefund,
    REFERRAL: S.labelReferral,
    BONUS: S.labelBonus,
    CREDIT: S.labelCredit,
    DEBIT: S.labelDebit,
};

/** "Recharge", "Chat hold", "Earnings", ...; unknown keys become e.g. `HOLD_REFUND` -> "Hold_refund". */
export function transactionLabel(t: Pick<WalletTransaction, "source" | "type">): string {
    const key = transactionKey(t);
    if (!key) return "";
    return LABELS[key] ?? key.toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

/** Direction follows `type` only (Android): everything except DEBIT is money in. */
export function isCredit(t: Pick<WalletTransaction, "type">): boolean {
    return (t.type ?? "").trim().toUpperCase() !== "DEBIT";
}

export function directionLabel(t: Pick<WalletTransaction, "type">): string {
    return isCredit(t) ? S.directionCredit : S.directionDebit;
}

/** `completed|success|paid` green, `failed` red, anything else (Created, Pending, ...) grey. */
export function statusTone(status: string | null | undefined): StatusTone {
    const s = (status ?? "").trim().toLowerCase();
    if (s === "completed" || s === "success" || s === "paid") return "success";
    if (s === "failed") return "critical";
    return "secondary";
}

/** "PAID" -> "Paid". */
export function statusText(status: string | null | undefined): string {
    return (status ?? "")
        .trim()
        .toLowerCase()
        .replace(/^./, (c) => c.toUpperCase());
}

/** Parsed ledger amount, or `null` when the server sent something unusable (never invent `0`). */
export function transactionAmount(t: Pick<WalletTransaction, "amount">): number | null {
    return parseAmount(t.amount);
}

/** `500 cr`, `12.5 cr` (whole numbers plain, cents only when present); an unparseable amount shows a dash. */
export function transactionAmountText(t: Pick<WalletTransaction, "amount">, grouped = false): string {
    const n = transactionAmount(t);
    return n === null ? "-" : S.amountCr(formatCredits(n, grouped));
}

/** A `CREATED` recharge is a checkout that was opened but (so far) not paid. */
export function isAwaitingPayment(t: WalletTransaction): boolean {
    return (t.status ?? "").trim().toUpperCase() === "CREATED";
}

/**
 * An abandoned checkout: still `CREATED` an hour after it was opened. The server already filters these out of the
 * history; this is the same rule applied again so a clock skew or a cached page cannot resurrect them.
 */
export function isAbandoned(t: WalletTransaction, now: number = Date.now()): boolean {
    if (!isAwaitingPayment(t) || transactionKey(t) !== "RECHARGE") return false;
    const created = parseTimestamp(t.createdAt);
    return created !== null && now - created > ABANDONED_AFTER_MS;
}

export function parseTimestamp(value: string | null | undefined): number | null {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
}

/** Date column: date only, in the browser's locale and time zone ("12 Oct 2026"). Empty when absent/invalid. */
export function formatTransactionDate(
    createdAt: string | null | undefined,
    locale?: string | string[],
    timeZone?: string,
): string {
    const ms = parseTimestamp(createdAt);
    if (ms === null) return "";
    return new Date(ms).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric", timeZone });
}

/** Detail dialog: date and time in the browser's locale and time zone. */
export function formatTransactionDateTime(
    createdAt: string | null | undefined,
    locale?: string | string[],
    timeZone?: string,
): string {
    const ms = parseTimestamp(createdAt);
    if (ms === null) return "";
    return new Date(ms).toLocaleString(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone,
    });
}

/**
 * Identity of a ledger row for de-duplication. Offset paging can repeat a row when something is inserted between two
 * page loads, so the id is authoritative; a row without an id falls back to its visible content.
 */
export function transactionIdentity(t: WalletTransaction): string {
    if (t.id !== undefined && t.id !== null && String(t.id) !== "") return `id:${t.id}`;
    return `x:${t.createdAt ?? ""}|${t.type}|${t.source ?? ""}|${t.amount}|${t.status}|${t.providerOrderId ?? ""}`;
}

/** Append `incoming` to `existing`, skipping rows already present (first occurrence wins, order is preserved). */
export function mergeTransactions(
    existing: readonly WalletTransaction[],
    incoming: readonly WalletTransaction[],
): WalletTransaction[] {
    const seen = new Set(existing.map(transactionIdentity));
    const merged = [...existing];
    for (const row of incoming) {
        const key = transactionIdentity(row);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(row);
    }
    return merged;
}

/** Rows to show: everything except abandoned checkouts. */
export function visibleTransactions(rows: readonly WalletTransaction[], now: number = Date.now()): WalletTransaction[] {
    return rows.filter((t) => !isAbandoned(t, now));
}
