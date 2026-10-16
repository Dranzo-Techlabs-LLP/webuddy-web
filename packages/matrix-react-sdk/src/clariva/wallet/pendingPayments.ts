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

/**
 * Remembers recharges that were started but not yet confirmed so a page reload in the middle of a payment can still
 * be resolved (Android keeps `orderId -> transactionId` in memory only and loses the payment on a process death;
 * spec 02 §3.5 / §7.2.5). Lives in `sessionStorage` (per tab, gone when the tab closes) and every access is wrapped
 * in try/catch because storage can be blocked (private windows, "block site data", jsdom).
 *
 * What is stored: the Matrix user id, the Razorpay order id, our ledger transaction id, the amount, and — once the
 * checkout reports a successful payment — the payment id and signature that `POST /v1/wallet/verify` needs.
 * Never the Clariva JWT, the Matrix access token or the recovery passphrase.
 */

export interface PendingPayment {
    userId: string;
    orderId: string;
    transactionId: string;
    /** Credits (= INR) of the order. */
    amount: number;
    createdAt: number;
    /** Present once Razorpay reported success: enough to re-run the (idempotent) verification after a reload. */
    paymentId?: string;
    signature?: string;
}

const STORAGE_KEY = "clariva.wallet.pendingPayments";
/** The server forgets abandoned checkouts after 1 h; keep a verified-but-unconfirmed payment a day. */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

type MinimalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): MinimalStorage | null {
    try {
        return typeof window !== "undefined" ? window.sessionStorage : null;
    } catch {
        return null; // accessing sessionStorage itself can throw
    }
}

function isPending(value: unknown): value is PendingPayment {
    if (!value || typeof value !== "object") return false;
    const v = value as Partial<PendingPayment>;
    return (
        typeof v.userId === "string" &&
        typeof v.orderId === "string" &&
        typeof v.transactionId === "string" &&
        typeof v.amount === "number" &&
        typeof v.createdAt === "number"
    );
}

export class PendingPaymentsStore {
    public constructor(
        private readonly getStorage: () => MinimalStorage | null = defaultStorage,
        private readonly now: () => number = () => Date.now(),
    ) {}

    private readAll(): PendingPayment[] {
        try {
            const raw = this.getStorage()?.getItem(STORAGE_KEY);
            if (!raw) return [];
            const parsed: unknown = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            const cutoff = this.now() - PENDING_TTL_MS;
            return parsed.filter(isPending).filter((p) => p.createdAt >= cutoff);
        } catch (e) {
            logger.debug("Clariva wallet: could not read pending payments", e);
            return [];
        }
    }

    private writeAll(entries: PendingPayment[]): void {
        try {
            const storage = this.getStorage();
            if (!storage) return;
            if (entries.length === 0) storage.removeItem(STORAGE_KEY);
            else storage.setItem(STORAGE_KEY, JSON.stringify(entries));
        } catch (e) {
            logger.debug("Clariva wallet: could not persist pending payments", e);
        }
    }

    /** Entries of one user, oldest first. */
    public list(userId: string): PendingPayment[] {
        return this.readAll().filter((p) => p.userId === userId);
    }

    public get(userId: string, orderId: string): PendingPayment | undefined {
        return this.list(userId).find((p) => p.orderId === orderId);
    }

    /** Remember a freshly created order (called BEFORE the checkout opens). Replaces an entry of the same order. */
    public save(entry: Omit<PendingPayment, "createdAt"> & { createdAt?: number }): void {
        const full: PendingPayment = { ...entry, createdAt: entry.createdAt ?? this.now() };
        this.writeAll([...this.readAll().filter((p) => p.orderId !== full.orderId), full]);
    }

    /** Razorpay reported success: keep what is needed to verify after a reload. */
    public attachPayment(userId: string, orderId: string, paymentId: string, signature: string): void {
        const all = this.readAll();
        const existing = all.find((p) => p.userId === userId && p.orderId === orderId);
        if (!existing) return;
        this.writeAll(all.map((p) => (p === existing ? { ...p, paymentId, signature } : p)));
    }

    public remove(orderId: string): void {
        this.writeAll(this.readAll().filter((p) => p.orderId !== orderId));
    }

    /** Sign-out: forget this user's entries. */
    public clear(userId: string): void {
        this.writeAll(this.readAll().filter((p) => p.userId !== userId));
    }
}

/** App-wide instance backed by `sessionStorage`. */
export const pendingPayments = new PendingPaymentsStore();
