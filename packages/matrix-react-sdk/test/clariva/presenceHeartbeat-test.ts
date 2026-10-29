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

import { type MatrixClient, SetPresence } from "matrix-js-sdk/src/matrix";

import Presence from "../../src/Presence";
import SdkConfig from "../../src/SdkConfig";
import { MatrixClientPeg } from "../../src/MatrixClientPeg";
import { CallStore, CallStoreEvent } from "../../src/stores/CallStore";
import { ClarivaPresenceHeartbeat, ONLINE_REFRESH_MS } from "../../src/clariva/presence/PresenceHeartbeat";
import { WalletStore, WalletStoreEvent, type WalletSnapshot } from "../../src/clariva/stores/WalletStore";
import {
    DEFAULT_PRESENCE_PRIVACY,
    LastSeenAudience,
    OnlineAudience,
    type PresencePrivacy,
} from "../../src/clariva/profile/settings";
import { configureClariva } from "./helpers";

describe("ClarivaPresenceHeartbeat (Android PresenceHeartbeat)", () => {
    let visibility: DocumentVisibilityState;
    let privacy: PresencePrivacy | null;
    let client: MatrixClient;
    let connected: Set<unknown>;

    const setVisibility = (state: DocumentVisibilityState): void => {
        visibility = state;
        document.dispatchEvent(new Event("visibilitychange"));
    };
    const published = (): string[] => jest.mocked(client.setPresence).mock.calls.map(([opts]) => opts.presence);

    beforeEach(() => {
        jest.useFakeTimers();
        configureClariva();
        visibility = "visible";
        privacy = null;
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
        client = {
            baseUrl: "https://hs.example",
            isGuest: () => false,
            setSyncPresence: jest.fn(async () => {}),
            setPresence: jest.fn(async () => {}),
        } as unknown as MatrixClient;
        const store = WalletStore.instance;
        const real = store.getSnapshot.bind(store);
        jest.spyOn(store, "getSnapshot").mockImplementation(
            (): WalletSnapshot => ({ ...real(), presencePrivacy: privacy }),
        );
        connected = new Set();
        jest.spyOn(CallStore.instance, "connectedCalls", "get").mockImplementation(() => connected as never);
    });

    afterEach(() => {
        ClarivaPresenceHeartbeat.resetForTests();
        WalletStore.resetForTests();
        jest.restoreAllMocks();
        jest.useRealTimers();
        SdkConfig.reset();
    });

    it("stops /sync from setting presence, then publishes 'online' at once and every 25 s while the tab is visible", () => {
        ClarivaPresenceHeartbeat.instance.start(client);
        expect(client.setSyncPresence).toHaveBeenCalledWith(SetPresence.Offline);
        expect(published()).toEqual(["online"]);
        jest.advanceTimersByTime(ONLINE_REFRESH_MS - 1);
        expect(published()).toEqual(["online"]);
        jest.advanceTimersByTime(1);
        expect(published()).toEqual(["online", "online"]);
        jest.advanceTimersByTime(ONLINE_REFRESH_MS * 2);
        expect(published()).toHaveLength(4);
    });

    it("'offline' as soon as the tab is hidden (once, no heartbeat), 'online' again when it is back", () => {
        ClarivaPresenceHeartbeat.instance.start(client);
        setVisibility("hidden");
        expect(published()).toEqual(["online", "offline"]);
        jest.advanceTimersByTime(ONLINE_REFRESH_MS * 4);
        expect(published()).toEqual(["online", "offline"]);
        setVisibility("visible");
        expect(published()).toEqual(["online", "offline", "online"]);
    });

    it("a connected call keeps the account online while the tab is hidden", () => {
        ClarivaPresenceHeartbeat.instance.start(client);
        connected.add({});
        CallStore.instance.emit(CallStoreEvent.ConnectedCalls, connected as never);
        setVisibility("hidden");
        expect(published()).toEqual(["online"]);
        jest.advanceTimersByTime(ONLINE_REFRESH_MS);
        expect(published()).toEqual(["online", "online"]);
        connected.clear();
        CallStore.instance.emit(CallStoreEvent.ConnectedCalls, connected as never);
        expect(published()).toEqual(["online", "online", "offline"]);
    });

    it("only 'offline' while my 'Last seen and online' choice lets nobody see it; publishing resumes when it does", () => {
        privacy = {
            ...DEFAULT_PRESENCE_PRIVACY,
            lastSeen: LastSeenAudience.Nobody,
            online: OnlineAudience.SameAsLastSeen,
        };
        ClarivaPresenceHeartbeat.instance.start(client);
        expect(published()).toEqual(["offline"]);
        jest.advanceTimersByTime(ONLINE_REFRESH_MS * 3);
        expect(published()).toEqual(["offline"]);

        // "Nobody" for last seen but online for everyone is still visible to someone
        privacy = { ...DEFAULT_PRESENCE_PRIVACY, lastSeen: LastSeenAudience.Nobody };
        WalletStore.instance.emit(WalletStoreEvent.Update);
        expect(published()).toEqual(["offline", "online"]);
    });

    it("a failed publish is retried by the next beat", async () => {
        jest.mocked(client.setPresence).mockRejectedValueOnce(new Error("429"));
        ClarivaPresenceHeartbeat.instance.start(client);
        await Promise.resolve();
        jest.advanceTimersByTime(ONLINE_REFRESH_MS);
        expect(published()).toEqual(["online", "online"]);
    });

    it("stop() ends the heartbeat and every listener (logout)", () => {
        ClarivaPresenceHeartbeat.instance.start(client);
        ClarivaPresenceHeartbeat.instance.stop();
        expect(ClarivaPresenceHeartbeat.instance.running).toBe(false);
        jest.advanceTimersByTime(ONLINE_REFRESH_MS * 3);
        setVisibility("hidden");
        expect(published()).toEqual(["online"]);
    });

    it("does nothing for a guest or when the homeserver's presence is switched off in the config", () => {
        const guest = { ...client, isGuest: () => true } as unknown as MatrixClient;
        ClarivaPresenceHeartbeat.instance.start(guest);
        expect(ClarivaPresenceHeartbeat.instance.running).toBe(false);

        SdkConfig.add({ enable_presence_by_hs_url: { "https://hs.example": false } });
        ClarivaPresenceHeartbeat.instance.start(client);
        expect(ClarivaPresenceHeartbeat.instance.running).toBe(false);
        expect(client.setPresence).not.toHaveBeenCalled();
    });

    describe("Element's Presence", () => {
        beforeEach(() => {
            jest.spyOn(MatrixClientPeg, "safeGet").mockReturnValue(client);
        });
        afterEach(() => Presence.stop());

        it("under Clariva starts the heartbeat instead of activity tracking", async () => {
            await Presence.start();
            expect(ClarivaPresenceHeartbeat.instance.running).toBe(true);
            expect(published()).toEqual(["online"]);
            Presence.stop();
            expect(ClarivaPresenceHeartbeat.instance.running).toBe(false);
        });

        it("without Clariva keeps the stock behaviour (no heartbeat)", () => {
            SdkConfig.reset();
            void Presence.start();
            expect(ClarivaPresenceHeartbeat.instance.running).toBe(false);
            expect(client.setPresence).not.toHaveBeenCalled();
        });
    });
});
