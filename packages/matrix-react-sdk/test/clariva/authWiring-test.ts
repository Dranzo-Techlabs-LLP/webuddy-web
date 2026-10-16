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

import { mocked } from "jest-mock";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { type CryptoApi } from "matrix-js-sdk/src/crypto-api";

import { Clariva } from "../../src/clariva";
import { ClarivaKeyStorage } from "../../src/clariva/session/keyStorage";
import { ClarivaBackupProgress } from "../../src/clariva/session/backupProgress";
import { ClarivaSession } from "../../src/clariva/session/ClarivaSession";
import { clarivaSecretStorageKeys } from "../../src/clariva/session/secretStorageKeys";
import { WalletStore } from "../../src/clariva/stores/WalletStore";
import { shouldShowLogoutDialog } from "../../src/components/views/dialogs/LogoutDialog";
import { AccessCancelledError, accessSecretStorage, crossSigningCallbacks } from "../../src/SecurityManager";
import { showToast as showSetupEncryptionToast, Kind } from "../../src/toasts/SetupEncryptionToast";
import ToastStore from "../../src/stores/ToastStore";
import Modal from "../../src/Modal";
import SdkConfig from "../../src/SdkConfig";
import { filterConsole, stubClient } from "../test-utils";
import { configureClariva } from "./helpers";

const user = { id: "u1", isConsultant: 1 as const };

describe("Clariva.onSignedIn / onSignedOut", () => {
    let walletStart: jest.SpyInstance;
    let keyStorageStart: jest.SpyInstance;
    let client: MatrixClient;

    beforeEach(() => {
        configureClariva();
        ClarivaSession.resetForTests();
        ClarivaKeyStorage.resetForTests();
        ClarivaBackupProgress.resetForTests();
        walletStart = jest.spyOn(WalletStore.instance, "start").mockImplementation(() => {});
        jest.spyOn(WalletStore.instance, "stop").mockImplementation(() => {});
        keyStorageStart = jest.spyOn(ClarivaKeyStorage.instance, "start").mockResolvedValue("created");
        client = {
            on: jest.fn(),
            removeListener: jest.fn(),
            getDeviceId: () => "DEVICE",
            setDeviceDetails: jest.fn().mockResolvedValue({}),
        } as unknown as MatrixClient;
    });

    afterEach(() => {
        jest.restoreAllMocks();
        SdkConfig.reset();
    });

    it("fresh login: starts the wallet (role seeded from the login response) and the silent key storage", () => {
        ClarivaSession.instance.setAuthenticated("jwt", user);
        ClarivaSession.instance.setRecoveryPassphrase("server-passphrase");

        Clariva.onSignedIn("@me:clarivahub.com", client);

        expect(walletStart).toHaveBeenCalledWith("@me:clarivahub.com", { isConsultant: true });
        expect(keyStorageStart).toHaveBeenCalledWith(client, "server-passphrase");
        expect(ClarivaSession.instance.takeRecoveryPassphrase()).toBeNull(); // single use
    });

    it("restored session: starts the wallet, but there is no passphrase so nothing is unlocked", () => {
        Clariva.onSignedIn("@me:clarivahub.com", client);
        expect(walletStart).toHaveBeenCalledWith("@me:clarivahub.com", { isConsultant: null });
        expect(keyStorageStart).not.toHaveBeenCalled();
    });

    it("names the new device after the web client on a fresh login only", async () => {
        SdkConfig.add({ default_device_display_name: "Clariva Web" });
        Clariva.onSignedIn("@me:clarivahub.com", client);
        expect(client.setDeviceDetails).not.toHaveBeenCalled();

        ClarivaSession.instance.setAuthenticated("jwt", user);
        Clariva.onSignedIn("@me:clarivahub.com", client);
        await Promise.resolve();
        expect(client.setDeviceDetails).toHaveBeenCalledWith("DEVICE", { display_name: "Clariva Web" });
    });

    it("is dormant when Clariva is not configured", () => {
        SdkConfig.reset();
        ClarivaSession.instance.setRecoveryPassphrase("server-passphrase");
        Clariva.onSignedIn("@me:clarivahub.com", client);
        expect(walletStart).not.toHaveBeenCalled();
        expect(keyStorageStart).not.toHaveBeenCalled();
    });

    it("sign-out aborts key storage and wipes the JWT, passphrase and in-memory keys", () => {
        const stop = jest.spyOn(ClarivaKeyStorage.instance, "stop");
        ClarivaSession.instance.setAuthenticated("jwt", user);
        ClarivaSession.instance.setRecoveryPassphrase("server-passphrase");
        clarivaSecretStorageKeys.set(new Uint8Array([1, 2, 3]));

        Clariva.onSignedOut();

        expect(stop).toHaveBeenCalled();
        expect(ClarivaSession.instance.jwt).toBeNull();
        expect(ClarivaSession.instance.takeRecoveryPassphrase()).toBeNull();
        expect(clarivaSecretStorageKeys.hasKey).toBe(false);
    });
});

describe("Element's crypto UX is suppressed when Clariva is enabled", () => {
    filterConsole("getSecretStorageKey:", "accessSecretStorage:");

    beforeEach(() => {
        configureClariva();
        clarivaSecretStorageKeys.clear();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        clarivaSecretStorageKeys.clear();
        SdkConfig.reset();
    });

    const stubSecretStorage = () => {
        const cli = stubClient();
        cli.getDefaultSecretStorageKeyId = jest.fn().mockResolvedValue("KEY");
        cli.secretStorage.checkKey = jest.fn().mockResolvedValue(true);
        return cli;
    };
    const keyInfos = { KEY: { algorithm: "a", iv: "i", mac: "m", name: "n", passphrase: {} } } as never;

    it("getSecretStorageKey answers from the silent key and never opens the Security Phrase dialog", async () => {
        stubSecretStorage();
        const createDialog = jest.spyOn(Modal, "createDialog");
        const key = new Uint8Array([4, 5, 6]);
        clarivaSecretStorageKeys.set(key);

        const result = await crossSigningCallbacks.getSecretStorageKey!({ keys: keyInfos }, "m.cross_signing.master");

        expect(result).toEqual(["KEY", key]);
        expect(createDialog).not.toHaveBeenCalled();
    });

    it("without a silent key it fails the operation instead of prompting", async () => {
        stubSecretStorage();
        const createDialog = jest.spyOn(Modal, "createDialog");
        await expect(
            crossSigningCallbacks.getSecretStorageKey!({ keys: keyInfos }, "m.cross_signing.master"),
        ).rejects.toBeInstanceOf(AccessCancelledError);
        expect(createDialog).not.toHaveBeenCalled();
    });

    it("a key that does not open the offered description is never returned", async () => {
        const cli = stubSecretStorage();
        cli.secretStorage.checkKey = jest.fn().mockResolvedValue(false);
        clarivaSecretStorageKeys.set(new Uint8Array([1]));
        await expect(
            crossSigningCallbacks.getSecretStorageKey!({ keys: keyInfos }, "m.cross_signing.master"),
        ).rejects.toBeInstanceOf(AccessCancelledError);
    });

    it("accessSecretStorage runs its callback but never creates, resets or bootstraps anything", async () => {
        const cli = stubClient();
        const crypto = {
            bootstrapCrossSigning: jest.fn(),
            bootstrapSecretStorage: jest.fn(),
        } as unknown as CryptoApi;
        mocked(cli.getCrypto).mockReturnValue(crypto);
        cli.secretStorage.hasKey = jest.fn().mockResolvedValue(false); // stock Element would open CreateSecretStorageDialog
        const createDialog = jest.spyOn(Modal, "createDialog");
        const createDialogAsync = jest.spyOn(Modal, "createDialogAsync");

        const func = jest.fn();
        await accessSecretStorage(func, /* forceReset */ true);

        expect(func).toHaveBeenCalledTimes(1);
        expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
        expect(crypto.bootstrapSecretStorage).not.toHaveBeenCalled();
        expect(createDialog).not.toHaveBeenCalled();
        expect(createDialogAsync).not.toHaveBeenCalled();
    });

    it("the 'set up encryption' / 'verify this session' toast is never shown", () => {
        ToastStore.sharedInstance().reset();
        showSetupEncryptionToast(Kind.SET_UP_ENCRYPTION);
        showSetupEncryptionToast(Kind.VERIFY_THIS_SESSION);
        showSetupEncryptionToast(Kind.UPGRADE_ENCRYPTION);
        expect(ToastStore.sharedInstance().getToasts()).toHaveLength(0);
    });

    it("sign-out always asks for confirmation with the Clariva dialog", async () => {
        const cli = stubClient();
        expect(await shouldShowLogoutDialog(cli)).toBe(true);
    });
});
