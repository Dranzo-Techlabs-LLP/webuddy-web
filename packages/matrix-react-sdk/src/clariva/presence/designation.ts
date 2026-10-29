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

import { useEffect, useReducer } from "react";

import { getClarivaConfig, isClarivaEnabled } from "../config";
import { DEFAULT_CONSULTANT_DESIGNATION } from "../profile/settings";
import { type PeerWalletInfo, WalletStore, WalletStoreEvent } from "../stores/WalletStore";
import { useWalletSnapshot } from "../hooks/useWallet";

/**
 * The badge shown beside a person's name (Android `DmPeerStatus.badge` / `RoomListRoomSummaryFactory`): their
 * designation when they are a consultant ("Consultant" when they have not set one), `null` for a client or while the
 * role is unknown.
 */
export function designationBadgeOf(
    info: Pick<PeerWalletInfo, "isConsultant" | "designation"> | null | undefined,
): string | null {
    if (info?.isConsultant !== true) return null;
    return info.designation ?? DEFAULT_CONSULTANT_DESIGNATION;
}

// One WalletStore listener for every subscriber (a chat list renders dozens of rows; an emitter warns past 10).
const peerSubscribers = new Map<string, Set<() => void>>();
let attachedStore: WalletStore | null = null;

function onPeer(peerId: string): void {
    peerSubscribers.get(peerId)?.forEach((notify) => notify());
}

function syncAttachment(): void {
    const wanted = peerSubscribers.size > 0 ? WalletStore.instance : null;
    if (wanted === attachedStore) return;
    attachedStore?.off(WalletStoreEvent.Peer, onPeer);
    wanted?.on(WalletStoreEvent.Peer, onPeer);
    attachedStore = wanted;
}

/** Call `notify` whenever the WalletStore (re)loads `userId`'s wallet row with a change. Returns the unsubscribe. */
export function subscribePeerChanges(userId: string, notify: () => void): () => void {
    let set = peerSubscribers.get(userId);
    if (!set) peerSubscribers.set(userId, (set = new Set()));
    set.add(notify);
    syncAttachment();
    return () => {
        set!.delete(notify);
        if (set!.size === 0 && peerSubscribers.get(userId) === set) peerSubscribers.delete(userId);
        syncAttachment();
    };
}

/** Re-render whenever the WalletStore (re)loads `userId`'s wallet row with a change. */
export function usePeerChanged(userId: string | null): void {
    const [, rerender] = useReducer((n: number) => n + 1, 0);
    useEffect(() => (userId ? subscribePeerChanges(userId, rerender) : undefined), [userId]);
}

/**
 * The designation badge of the other party of a chat-list row (Android `RoomListRoomSummaryFactory`): read from the
 * cache only, which the row's rate lookup fills ("that same lookup caches the partner's role and designation").
 */
export function useCachedDesignationBadge(userId: string | null): string | null {
    usePeerChanged(userId);
    return userId ? designationBadgeOf(WalletStore.instance.getCachedPeer(userId)) : null;
}

/**
 * `designationBadgeOf` for any user (the profile panel): seeded from the WalletStore cache, looked up once with the
 * list TTL, and refreshed when the store reloads that user (e.g. the open DM re-reads its partner). `null` when
 * Clariva is off.
 */
export function useDesignationBadge(userId: string | null | undefined): string | null {
    const id = isClarivaEnabled() && userId ? userId : null;
    const me = useWalletSnapshot().userId;
    usePeerChanged(id);
    useEffect(() => {
        if (!id || !me) return;
        // a change is announced through WalletStoreEvent.Peer, which re-renders through usePeerChanged
        WalletStore.instance
            .getPeer(id, { maxAgeMs: getClarivaConfig().polling.peer_rate_list_ttl_ms })
            .catch(() => null);
    }, [id, me]);
    return id ? designationBadgeOf(WalletStore.instance.getCachedPeer(id)) : null;
}
