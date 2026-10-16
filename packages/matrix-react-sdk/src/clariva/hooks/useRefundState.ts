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

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { ClientEvent, RoomStateEvent, type Room } from "matrix-js-sdk/src/matrix";

import { Clariva } from "..";
import { getClarivaDmPeerId } from "../chat/dmPeer";
import { WalletStore, WalletStoreEvent } from "../stores/WalletStore";
import {
    INITIAL_REFUND_STATE,
    RefundControllerEvent,
    canRequestRefund as selectCanRequestRefund,
    showRefundBanner as selectShowRefundBanner,
    type RefundActionResult,
    type RefundController,
    type RefundState,
} from "../refund/RefundController";
import { acquireRefundController } from "../refund/registry";
import { MatrixClientPeg } from "../../MatrixClientPeg";
import { isLocalRoom } from "../../utils/localRoom/isLocalRoom";
import { useTypedEventEmitter } from "../../hooks/useEventEmitter";

export interface RefundView {
    /** The shared controller, or `null` when the refund machinery is dormant for this room (see `useRefundState`). */
    controller: RefundController | null;
    state: RefundState;
    /** Client: show the "Request refund" header button (spec U3). */
    canRequestRefund: boolean;
    /** Consultant: show the "Refund request" banner (spec U4). */
    showRefundBanner: boolean;
    /** The one in-flight guard shared by request / approve / reject. */
    isRequestInProgress: boolean;
    requestRefund: () => Promise<RefundActionResult>;
    /** `amount` undefined = FULL refund, a number = PARTIAL refund. */
    approve: (amount?: number) => Promise<RefundActionResult>;
    reject: () => Promise<RefundActionResult>;
}

const IGNORED: RefundActionResult = { ok: false, message: "", ignored: true };

function computePeer(room: Room | null | undefined): string | null {
    // A not-yet-created DM (LocalRoom) cannot have a hold yet; never send a local room id to the Wallet-API.
    if (!room || isLocalRoom(room)) return null;
    try {
        return getClarivaDmPeerId(room);
    } catch {
        return null; // DMRoomMap not started yet
    }
}

/** The user the wallet store is tracking (becomes non-null once `Clariva.onSignedIn` ran). */
function useWalletUserId(): string | null {
    const store = WalletStore.instance;
    const [userId, setUserId] = useState<string | null>(() => store.userId);
    useEffect(() => {
        const onUpdate = (): void => setUserId(store.userId);
        store.on(WalletStoreEvent.Update, onUpdate);
        onUpdate();
        return () => {
            store.off(WalletStoreEvent.Update, onUpdate);
        };
    }, [store]);
    return userId;
}

/**
 * Hold / refund state of an open 1:1 chat, for the header button, the consultant banner, the approve dialog and the
 * toast host. All of them share ONE `RefundController` per (room, peer) — one poll, one in-flight guard — which is
 * created with the first holder and cancelled when the last one unmounts.
 *
 * Dormant (idle state, actions ignored, no polling) when Clariva is not configured, the wallet store is not running,
 * the room is not a 1:1 chat with a known peer, or it is a not-yet-created local room.
 */
export function useRefundState(room: Room | null | undefined): RefundView {
    const client = MatrixClientPeg.get();
    const walletUserId = useWalletUserId();

    // The peer changes when members load / leave or `m.direct` changes: recompute on those events.
    const [version, bump] = useReducer((x: number) => x + 1, 0);
    useTypedEventEmitter(room?.currentState, RoomStateEvent.Members, bump);
    useTypedEventEmitter(client ?? undefined, ClientEvent.AccountData, bump);
    const peerId = useMemo(() => computePeer(room), [room, version]); // eslint-disable-line react-hooks/exhaustive-deps

    const key =
        Clariva.enabled && client && room && peerId && walletUserId ? `${room.roomId}|${peerId}|${walletUserId}` : null;
    const [handle, setHandle] = useState<{ key: string; controller: RefundController } | null>(null);
    useEffect(() => {
        if (!key || !client || !room || !peerId) {
            setHandle(null);
            return;
        }
        const acquired = acquireRefundController(client, room.roomId, peerId);
        setHandle({ key, controller: acquired.controller });
        return () => acquired.release();
    }, [key, client, room, peerId]);
    // Never serve the controller of the PREVIOUS room for the one render before the effect swaps it.
    const controller = handle && handle.key === key ? handle.controller : null;

    const [, rerender] = useReducer((x: number) => x + 1, 0);
    useEffect(() => {
        if (!controller) return;
        const onUpdate = (): void => rerender();
        controller.on(RefundControllerEvent.Update, onUpdate);
        onUpdate(); // catch anything that changed between render and subscription
        return () => {
            controller.off(RefundControllerEvent.Update, onUpdate);
        };
    }, [controller]);

    const state = controller?.state ?? INITIAL_REFUND_STATE;
    const requestRefund = useCallback(
        (): Promise<RefundActionResult> => (controller ? controller.requestRefund() : Promise.resolve(IGNORED)),
        [controller],
    );
    const approve = useCallback(
        (amount?: number): Promise<RefundActionResult> =>
            controller ? controller.approve(amount) : Promise.resolve(IGNORED),
        [controller],
    );
    const reject = useCallback(
        (): Promise<RefundActionResult> => (controller ? controller.reject() : Promise.resolve(IGNORED)),
        [controller],
    );

    return {
        controller,
        state,
        canRequestRefund: selectCanRequestRefund(state),
        showRefundBanner: selectShowRefundBanner(state),
        isRequestInProgress: state.isRequestInProgress,
        requestRefund,
        approve,
        reject,
    };
}
