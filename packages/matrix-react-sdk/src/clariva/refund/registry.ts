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

import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { type RoomMessageEventContent } from "matrix-js-sdk/src/types";

import { ClarivaWalletApi } from "../api/wallet";
import { getClarivaConfig } from "../config";
import { WalletStore } from "../stores/WalletStore";
import { RefundController, type RefundControllerDeps } from "./RefundController";

/**
 * Wire a `RefundController` to the real world: the Wallet-API, the wallet store (role / peer lookups / list pills)
 * and the Matrix client (announcements). The announcements go through `client.sendMessage` directly — NOT through
 * the composer — so they bypass the chat gate and never trigger a hold (spec 03 §3.4 last bullet).
 */
export function createRefundControllerDeps(client: MatrixClient, roomId: string, peerId: string): RefundControllerDeps {
    const wallet = WalletStore.instance;
    return {
        api: ClarivaWalletApi,
        myUserId: client.getSafeUserId(),
        getOwnAliases: () => [wallet.webuddyName],
        peerId,
        // `com.clariva.refund` is an extra field (decision D6); the SDK's content type does not know it.
        sendMessage: (content) => client.sendMessage(roomId, content as unknown as RoomMessageEventContent),
        isConsultant: async (userId) => {
            if (userId === wallet.userId || userId === wallet.webuddyName) return wallet.isConsultant;
            return (await wallet.getPeer(userId))?.isConsultant ?? null;
        },
        refreshPendingRefunds: () => wallet.refreshPendingRefunds(),
        getPollIntervalMs: () => getClarivaConfig().polling.hold_status_ms,
        billConsultantsOnly: () => getClarivaConfig().bill_consultants_only,
    };
}

interface Entry {
    controller: RefundController;
    refs: number;
}

const entries = new Map<string, Entry>();

export interface RefundControllerHandle {
    controller: RefundController;
    /** Drop this holder's reference; the last one stops the poll. Idempotent. */
    release: () => void;
}

/**
 * Share ONE controller (hence one poll, one in-flight guard, one set of local refund states) between everything in
 * the room view that needs it: the header button, the consultant banner, the approve dialog and the toast host.
 * Reference counted: the poll starts with the first holder and is cancelled when the last one unmounts.
 */
export function acquireRefundController(client: MatrixClient, roomId: string, peerId: string): RefundControllerHandle {
    const key = `${client.getSafeUserId()}|${roomId}|${peerId}`;
    let entry = entries.get(key);
    if (!entry) {
        entry = { controller: new RefundController(createRefundControllerDeps(client, roomId, peerId)), refs: 0 };
        entries.set(key, entry);
    }
    entry.refs++;
    entry.controller.start();

    const held = entry;
    let released = false;
    return {
        controller: held.controller,
        release: (): void => {
            if (released) return;
            released = true;
            held.refs--;
            if (held.refs <= 0) {
                held.controller.dispose();
                if (entries.get(key) === held) entries.delete(key);
            }
        },
    };
}

/** Test helper: forget (and dispose) every shared controller. */
export function resetRefundControllersForTests(): void {
    for (const { controller } of entries.values()) controller.dispose();
    entries.clear();
}
