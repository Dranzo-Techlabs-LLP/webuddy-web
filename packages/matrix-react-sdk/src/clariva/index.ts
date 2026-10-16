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

import SdkConfig from "../SdkConfig";
import { getClarivaConfig, isClarivaEnabled } from "./config";
import { ClarivaSession } from "./session/ClarivaSession";
import { ClarivaKeyStorage } from "./session/keyStorage";
import { ClarivaBackupProgress } from "./session/backupProgress";
import { clarivaSecretStorageKeys } from "./session/secretStorageKeys";
import { showHistoryUnavailableNotice } from "./session/historyNotice";
import { clearDeliberateSignOut } from "./session/signOutState";
import { WalletStore } from "./stores/WalletStore";

/**
 * Public facade of the Clariva layer. Upstream Element code should only ever need these entry points:
 *
 *  - `Clariva.enabled`            is the Clariva API configured (config.json `clariva.api_base_url`)?
 *  - `Clariva.onSignedIn(userId, client)` after the Matrix client is running (fresh login AND restored session):
 *                                 starts the wallet store + polling and, on a fresh login, the silent key storage
 *  - `Clariva.onSignedOut()`      logout / session expiry: stop polling, forget JWT, balance, caches, keys
 *
 * Everything else is imported directly from the sub-modules (api/, session/, stores/, hooks/, components/).
 */
export const Clariva = {
    get enabled(): boolean {
        return isClarivaEnabled();
    },

    get config(): ReturnType<typeof getClarivaConfig> {
        return getClarivaConfig();
    },

    /**
     * Call once the Matrix client for `matrixUserId` exists (login or restored session). On a fresh login the
     * server-derived secret-storage passphrase is still in `ClarivaSession` and the silent key storage (create on
     * the first device / unlock on later ones) is started from here, outside any React component. A restored
     * session has no passphrase: its device was unlocked when it first signed in.
     */
    onSignedIn(matrixUserId: string, client?: MatrixClient): void {
        if (!isClarivaEnabled()) return;
        logger.debug(`Clariva: signed in as ${matrixUserId}`);
        const passphrase = ClarivaSession.instance.takeRecoveryPassphrase();
        const freshLogin = ClarivaSession.instance.user !== null;
        WalletStore.instance.start(matrixUserId, { isConsultant: ClarivaSession.instance.isConsultantHint });
        if (!client) return;

        ClarivaBackupProgress.instance.attach(client);
        if (passphrase) {
            ClarivaKeyStorage.instance
                .start(client, passphrase)
                .then((outcome) => {
                    if (outcome === "unopenable") showHistoryUnavailableNotice();
                })
                .catch(() => {}); // runKeyStorage never rejects; belt and braces
        } else {
            logger.debug("Clariva: no passphrase for this session (restored session or older API); not unlocking");
        }
        if (freshLogin) void renameDeviceBestEffort(client);
    },

    /** Call on logout, soft logout and deactivation. Safe to call repeatedly. */
    onSignedOut(): void {
        ClarivaKeyStorage.instance.stop();
        ClarivaBackupProgress.instance.detach();
        clarivaSecretStorageKeys.clear();
        clearDeliberateSignOut();
        WalletStore.instance.stop();
        ClarivaSession.instance.clear();
    },
};

/**
 * The server names every minted device "Clariva (<name>)"; give this one the configured web name (spec 01 §5.1 [N]).
 * `PUT /devices/{id}` needs no UIA. Best effort: failures are ignored.
 */
async function renameDeviceBestEffort(client: MatrixClient): Promise<void> {
    const name = SdkConfig.get("default_device_display_name");
    const deviceId = client.getDeviceId();
    if (!name || !deviceId) return;
    try {
        await client.setDeviceDetails(deviceId, { display_name: name }); // eslint-disable-line camelcase
    } catch (e) {
        logger.debug("Clariva: could not rename this device", e);
    }
}
