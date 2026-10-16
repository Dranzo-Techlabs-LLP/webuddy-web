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

import React, { type ReactElement, useEffect, useState } from "react";
import { Icon as InfoIcon } from "@vector-im/compound-design-tokens/icons/info-solid.svg";
import { type Room } from "matrix-js-sdk/src/matrix";

import { Clariva } from "../..";
import { getClarivaDmPeerId } from "../../chat/dmPeer";
import { usePendingRefundClients } from "../../hooks/useWallet";
import { WalletStore, WalletStoreEvent } from "../../stores/WalletStore";
import { shouldShowRefundPill } from "../../refund/pill";
import { chatStrings } from "../../strings/chat";

function peerOf(room: Room): string | null {
    try {
        return getClarivaDmPeerId(room);
    } catch {
        return null; // DMRoomMap not started yet
    }
}

/** The signed-in user's role. A dedicated hook: it only re-renders when the role itself changes, not on every balance poll. */
function useIsConsultant(): boolean | null {
    const store = WalletStore.instance;
    const [isConsultant, setIsConsultant] = useState<boolean | null>(() => store.isConsultant);
    useEffect(() => {
        const onUpdate = (): void => setIsConsultant(store.isConsultant);
        store.on(WalletStoreEvent.Update, onUpdate);
        onUpdate();
        return () => {
            store.off(WalletStoreEvent.Update, onUpdate);
        };
    }, [store]);
    return isConsultant;
}

/**
 * Chat list: the red "Refund" pill beside the name of a chat whose client has an open refund request (spec 03 U8).
 * Consultants only; the set is polled by `WalletStore` and refreshed right after approve/reject.
 */
export function ClarivaRefundPill({ room }: { room: Room }): ReactElement | null {
    const isConsultant = useIsConsultant();
    const pendingClients = usePendingRefundClients();
    if (!Clariva.enabled || isConsultant !== true || pendingClients.size === 0) return null;
    if (!shouldShowRefundPill({ isConsultant, peerId: peerOf(room), pendingClients })) return null;
    return (
        <span className="mx_ClarivaRefundPill">
            <InfoIcon className="mx_ClarivaRefundPill_icon" width="12px" height="12px" aria-hidden="true" />
            {chatStrings.refundPill}
        </span>
    );
}
