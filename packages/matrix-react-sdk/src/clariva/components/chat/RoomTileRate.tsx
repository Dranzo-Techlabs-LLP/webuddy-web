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

import React, { useEffect, useState } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import { WalletStore } from "../../stores/WalletStore";
import { useWalletSnapshot } from "../../hooks/useWallet";
import { useClarivaDmPeerId } from "../../chat/useChatGate";
import { chatStrings } from "../../strings/chat";
import { formatCredits } from "../../money";

/**
 * Cap on simultaneous `GET /v1/users/{peer}` lookups from the room list. A sublist can render dozens of DM rows at
 * once; the Wallet-API's MySQL pool has been starved by chatty clients before (lesson L7), so the lookups are queued.
 * `WalletStore.getPeer` additionally caches (list TTL) and de-duplicates per peer.
 */
const MAX_CONCURRENT_LOOKUPS = 3;
let activeLookups = 0;
const lookupQueue: Array<() => void> = [];

function pumpQueue(): void {
    while (activeLookups < MAX_CONCURRENT_LOOKUPS && lookupQueue.length > 0) {
        activeLookups++;
        lookupQueue.shift()!();
    }
}

/** Resolve the consultant rate through the queue; resolves `null` without any request if the row went away. */
function lookUpRateQueued(peerId: string, isCancelled: () => boolean): Promise<number | null> {
    return new Promise((resolve) => {
        lookupQueue.push(() => {
            const done = (value: number | null): void => {
                activeLookups--;
                resolve(value);
                pumpQueue();
            };
            if (isCancelled()) return done(null);
            WalletStore.instance.getConsultantRate(peerId).then(done, () => done(null));
        });
        pumpQueue();
    });
}

/** Test helper. */
export function resetRateLookupsForTests(): void {
    lookupQueue.length = 0;
    activeLookups = 0;
}

/**
 * "{n} credits" on a chat-list row (spec 03 U8): the PEER's price per 24 h chat. Shown only for a 1:1 room whose peer is
 * a CONSULTANT with a known price — never for a client peer, and silently nothing for a peer without a wallet row or
 * while the lookup is pending/failed. Uses the list TTL (5 min), not the open-chat TTL.
 */
export function ClarivaRoomTileRate({ room }: { room: Room }): JSX.Element | null {
    const peerId = useClarivaDmPeerId(room, false);
    const userId = useWalletSnapshot().userId;
    const [lookup, setLookup] = useState<{ peerId: string; rate: number | null } | null>(null);

    useEffect(() => {
        if (!peerId || !userId) return;
        let cancelled = false;
        void lookUpRateQueued(peerId, () => cancelled).then((rate) => {
            if (!cancelled) setLookup({ peerId, rate });
        });
        return () => {
            cancelled = true;
        };
    }, [peerId, userId]);

    if (!peerId) return null;
    // First paint from the cache (instant on re-render), then whatever the lookup found for THIS peer.
    const cached = WalletStore.instance.getCachedPeer(peerId);
    const rate =
        lookup && lookup.peerId === peerId ? lookup.rate : cached?.isConsultant === true ? cached.maxCredits : null;
    if (rate === null) return null;
    return (
        <span className="mx_ClarivaRoomTileRate" data-testid="clariva-room-rate">
            {chatStrings.gateRateLabel(formatCredits(rate))}
        </span>
    );
}
