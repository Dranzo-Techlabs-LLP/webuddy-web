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

import { useCallback, useEffect, useReducer } from "react";
import {
    ClientEvent,
    EventType,
    type MatrixEvent,
    type Room,
    RoomEvent,
    RoomStateEvent,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { isClarivaEnabled } from "../config";
import { useWalletSnapshot } from "../hooks/useWallet";
import { useTypedEventEmitter } from "../../hooks/useEventEmitter";
import { getClarivaCallDmPeerId, getClarivaDmPeerId } from "./dmPeer";
import { ChatGateController, ChatGateControllerEvent, buildGateInput } from "./ChatGateController";
import { type GateDecision, type GateReason, decideGate } from "./gate";

/** `getClarivaDmPeerId`, but it can never throw (e.g. `DMRoomMap` not started yet): a failure means "no peer". */
export function safeDmPeerId(room: Room | null | undefined): string | null {
    try {
        return getClarivaDmPeerId(room);
    } catch (e) {
        logger.debug("Clariva: could not determine the DM peer", e);
        return null;
    }
}

/**
 * `getClarivaCallDmPeerId` (the CALLS variant: it also recognises a chat `m.direct` does not list), but it can never
 * throw: a failure means "no peer". Every call-related decision uses this one, never `safeDmPeerId`.
 */
export function safeCallDmPeerId(room: Room | null | undefined): string | null {
    try {
        return getClarivaCallDmPeerId(room);
    } catch (e) {
        logger.debug("Clariva: could not determine the DM peer of a call", e);
        return null;
    }
}

/**
 * The peer of a 1:1 chat (see `getClarivaDmPeerId`), kept up to date as membership / `m.direct` changes. `null` for
 * non-DM rooms and whenever Clariva is disabled (so stock rooms are never touched). For BILLING and GATING; the call
 * controls use `useClarivaCallDmPeerId`.
 */
export function useClarivaDmPeerId(room: Room | null | undefined, watchMembership = true): string | null {
    return useDmPeer(room, watchMembership, safeDmPeerId);
}

/** `useClarivaDmPeerId` for CALLS (see `safeCallDmPeerId`): the same room can be a call peer without being a billed DM. */
export function useClarivaCallDmPeerId(room: Room | null | undefined, watchMembership = true): string | null {
    return useDmPeer(room, watchMembership, safeCallDmPeerId);
}

function useDmPeer(
    room: Room | null | undefined,
    watchMembership: boolean,
    peerOf: (room: Room | null | undefined) => string | null,
): string | null {
    const enabled = isClarivaEnabled();
    // The peer is recomputed on every render (a couple of map lookups) so a room switch never shows the previous
    // room's peer for a frame; the events below only exist to trigger that re-render.
    const [, rerender] = useReducer((n: number) => n + 1, 0);
    const onAccountData = useCallback(
        (ev: MatrixEvent): void => {
            if (ev.getType() === EventType.Direct) rerender();
        },
        [rerender],
    );

    // `watchMembership = false` is for list rows (hundreds of them): `RoomState` allows only 10 listeners by default and
    // a row re-renders with its room list anyway. The `m.direct` listener sits on the client (unlimited listeners).
    useTypedEventEmitter(enabled && watchMembership ? room?.currentState : undefined, RoomStateEvent.Members, rerender);
    useTypedEventEmitter(
        enabled && watchMembership ? (room ?? undefined) : undefined,
        RoomEvent.MyMembership,
        rerender,
    );
    useTypedEventEmitter(enabled ? room?.client : undefined, ClientEvent.AccountData, onAccountData);

    return enabled ? peerOf(room) : null;
}

export interface ChatGateState {
    /** The other party of the 1:1 chat, or `null` (not a DM / Clariva disabled). */
    peerId: string | null;
    /** Replace the composer by the "Chat restricted" bar and hide the call buttons. */
    restricted: boolean;
    /** Which row of the decision table produced `restricted` (diagnostics / tests). */
    reason: GateReason;
    /** My balance (spendable credits), or `null` while unknown. */
    balance: number | null;
    /** The peer's price per 24 h chat, or `null` while unknown. */
    rate: number | null;
    /** Does a hold cover the next message? `null` = unknown. */
    holdExists: boolean | null;
    /** My role: `true` consultant · `false` client · `null` unknown. */
    role: boolean | null;
    /** The peer's role, or `null` while unknown. */
    peerIsConsultant: boolean | null;
}

const NOT_GATED: ChatGateState = Object.freeze({
    peerId: null,
    restricted: false,
    reason: "no-peer",
    balance: null,
    rate: null,
    holdExists: null,
    role: null,
    peerIsConsultant: null,
});

function toState(decision: GateDecision, input: ReturnType<typeof buildGateInput>): ChatGateState {
    return {
        peerId: input.peerId,
        restricted: decision.restricted,
        reason: decision.reason,
        balance: input.balance,
        rate: input.rate,
        holdExists: input.holdExists,
        role: input.role,
        peerIsConsultant: input.peerIsConsultant,
    };
}

/**
 * Evaluate the chat gate for `room` from what is known right now (no network). Exported for non-React callers
 * (forward / drag-and-drop guards).
 */
export function evaluateChatGate(room: Room | null | undefined): ChatGateState {
    if (!isClarivaEnabled()) return NOT_GATED;
    const input = buildGateInput(safeDmPeerId(room));
    return toState(decideGate(input), input);
}

/** Convenience for non-React guards: is this room's composer currently replaced by the "Chat restricted" bar? */
export function isChatRestricted(room: Room | null | undefined): boolean {
    return evaluateChatGate(room).restricted;
}

/**
 * Why this room's composer is replaced by a bar, or null when it is not: the guards without a bar (forward,
 * drag-and-drop, paste) word their notice after it ("consultant-peer" is not a wallet problem).
 */
export function chatRestrictionReason(room: Room | null | undefined): GateReason | null {
    const gate = evaluateChatGate(room);
    return gate.restricted ? gate.reason : null;
}

/**
 * The chat gate for a room (spec 03 §3.2/§3.3). Seeded synchronously from the WalletStore caches, revalidated
 * concurrently and re-polled for confirmed clients by the shared `ChatGateController`; the decision itself is the
 * pure `decideGate`. Dormant (always "not restricted", no timers, no requests) when Clariva is disabled and in every
 * non-DM room.
 */
export function useChatGate(room: Room | null | undefined): ChatGateState {
    return useChatGateForPeer(useClarivaDmPeerId(room));
}

function useChatGateForPeer(peerId: string | null): ChatGateState {
    const enabled = isClarivaEnabled();
    const wallet = useWalletSnapshot(); // re-render on balance / role changes
    const [, rerender] = useReducer((n: number) => n + 1, 0);
    const userId = wallet.userId;

    useEffect(() => {
        if (!enabled || !peerId || !userId) return;
        const controller = ChatGateController.acquire(peerId);
        if (!controller) return;
        controller.on(ChatGateControllerEvent.Update, rerender);
        rerender(); // the controller may have updated between render and subscription
        return () => {
            controller.off(ChatGateControllerEvent.Update, rerender);
            controller.release();
        };
    }, [enabled, peerId, userId]);

    if (!enabled || !peerId) return NOT_GATED;
    const input = buildGateInput(peerId);
    return toState(decideGate(input), input);
}

/**
 * For the CALLS workstream: is the chat with this room's peer restricted? The call buttons must be HIDDEN (not
 * disabled) while this is true (spec 03 U9). A client with a covering hold keeps calling even with a low balance; a
 * consultant is never restricted; non-DM rooms never are. It judges the room by its CALL peer (`useClarivaCallDmPeerId`),
 * so the buttons are shown or hidden for exactly the rooms in which a call can be placed.
 */
export function useClarivaCallRestriction(room: Room | null | undefined): boolean {
    return useChatGateForPeer(useClarivaCallDmPeerId(room)).restricted;
}
