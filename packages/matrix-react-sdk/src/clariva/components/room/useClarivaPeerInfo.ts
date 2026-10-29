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
import { type Room } from "matrix-js-sdk/src/matrix";

import { getClarivaConfig } from "../../config";
import { WalletStore, type PeerWalletInfo } from "../../stores/WalletStore";
import { useWalletSnapshot } from "../../hooks/useWallet";
import { useClarivaDmPeerId } from "../../chat/useChatGate";
import { designationBadgeOf, usePeerChanged } from "../../presence/designation";

export interface ClarivaPeerInfo {
    /** The other party of a 1:1 chat, or `null` (not a DM, or Clariva is off). */
    peerId: string | null;
    /** `true` consultant, `false` client, `null` while unknown. */
    isConsultant: boolean | null;
    /** The peer's price per 24 h chat. Only ever set for a consultant whose price is known. */
    rate: number | null;
    /** A consultant's designation badge ("Consultant" when they set none); `null` for a client or while unknown. */
    badge: string | null;
}

const UNKNOWN: ClarivaPeerInfo = Object.freeze({ peerId: null, isConsultant: null, rate: null, badge: null });

/** The room-facing view of what the wallet knows about a peer (the same data the chat-list "{n} credits" tag reads). */
export function peerInfoOf(peerId: string | null, info: PeerWalletInfo | null | undefined): ClarivaPeerInfo {
    if (!peerId) return UNKNOWN;
    if (!info) return { peerId, isConsultant: null, rate: null, badge: null };
    return {
        peerId,
        isConsultant: info.isConsultant,
        rate: info.isConsultant === true ? info.maxCredits : null,
        badge: designationBadgeOf(info),
    };
}

/**
 * Role and price of the other party of a 1:1 chat, for the room header and the intro card. Seeded synchronously from
 * the WalletStore cache (instant on a re-opened chat), then refreshed through `WalletStore.getPeer`, which caches and
 * de-duplicates per peer with the room-list TTL (the Wallet-API's pool has been starved by chatty clients before,
 * lesson L7: this adds at most one cached lookup per open chat). Silent when the peer is unknown or not a Clariva user.
 * A later reload of the peer (the open chat re-reads it, Android `refreshPeerProfile`) shows up through
 * `WalletStoreEvent.Peer`.
 */
export function useClarivaPeerInfo(room: Room | null | undefined): ClarivaPeerInfo {
    // no membership listener: a RoomState allows few of them and the parent re-renders on membership changes anyway
    const peerId = useClarivaDmPeerId(room, false);
    const userId = useWalletSnapshot().userId;
    const [lookup, setLookup] = useState<{ peerId: string; info: PeerWalletInfo | null } | null>(null);
    usePeerChanged(peerId);

    useEffect(() => {
        if (!peerId || !userId) return;
        let cancelled = false;
        const maxAgeMs = getClarivaConfig().polling.peer_rate_list_ttl_ms;
        WalletStore.instance.getPeer(peerId, { maxAgeMs }).then(
            (info) => {
                if (!cancelled) setLookup({ peerId, info });
            },
            () => {
                if (!cancelled) setLookup({ peerId, info: null });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [peerId, userId]);

    if (!peerId) return UNKNOWN;
    // the cache holds the newest reload (a forced re-read replaces it); the lookup covers a peer the cache dropped
    const fresh = lookup && lookup.peerId === peerId ? lookup.info : undefined;
    return peerInfoOf(peerId, WalletStore.instance.getCachedPeer(peerId) ?? fresh);
}
