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
 * Chat-list "Refund" pill (spec 03 U8): shown iff the signed-in user is a consultant (a CONFIRMED one: unknown
 * hides it) AND the row's 1:1 peer is in the set of clients with an open refund request that
 * `WalletStore.pendingRefundClients` polls from `GET /v1/refund/pending-for-consultant`.
 */
export function shouldShowRefundPill(input: {
    isConsultant: boolean | null;
    /** The row's 1:1 peer, `null` for groups / spaces / DMs whose peer left. */
    peerId: string | null;
    pendingClients: ReadonlySet<string>;
}): boolean {
    return input.isConsultant === true && input.peerId !== null && input.pendingClients.has(input.peerId);
}
