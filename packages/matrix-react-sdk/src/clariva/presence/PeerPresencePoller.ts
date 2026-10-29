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

import { logger } from "matrix-js-sdk/src/logger";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { WalletStore } from "../stores/WalletStore";
import { type PresenceStatusBody, type UserPresence, userPresenceOf } from "./lastSeen";

/** How often an open DM re-reads its partner's presence (Android `PRESENCE_POLL_INTERVAL`). */
export const PRESENCE_POLL_MS = 20_000;
/** Re-read the partner's profile (designation, "Last seen" choice) every this many polls, about once a minute. */
export const PROFILE_REFRESH_EVERY_POLLS = 3;

interface Watch {
    client: MatrixClient;
    peerId: string;
    presence: UserPresence | null;
    listeners: Set<() => void>;
    timer: ReturnType<typeof setTimeout> | null;
    /** Bumped on every (re)start and stop, so a poll that was in flight cannot schedule a stale loop. */
    generation: number;
}

const isVisible = (): boolean => typeof document === "undefined" || document.visibilityState !== "hidden";

/**
 * Reads a DM partner's presence from the homeserver while their chat is on screen (Android `DmPeerStatusPresenter`).
 * The header line, the avatar ring and the intro card of one chat share a single poll per partner: the first
 * subscriber starts it, the last one stops it. It polls every 20 s while the tab is visible and pauses while it is
 * hidden (it polls again straight away when the tab comes back). A failed poll keeps the last known value rather than
 * blanking the label. The partner's wallet profile is re-read once per open and every 3 polls so a designation or a
 * "Last seen" choice they just changed applies without reopening the chat.
 */
export class PeerPresencePoller {
    private static internalInstance: PeerPresencePoller | undefined;

    public static get instance(): PeerPresencePoller {
        if (!PeerPresencePoller.internalInstance) PeerPresencePoller.internalInstance = new PeerPresencePoller();
        return PeerPresencePoller.internalInstance;
    }

    /** Test helper: stop everything and drop the singleton. */
    public static resetForTests(): void {
        PeerPresencePoller.internalInstance?.stopAll();
        PeerPresencePoller.internalInstance = undefined;
    }

    private readonly watches = new Map<string, Watch>();
    private listeningToVisibility = false;

    /** The last presence read for `peerId`, `null` before the first successful poll. */
    public getPresence(peerId: string): UserPresence | null {
        return this.watches.get(peerId)?.presence ?? null;
    }

    /** Watch `peerId` (start polling if nobody did yet); `listener` runs after every successful poll. */
    public subscribe(client: MatrixClient, peerId: string, listener: () => void): () => void {
        let watch = this.watches.get(peerId);
        if (!watch || watch.client !== client) {
            if (watch) this.stopWatch(watch);
            watch = { client, peerId, presence: null, listeners: new Set(), timer: null, generation: 0 };
            this.watches.set(peerId, watch);
            // once per open: a designation the consultant just changed shows up (Android `LaunchedEffect(peerId)`)
            this.refreshProfile(peerId);
            this.startWatch(watch);
        }
        watch.listeners.add(listener);
        this.syncVisibilityListener();

        const subscribed = watch;
        return () => {
            subscribed.listeners.delete(listener);
            if (subscribed.listeners.size === 0 && this.watches.get(peerId) === subscribed) {
                this.stopWatch(subscribed);
                this.watches.delete(peerId);
                this.syncVisibilityListener();
            }
        };
    }

    private startWatch(watch: Watch): void {
        this.stopWatch(watch);
        if (!isVisible()) return;
        const generation = watch.generation;
        let tick = 0;
        const run = async (): Promise<void> => {
            watch.timer = null;
            if (tick > 0 && tick % PROFILE_REFRESH_EVERY_POLLS === 0) this.refreshProfile(watch.peerId);
            tick++;
            await this.poll(watch, generation);
            if (watch.generation !== generation) return;
            watch.timer = setTimeout(() => void run(), PRESENCE_POLL_MS);
        };
        void run();
    }

    private stopWatch(watch: Watch): void {
        watch.generation++;
        if (watch.timer !== null) clearTimeout(watch.timer);
        watch.timer = null;
    }

    private async poll(watch: Watch, generation: number): Promise<void> {
        try {
            const body = (await watch.client.getPresence(watch.peerId)) as PresenceStatusBody;
            if (watch.generation !== generation) return;
            watch.presence = userPresenceOf(body, Date.now());
            watch.listeners.forEach((listener) => listener());
        } catch (e) {
            // 403 = no shared room (or presence is off server-side): keep the last known value
            logger.debug("Clariva: could not read the partner's presence", e);
        }
    }

    private refreshProfile(peerId: string): void {
        if (!WalletStore.instance.userId) return;
        WalletStore.instance.refreshPeer(peerId).catch(() => null);
    }

    private onVisibilityChange = (): void => {
        for (const watch of this.watches.values()) {
            if (isVisible()) this.startWatch(watch);
            else this.stopWatch(watch);
        }
    };

    private syncVisibilityListener(): void {
        if (typeof document === "undefined") return;
        const wanted = this.watches.size > 0;
        if (wanted === this.listeningToVisibility) return;
        if (wanted) document.addEventListener("visibilitychange", this.onVisibilityChange);
        else document.removeEventListener("visibilitychange", this.onVisibilityChange);
        this.listeningToVisibility = wanted;
    }

    private stopAll(): void {
        for (const watch of this.watches.values()) this.stopWatch(watch);
        this.watches.clear();
        this.syncVisibilityListener();
    }
}
