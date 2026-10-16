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

import { PENDING_TTL_MS, PendingPaymentsStore } from "../../src/clariva/wallet/pendingPayments";
import { CLIENT, ME } from "./helpers";

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
        data,
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => void data.set(k, v),
        removeItem: (k) => void data.delete(k),
    };
}

describe("PendingPaymentsStore (sessionStorage, spec 02 section 6.4)", () => {
    let storage: ReturnType<typeof memoryStorage>;
    let now: number;
    let store: PendingPaymentsStore;

    beforeEach(() => {
        storage = memoryStorage();
        now = 5_000_000;
        store = new PendingPaymentsStore(
            () => storage,
            () => now,
        );
    });

    const entry = { userId: ME, orderId: "order_1", transactionId: "164", amount: 500 };

    it("remembers orderId -> transactionId and lists it for the same user only", () => {
        store.save(entry);
        store.save({ ...entry, userId: CLIENT, orderId: "order_2", transactionId: "165" });
        expect(store.list(ME)).toEqual([{ ...entry, createdAt: now }]);
        expect(store.get(ME, "order_1")?.transactionId).toBe("164");
        expect(store.get(ME, "order_2")).toBeUndefined();
        expect(store.list(CLIENT)).toHaveLength(1);
    });

    it("attaches the payment id and signature once Razorpay reports success", () => {
        store.save(entry);
        store.attachPayment(ME, "order_1", "pay_1", "sig_1");
        expect(store.get(ME, "order_1")).toMatchObject({ paymentId: "pay_1", signature: "sig_1" });
        store.attachPayment(CLIENT, "order_1", "pay_x", "sig_x"); // another user's id: ignored
        expect(store.get(ME, "order_1")?.paymentId).toBe("pay_1");
    });

    it("saving the same order again replaces the entry; remove and clear work", () => {
        store.save(entry);
        store.save({ ...entry, amount: 600 });
        expect(store.list(ME)).toHaveLength(1);
        expect(store.list(ME)[0].amount).toBe(600);
        store.remove("order_1");
        expect(store.list(ME)).toEqual([]);
        expect(storage.data.size).toBe(0);

        store.save(entry);
        store.save({ ...entry, userId: CLIENT, orderId: "order_2" });
        store.clear(ME);
        expect(store.list(ME)).toEqual([]);
        expect(store.list(CLIENT)).toHaveLength(1);
    });

    it("forgets entries older than the TTL", () => {
        store.save(entry);
        now += PENDING_TTL_MS + 1;
        expect(store.list(ME)).toEqual([]);
    });

    it("survives garbage in storage", () => {
        storage.data.set("clariva.wallet.pendingPayments", "{not json");
        expect(store.list(ME)).toEqual([]);
        storage.data.set("clariva.wallet.pendingPayments", JSON.stringify([{ nope: 1 }, "x", null]));
        expect(store.list(ME)).toEqual([]);
        store.save(entry);
        expect(store.list(ME)).toHaveLength(1);
    });

    it("never throws when storage is blocked", () => {
        const throwing = new PendingPaymentsStore(() => {
            throw new Error("SecurityError");
        });
        expect(() => throwing.save(entry)).not.toThrow();
        expect(throwing.list(ME)).toEqual([]);

        const failing = new PendingPaymentsStore(() => ({
            getItem: () => {
                throw new Error("denied");
            },
            setItem: () => {
                throw new Error("quota");
            },
            removeItem: () => {
                throw new Error("denied");
            },
        }));
        expect(() => failing.save(entry)).not.toThrow();
        expect(() => failing.remove("order_1")).not.toThrow();
        expect(failing.list(ME)).toEqual([]);
    });

    it("works without any storage at all", () => {
        const none = new PendingPaymentsStore(() => null);
        none.save(entry);
        expect(none.list(ME)).toEqual([]);
    });
});
