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

/**
 * A one-line "the ledger changed" signal. The recharge flow (which can finish after its dialog was closed, or on
 * another screen after a reload recovery) tells any open transaction list to reload page 1 without the two knowing
 * about each other.
 */
const listeners = new Set<() => void>();

/** Subscribe; returns the unsubscribe function. */
export function onLedgerChanged(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function notifyLedgerChanged(): void {
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch {
            // a broken subscriber must not stop the others
        }
    }
}
