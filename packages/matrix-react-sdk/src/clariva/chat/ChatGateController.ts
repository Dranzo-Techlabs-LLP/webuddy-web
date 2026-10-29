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

import { TypedEventEmitter } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { getClarivaConfig } from "../config";
import { WalletStore, WalletStoreEvent, type PeerWalletInfo } from "../stores/WalletStore";
import { type GateInput } from "./gate";

export enum ChatGateControllerEvent {
    /** The hold state or the peer's rate / role changed. */
    Update = "Clariva.ChatGate.update",
}

type EventHandlerMap = { [ChatGateControllerEvent.Update]: () => void };

/**
 * Owns the per-peer inputs of the chat gate that are NOT in the wallet snapshot (spec 03 §3.2): the hold state and
 * the peer's price / role. One controller exists per (me, peer) pair no matter how many components look at it (main
 * composer, thread composer, room header call buttons...), so the 60 s revalidation of a chat is never multiplied
 * (lesson L7: faster polling starved the Wallet-API's MySQL pool). Components acquire / release it (ref-counted).
 *
 *  - Seeded synchronously from the WalletStore caches so a re-opened chat shows "Chat restricted" at first paint.
 *  - Revalidated CONCURRENTLY (balance, hold-exists, peer) and the results are assigned DIRECTLY: a failed hold
 *    re-check clears the stale cached value to `null` = unknown = not restricted (L2, L3).
 *  - Re-polled every `polling.gate_ms` ONLY for a confirmed client (role === false): the loop is keyed on the role,
 *    never on the restriction state, so a flicker does not restart it (L6). Each round is joined before the next
 *    delay is scheduled. Paused while the tab is hidden, refreshed on `visibilitychange`.
 *  - A consultant skips the balance / hold lookups altogether (`exists` is role-inverted for them) and only looks the
 *    peer's ROLE up, cache-first and once (a role practically never changes), for the consultant <-> consultant rule
 *    (Android MessageComposerPresenter `peerIsConsultantState`). Consultants are never polled.
 *  - A peer re-read elsewhere (`WalletStoreEvent.Peer`, e.g. the chat header's forced refresh) updates the peer here.
 */
export class ChatGateController extends TypedEventEmitter<ChatGateControllerEvent, EventHandlerMap> {
    private static readonly registry = new Map<string, ChatGateController>();

    /** Get (creating and starting if needed) the shared controller for the signed-in user and `peerId`. */
    public static acquire(peerId: string): ChatGateController | null {
        const me = WalletStore.instance.userId;
        if (!me) return null;
        const key = `${me}|${peerId}`;
        let controller = ChatGateController.registry.get(key);
        if (!controller) {
            controller = new ChatGateController(key, peerId);
            ChatGateController.registry.set(key, controller);
            controller.start();
        }
        controller.refCount++;
        return controller;
    }

    /** The running controller for `peerId`, if some component currently holds one. Never creates. */
    public static peek(peerId: string): ChatGateController | undefined {
        const me = WalletStore.instance.userId;
        return me ? ChatGateController.registry.get(`${me}|${peerId}`) : undefined;
    }

    /**
     * What is known right now about the hold state and the peer, without any network: the live controller's state if
     * there is one, else the WalletStore first-paint caches.
     */
    public static knownState(peerId: string): { holdExists: boolean | null; peer: PeerWalletInfo | null } {
        const live = ChatGateController.peek(peerId);
        if (live) return { holdExists: live.holdExistsInternal, peer: live.peerInternal };
        const wallet = WalletStore.instance;
        return { holdExists: wallet.getCachedHoldExists(peerId) ?? null, peer: wallet.getCachedPeer(peerId) ?? null };
    }

    /** Record a fact learned elsewhere (e.g. the hold was just created), so the UI does not wait for a re-check. */
    public static noteHoldExists(peerId: string, value: boolean | null): void {
        ChatGateController.peek(peerId)?.setHoldExists(value);
    }

    /** Test helper: dispose every controller. */
    public static resetForTests(): void {
        for (const controller of [...ChatGateController.registry.values()]) controller.dispose();
        ChatGateController.registry.clear();
    }

    private refCount = 0;
    private disposed = false;
    private holdExistsInternal: boolean | null = null;
    private peerInternal: PeerWalletInfo | null = null;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private inFlight: Promise<void> | null = null;
    private seq = 0;
    private lastRole: boolean | null = null;

    private constructor(
        private readonly key: string,
        public readonly peerId: string,
    ) {
        super();
    }

    public get holdExists(): boolean | null {
        return this.holdExistsInternal;
    }

    public get peer(): PeerWalletInfo | null {
        return this.peerInternal;
    }

    private start(): void {
        const wallet = WalletStore.instance;
        // Seed synchronously from the caches (a stale `false` is safe: the revalidation below overwrites it).
        this.holdExistsInternal = wallet.getCachedHoldExists(this.peerId) ?? null;
        this.peerInternal = wallet.getCachedPeer(this.peerId) ?? null;
        this.lastRole = wallet.isConsultant;
        wallet.on(WalletStoreEvent.Update, this.onWalletUpdate);
        wallet.on(WalletStoreEvent.Peer, this.onPeer);
        if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisibilityChange);
        void this.revalidate().then(() => this.scheduleNext());
    }

    public release(): void {
        this.refCount = Math.max(0, this.refCount - 1);
        if (this.refCount === 0) this.dispose();
    }

    private dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.clearTimer();
        WalletStore.instance.off(WalletStoreEvent.Update, this.onWalletUpdate);
        WalletStore.instance.off(WalletStoreEvent.Peer, this.onPeer);
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibilityChange);
        if (ChatGateController.registry.get(this.key) === this) ChatGateController.registry.delete(this.key);
        this.removeAllListeners();
    }

    public setHoldExists(value: boolean | null): void {
        if (this.disposed || this.holdExistsInternal === value) return;
        this.holdExistsInternal = value;
        this.emit(ChatGateControllerEvent.Update);
    }

    /**
     * Fetch balance, hold state and the peer's rate / role concurrently and assign the results directly (L2/L3).
     * `fresh` forces a new round even if one is running (used after a send, whose in-flight predecessor may have
     * started before the hold was created); the latest round to START wins, so a slow stale one cannot overwrite it.
     */
    public revalidate(options?: { fresh?: boolean }): Promise<void> {
        if (this.disposed) return Promise.resolve();
        if (this.inFlight && !options?.fresh) return this.inFlight;
        const run = this.runRevalidate();
        this.inFlight = run;
        const clear = (): void => {
            if (this.inFlight === run) this.inFlight = null;
        };
        void run.then(clear, clear);
        return run;
    }

    private async runRevalidate(): Promise<void> {
        const wallet = WalletStore.instance;
        // Consultants never need the balance / hold (and `exists` is role-inverted for them): L6. They only need the
        // peer's role, for the consultant <-> consultant rule.
        if (wallet.isConsultant === true) return this.lookUpPeerRole();
        const seq = ++this.seq;
        const [, hold, peer] = await Promise.all([
            wallet.refreshBalance(),
            wallet.checkHoldExists(this.peerId),
            wallet.getPeer(this.peerId),
        ]);
        if (this.disposed || seq !== this.seq) return;
        let changed = false;
        // DIRECT assignment: a failed re-check (null) must clear a stale cached value (L2).
        if (hold !== this.holdExistsInternal) {
            this.holdExistsInternal = hold;
            changed = true;
        }
        // Rate / role: only overwritten by a successful lookup (Android: `getMaxCredits(peer)?.let { rate = it }`).
        if (peer && peer !== this.peerInternal) {
            this.peerInternal = peer;
            changed = true;
        }
        if (changed) this.emit(ChatGateControllerEvent.Update);
    }

    /** Consultants: the peer's role only, cache-first (default open-chat TTL). A failed lookup keeps what is known. */
    private async lookUpPeerRole(): Promise<void> {
        const seq = ++this.seq;
        const peer = await WalletStore.instance.getPeer(this.peerId);
        if (this.disposed || seq !== this.seq) return;
        if (peer && peer !== this.peerInternal) {
            this.peerInternal = peer;
            this.emit(ChatGateControllerEvent.Update);
        }
    }

    // ── polling (confirmed clients only, never faster than the config floor) ───────────────────────────────

    private clearTimer(): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
    }

    private scheduleNext(): void {
        this.clearTimer();
        if (this.disposed) return;
        if (WalletStore.instance.isConsultant !== false) return; // confirmed clients only
        if (typeof document !== "undefined" && document.hidden) return;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.revalidate({ fresh: true })
                .catch((e) => logger.debug("Clariva gate: revalidation failed", e))
                .then(() => this.scheduleNext());
        }, getClarivaConfig().polling.gate_ms);
    }

    private readonly onWalletUpdate = (): void => {
        const wallet = WalletStore.instance;
        if (wallet.userId === null || `${wallet.userId}|${this.peerId}` !== this.key) {
            // The account changed under us; the components re-acquire a controller for the new user.
            this.dispose();
            return;
        }
        const role = wallet.isConsultant;
        if (role === this.lastRole) return; // only the role matters here: the loop is keyed on it, not on balances
        this.lastRole = role;
        // The loop is keyed on the role: start it when a client is confirmed, stop it for a consultant.
        if (role === false && this.timer === undefined) this.scheduleNext();
        else if (role !== false) this.clearTimer();
        // A consultant confirmed late still needs the peer's role (consultant <-> consultant rule).
        if (role === true && this.peerInternal === null) void this.revalidate();
    };

    private readonly onPeer = (peerId: string): void => {
        if (this.disposed || peerId !== this.peerId) return;
        const peer = WalletStore.instance.getCachedPeer(peerId);
        if (!peer || peer === this.peerInternal) return;
        this.peerInternal = peer;
        this.emit(ChatGateControllerEvent.Update);
    };

    private readonly onVisibilityChange = (): void => {
        if (this.disposed) return;
        if (document.hidden) {
            this.clearTimer();
        } else if (WalletStore.instance.isConsultant !== true) {
            void this.revalidate({ fresh: true }).then(() => this.scheduleNext());
        }
    };
}

/**
 * Collect the gate inputs from what is known RIGHT NOW (no network): wallet snapshot + live controller state or
 * the first-paint caches. Pure reads, safe to call during render.
 */
export function buildGateInput(peerId: string | null): GateInput {
    const wallet = WalletStore.instance;
    const known = peerId ? ChatGateController.knownState(peerId) : { holdExists: null, peer: null };
    return {
        peerId,
        role: wallet.isConsultant,
        holdExists: known.holdExists,
        balance: wallet.credits,
        rate: known.peer ? known.peer.maxCredits : null,
        peerIsConsultant: known.peer ? known.peer.isConsultant : null,
        billConsultantsOnly: getClarivaConfig().bill_consultants_only,
    };
}
