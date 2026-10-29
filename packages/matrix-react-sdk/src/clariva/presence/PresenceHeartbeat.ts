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
import { type MatrixClient, SetPresence } from "matrix-js-sdk/src/matrix";

import { CallStore, CallStoreEvent } from "../../stores/CallStore";
import { isPresenceEnabled } from "../../utils/presence";
import { sharesWithAnyone } from "../profile/settings";
import { WalletStore, WalletStoreEvent } from "../stores/WalletStore";

/** Inside Synapse's 30 s online timeout and above its presence rate limit (one update per 10 s). */
export const ONLINE_REFRESH_MS = 25_000;

/** What this account should be showing right now (Android `PresenceHeartbeat.Presence`). */
export type HeartbeatState = "online" | "offline" | "hidden";

export interface HeartbeatInputs {
    /** The tab is visible (`document.visibilityState`). */
    visible: boolean;
    /** A call is connected (it keeps the account online while the tab is in the background). */
    inCall: boolean;
    /** My "Last seen and online" choice lets somebody see my presence (not loaded yet counts as shared). */
    visibleToAnyone: boolean;
}

/** The heartbeat's rule (Android `PresenceHeartbeat.start`'s `combine`). */
export function heartbeatState({ visible, inCall, visibleToAnyone }: HeartbeatInputs): HeartbeatState {
    if (!visibleToAnyone) return "hidden";
    return visible || inCall ? "online" : "offline";
}

/**
 * Shows this account as "online" to its chat partners while the web app is in use, like WhatsApp (Android
 * `PresenceHeartbeat`). Under Clariva Element's activity-based `Presence` (3 minutes idle -> "unavailable", driven by
 * /sync) does not run: /sync is told not to touch presence (`set_presence=offline`), and this publishes "online"
 * explicitly every 25 s while the tab is visible or a call is connected, and "offline" as soon as the tab is hidden.
 * If the tab is closed, Synapse's timeout takes the account offline. While my "Last seen and online" choice lets
 * nobody see it, only "offline" is published (chat partners' apps also honour that choice; this just stops the
 * homeserver from holding a status nobody may see).
 */
export class ClarivaPresenceHeartbeat {
    private static internalInstance: ClarivaPresenceHeartbeat | undefined;

    public static get instance(): ClarivaPresenceHeartbeat {
        if (!ClarivaPresenceHeartbeat.internalInstance) {
            ClarivaPresenceHeartbeat.internalInstance = new ClarivaPresenceHeartbeat();
        }
        return ClarivaPresenceHeartbeat.internalInstance;
    }

    /** Test helper. */
    public static resetForTests(): void {
        ClarivaPresenceHeartbeat.internalInstance?.stop();
        ClarivaPresenceHeartbeat.internalInstance = undefined;
    }

    private client: MatrixClient | null = null;
    private state: HeartbeatState | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private walletStore: WalletStore | null = null;
    private callStore: CallStore | null = null;

    public get running(): boolean {
        return this.client !== null;
    }

    /** Start for `client` (after it started syncing). Restarting for another client stops the previous one. */
    public start(client: MatrixClient): void {
        if (this.client === client) return;
        this.stop();
        if (client.isGuest() || !isPresenceEnabled(client)) return;
        this.client = client;
        // /sync must not mark the account online on its own: the heartbeat decides
        void client.setSyncPresence(SetPresence.Offline).catch((e) => logger.warn("Clariva: setSyncPresence", e));

        document.addEventListener("visibilitychange", this.update);
        this.walletStore = WalletStore.instance;
        this.walletStore.on(WalletStoreEvent.Update, this.update);
        this.callStore = CallStore.instance;
        this.callStore.on(CallStoreEvent.ConnectedCalls, this.update);
        this.update();
    }

    /** Stop on logout. Nothing is published: the session is going away and Synapse's timeout ends "online". */
    public stop(): void {
        if (!this.client) return;
        document.removeEventListener("visibilitychange", this.update);
        this.walletStore?.off(WalletStoreEvent.Update, this.update);
        this.callStore?.off(CallStoreEvent.ConnectedCalls, this.update);
        this.walletStore = null;
        this.callStore = null;
        this.clearTimer();
        this.client = null;
        this.state = null;
    }

    private inputs(): HeartbeatInputs {
        const privacy = WalletStore.instance.getSnapshot().presencePrivacy;
        return {
            visible: document.visibilityState !== "hidden",
            inCall: CallStore.instance.connectedCalls.size > 0,
            // not loaded yet counts as shared (the default), as before this choice existed
            visibleToAnyone: privacy ? sharesWithAnyone(privacy) : true,
        };
    }

    private update = (): void => {
        if (!this.client) return;
        const next = heartbeatState(this.inputs());
        if (next === this.state) return; // distinctUntilChanged
        this.state = next;
        this.clearTimer();
        if (next === "online") {
            this.beat();
        } else {
            // turning sharing off also ends any "online" shown right now
            void this.publish("offline");
        }
    };

    private beat = (): void => {
        this.timer = null;
        void this.publish("online");
        this.timer = setTimeout(this.beat, ONLINE_REFRESH_MS);
    };

    private clearTimer(): void {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
    }

    private async publish(presence: "online" | "offline"): Promise<void> {
        const client = this.client;
        if (!client) return;
        try {
            await client.setPresence({ presence });
        } catch (e) {
            // best effort: the next beat (or state change) tries again
            logger.debug(`Clariva: could not publish presence "${presence}"`, e);
        }
    }
}
