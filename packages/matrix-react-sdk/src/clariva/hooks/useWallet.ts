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

import { useEffect, useState } from "react";

import { WalletStore, WalletStoreEvent, type WalletSnapshot } from "../stores/WalletStore";

/**
 * Subscribe a component to the wallet (balance, role, own price). React 17 has no `useSyncExternalStore`, so this
 * is the classic emitter + effect pattern. Returns a fresh snapshot object per change.
 */
export function useWalletSnapshot(): WalletSnapshot {
    const store = WalletStore.instance;
    const [snapshot, setSnapshot] = useState<WalletSnapshot>(() => store.getSnapshot());
    useEffect(() => {
        const onUpdate = (): void => setSnapshot(store.getSnapshot());
        store.on(WalletStoreEvent.Update, onUpdate);
        onUpdate(); // catch anything that changed between render and subscription
        return () => {
            store.off(WalletStoreEvent.Update, onUpdate);
        };
    }, [store]);
    return snapshot;
}

/** The consultant's clients that currently have an open refund request (empty for non-consultants). */
export function usePendingRefundClients(): ReadonlySet<string> {
    const store = WalletStore.instance;
    const [clients, setClients] = useState<ReadonlySet<string>>(() => store.pendingRefundClients);
    useEffect(() => {
        const onChange = (next: ReadonlySet<string>): void => setClients(next);
        store.on(WalletStoreEvent.PendingRefunds, onChange);
        setClients(store.pendingRefundClients);
        return () => {
            store.off(WalletStoreEvent.PendingRefunds, onChange);
        };
    }, [store]);
    return clients;
}
