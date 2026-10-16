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

import { WalletStore, WalletStoreEvent } from "../../src/clariva/stores/WalletStore";
import { ME, configureClariva, installFakeApi, mockResponse, walletUser } from "./helpers";

const enc = encodeURIComponent;

/** The wallet UI shows "Balance unavailable" + Retry (not an invented 0) off this flag. */
describe("WalletStore balanceFailed (wallet UI)", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        configureClariva();
        WalletStore.resetForTests();
    });

    afterEach(() => {
        WalletStore.resetForTests();
        jest.useRealTimers();
    });

    it("is set when the first load fails, keeps the balance unknown, and clears on the next success", async () => {
        let ok = false;
        installFakeApi({
            [`GET /v1/users/${enc(ME)}`]: () =>
                ok ? mockResponse(200, walletUser({ current_hold: "75.00" })) : mockResponse(500, { message: "boom" }),
        });
        const store = WalletStore.instance;
        const onUpdate = jest.fn();
        store.on(WalletStoreEvent.Update, onUpdate);

        store.start(ME);
        await store.refreshBalance();
        expect(store.getSnapshot()).toMatchObject({ loaded: false, credits: null, balanceFailed: true });
        expect(onUpdate).toHaveBeenCalled();

        ok = true;
        onUpdate.mockClear();
        await store.refreshBalance();
        expect(store.getSnapshot()).toMatchObject({ loaded: true, credits: 75, balanceFailed: false });
        expect(onUpdate).toHaveBeenCalled();
    });

    it("keeps the last good balance when a later refresh fails (and flags it)", async () => {
        let ok = true;
        installFakeApi({
            [`GET /v1/users/${enc(ME)}`]: () =>
                ok ? mockResponse(200, walletUser({ current_hold: "75.00" })) : mockResponse(500, { message: "boom" }),
        });
        const store = WalletStore.instance;
        store.start(ME);
        await store.refreshBalance();
        ok = false;
        await store.refreshBalance();
        expect(store.getSnapshot()).toMatchObject({ loaded: true, credits: 75, balanceFailed: true });
    });

    it("is forgotten on sign-out", async () => {
        installFakeApi({ [`GET /v1/users/${enc(ME)}`]: () => mockResponse(500, { message: "boom" }) });
        const store = WalletStore.instance;
        store.start(ME);
        await store.refreshBalance();
        expect(store.getSnapshot().balanceFailed).toBe(true);
        store.stop();
        expect(store.getSnapshot().balanceFailed).toBe(false);
    });
});
