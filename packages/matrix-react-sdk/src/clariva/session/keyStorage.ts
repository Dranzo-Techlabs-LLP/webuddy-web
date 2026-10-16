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
import { ClientEvent, decodeBase64, type MatrixClient, type SecretStorage, SyncState } from "matrix-js-sdk/src/matrix";
import { deriveKey } from "matrix-js-sdk/src/crypto/key_passphrase";
import { type CryptoApi } from "matrix-js-sdk/src/crypto-api";

import { clarivaSecretStorageKeys } from "./secretStorageKeys";

/**
 * Silent key storage: port of Android's `ClarivaAuthPresenter.unlockKeyStorage` (spec 01 §3.8, web mapping in the
 * "Web decision table").
 *
 * Why it exists: the Wallet-API derives ONE secret-storage passphrase per account and returns it with every Matrix
 * session. The first device to sign in creates secret storage + cross-signing + key backup with it; every later
 * device only unlocks them. The user never sees a recovery key, a Security Phrase dialog or a verification prompt.
 *
 * Hard rules (a violation locks every other device out of the history):
 *  - Create ONLY when, after the first sync, the account has no default secret-storage key.
 *  - Never replace/reset existing secret storage, cross-signing or key backup. Never pass `setupNewCrossSigning` when
 *    the account already has cross-signing keys, never `setupNewSecretStorage`/`setupNewKeyBackup` when a default key
 *    exists.
 *  - Never throw into the UI, never log the passphrase / keys / backup key.
 *  - Runs from a module-level service (not a React effect), single-flight.
 *
 * Verified against matrix-js-sdk 34.4 (rust-crypto):
 *  - `bootstrapCrossSigning({})` imports master/self/user keys from 4S when they are not cached locally and
 *    cross-signs this device; if the keys are in neither place it would CREATE new ones, so it is only called when
 *    `getCrossSigningStatus()` says the keys exist on the device or in 4S.
 *  - There is no `loadSessionBackupPrivateKeyFromSecretStorage` in 34.4: the backup key is read with
 *    `secretStorage.get("m.megolm_backup.v1")` and cached with `storeSessionBackupPrivateKey(key, version)` (this is
 *    what `MatrixClient.restoreKeyBackup` does), then `checkKeyBackupAndEnable()` starts uploading new sessions and
 *    lets the SDK download missing room keys per session on demand (no bulk restore).
 */

export type KeyStorageOutcome =
    /** The server sent no passphrase (older API): history is unavailable on this device. */
    | "no-passphrase"
    | "no-crypto"
    /** The first sync did not complete in time: nothing was created, nothing is retried until the next sign-in. */
    | "sync-timeout"
    /** First device: secret storage, cross-signing and key backup were created. */
    | "created"
    /** Later device: cross-signing and the backup key were imported from secret storage. */
    | "unlocked"
    | "already-unlocked"
    /** Secret storage exists but cannot be opened with the server passphrase. Nothing was touched. */
    | "unopenable"
    /** Something threw (network, crypto); logged, never shown. */
    | "failed"
    | "aborted";

/** Wait this long for the first sync before giving up (Android: RECOVERY_STATE_TIMEOUT = 20 s). */
export const KEY_STORAGE_SYNC_TIMEOUT_MS = 20_000;

/** The slice of `MatrixClient` the service uses (keeps the service trivially fakeable). */
export type KeyStorageClient = Pick<MatrixClient, "getSafeUserId" | "getDeviceId" | "isInitialSyncComplete"> & {
    getCrypto(): KeyStorageCrypto | undefined;
    secretStorage: Pick<SecretStorage.ServerSideSecretStorage, "getDefaultKeyId" | "getKey" | "checkKey" | "get">;
    on(event: ClientEvent.Sync, handler: (state: SyncState) => void): unknown;
    removeListener(event: ClientEvent.Sync, handler: (state: SyncState) => void): unknown;
};

/** The slice of `CryptoApi` the service uses. */
export type KeyStorageCrypto = Pick<
    CryptoApi,
    | "userHasCrossSigningKeys"
    | "bootstrapCrossSigning"
    | "bootstrapSecretStorage"
    | "createRecoveryKeyFromPassphrase"
    | "getCrossSigningStatus"
    | "getDeviceVerificationStatus"
    | "crossSignDevice"
    | "getSessionBackupPrivateKey"
    | "storeSessionBackupPrivateKey"
    | "checkKeyBackupAndEnable"
>;

export interface KeyStorageDeps {
    /** PBKDF2 (SHA-512) key derivation; injectable because jsdom has no WebCrypto. */
    deriveKey: (password: string, salt: string, iterations: number, bits: number) => Promise<Uint8Array>;
    syncTimeoutMs: number;
}

const defaultDeps: KeyStorageDeps = {
    deriveKey: (password, salt, iterations, bits) => deriveKey(password, salt, iterations, bits),
    syncTimeoutMs: KEY_STORAGE_SYNC_TIMEOUT_MS,
};

function describe(e: unknown): string {
    // Error messages from the SDK never contain key material; still keep the log line free of anything user-provided.
    return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/** Resolve `true` once the first sync has been processed, `false` after `timeoutMs` (or when aborted). */
export function waitForInitialSync(
    client: KeyStorageClient,
    timeoutMs: number,
    signal?: AbortSignal,
): Promise<boolean> {
    if (signal?.aborted) return Promise.resolve(false);
    if (client.isInitialSyncComplete()) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
        const finish = (result: boolean): void => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            client.removeListener(ClientEvent.Sync, onSync);
            resolve(result);
        };
        const onSync = (state: SyncState): void => {
            if (state === SyncState.Prepared || state === SyncState.Syncing) finish(true);
        };
        const onAbort = (): void => finish(false);
        const timer = setTimeout(() => finish(false), timeoutMs);
        signal?.addEventListener("abort", onAbort);
        client.on(ClientEvent.Sync, onSync);
    });
}

/**
 * One complete attempt. Never throws; the returned outcome is for tests, the notice and logging.
 */
export async function runKeyStorage(
    client: KeyStorageClient,
    passphrase: string | null | undefined,
    options: Partial<KeyStorageDeps> & { signal?: AbortSignal } = {},
): Promise<KeyStorageOutcome> {
    const deps: KeyStorageDeps = { ...defaultDeps, ...options };
    const signal = options.signal;

    if (!passphrase || !passphrase.trim()) {
        logger.warn("Clariva key storage: no passphrase from the server; history unavailable on this device");
        return "no-passphrase";
    }

    try {
        const crypto = client.getCrypto();
        if (!crypto) {
            logger.warn("Clariva key storage: encryption is not available; skipping");
            return "no-crypto";
        }

        // Never decide DISABLED/ENABLED before the first sync has been processed.
        if (!(await waitForInitialSync(client, deps.syncTimeoutMs, signal))) {
            if (signal?.aborted) return "aborted";
            logger.warn("Clariva key storage: first sync did not complete in time; skipping (nothing created)");
            return "sync-timeout";
        }
        if (signal?.aborted) return "aborted";

        const defaultKeyId = await client.secretStorage.getDefaultKeyId();
        if (signal?.aborted) return "aborted";

        if (defaultKeyId === null) {
            // DISABLED: no secret storage on the account => this is the first device.
            logger.info("Clariva key storage: no secret storage on the account; creating it");
            await createKeyStorage(client, crypto, passphrase);
            logger.info("Clariva key storage: created secret storage, cross-signing and key backup");
            return "created";
        }

        // ENABLED / INCOMPLETE: only ever unlock.
        return await unlockKeyStorage(client, crypto, passphrase, defaultKeyId, deps, signal);
    } catch (e) {
        logger.warn(`Clariva key storage: continuing without history access (${describe(e)})`);
        return "failed";
    } finally {
        clarivaSecretStorageKeys.clear();
    }
}

// ── create (first device) ──────────────────────────────────────────────────────────────────────────

async function createKeyStorage(client: KeyStorageClient, crypto: KeyStorageCrypto, passphrase: string): Promise<void> {
    const userId = client.getSafeUserId();

    // Cross-signing: create only when the account has none (the first upload needs no UIA, MSC3967).
    if (!(await crypto.userHasCrossSigningKeys(userId, true))) {
        await crypto.bootstrapCrossSigning({ setupNewCrossSigning: true });
    } else {
        const status = await crypto.getCrossSigningStatus();
        const local = status.privateKeysCachedLocally;
        if (!(local.masterKey && local.selfSigningKey && local.userSigningKey)) {
            // Another (lost) device owns the identity. Resetting it needs UIA with a Matrix password nobody has, so
            // history is set up without it; secret storage + backup are all that history needs.
            logger.warn(
                "Clariva key storage: the account has cross-signing keys this device does not hold; leaving them untouched",
            );
        }
    }

    // Secret storage protected by the server passphrase (PBKDF2 params are stored with the key description so every
    // other device, including Android's Rust SDK, derives the same key), plus a fresh key backup whose key is stored
    // in secret storage. `getSecretStorageKey` is answered from the silent key holder: no dialog can appear.
    const recoveryKey = await crypto.createRecoveryKeyFromPassphrase(passphrase);
    clarivaSecretStorageKeys.set(recoveryKey.privateKey);
    await crypto.bootstrapSecretStorage({
        createSecretStorageKey: async () => recoveryKey,
        setupNewSecretStorage: true,
        setupNewKeyBackup: true,
    });
}

// ── unlock (later devices) ─────────────────────────────────────────────────────────────────────────

async function unlockKeyStorage(
    client: KeyStorageClient,
    crypto: KeyStorageCrypto,
    passphrase: string,
    defaultKeyId: string,
    deps: KeyStorageDeps,
    signal: AbortSignal | undefined,
): Promise<KeyStorageOutcome> {
    const userId = client.getSafeUserId();
    const deviceId = client.getDeviceId();

    // Idempotence: nothing to do when this device already holds everything.
    const before = await crypto.getCrossSigningStatus();
    const localBefore = before.privateKeysCachedLocally;
    const haveLocalKeys = localBefore.masterKey && localBefore.selfSigningKey && localBefore.userSigningKey;
    if (haveLocalKeys && deviceId) {
        const trust = await crypto.getDeviceVerificationStatus(userId, deviceId);
        if (trust?.crossSigningVerified && (await crypto.getSessionBackupPrivateKey()) !== null) {
            logger.debug("Clariva key storage: this device is already unlocked");
            return "already-unlocked";
        }
    }

    const keyTuple = await client.secretStorage.getKey(defaultKeyId);
    if (!keyTuple) {
        logger.warn("Clariva key storage: the default secret-storage key is missing; not touching anything");
        return "unopenable";
    }
    const [keyId, keyInfo] = keyTuple;
    const passphraseInfo = keyInfo.passphrase;
    if (!passphraseInfo || passphraseInfo.algorithm !== "m.pbkdf2") {
        // Created without a passphrase (the old "Set up recovery" screen): cannot be opened with ours and cannot be
        // repaired from a client. Do NOT reset it.
        logger.warn("Clariva key storage: secret storage was created without a passphrase; cannot be opened here");
        return "unopenable";
    }

    const key = await deps.deriveKey(
        passphrase,
        passphraseInfo.salt,
        passphraseInfo.iterations,
        passphraseInfo.bits ?? 256,
    );
    if (!(await client.secretStorage.checkKey(key, keyInfo))) {
        key.fill(0);
        logger.warn(
            `Clariva key storage: the server passphrase does not open secret storage key ${keyId}; not resetting`,
        );
        return "unopenable";
    }
    if (signal?.aborted) {
        key.fill(0);
        return "aborted";
    }

    clarivaSecretStorageKeys.set(key); // answers SecurityManager.getSecretStorageKey without any dialog

    // 1. Cross-signing: import master/self/user keys from 4S and cross-sign this device. Only when the keys exist
    //    somewhere; otherwise bootstrapCrossSigning would generate NEW keys.
    const status = await crypto.getCrossSigningStatus();
    const local = status.privateKeysCachedLocally;
    if ((local.masterKey && local.selfSigningKey && local.userSigningKey) || status.privateKeysInSecretStorage) {
        await crypto.bootstrapCrossSigning({});
        if (deviceId) {
            const trust = await crypto.getDeviceVerificationStatus(userId, deviceId);
            if (trust && !trust.crossSigningVerified) {
                try {
                    await crypto.crossSignDevice(deviceId);
                } catch (e) {
                    logger.warn(`Clariva key storage: could not cross-sign this device (${describe(e)})`);
                }
            }
        }
    } else {
        logger.warn("Clariva key storage: no cross-signing keys on this device or in secret storage; leaving them");
    }
    if (signal?.aborted) return "aborted";

    // 2. Key backup: cache the backup key from 4S and enable backup. Room keys are fetched per session on demand.
    await loadBackupKey(client, crypto);

    logger.info("Clariva key storage: unlocked secret storage on this device");
    return "unlocked";
}

async function loadBackupKey(client: KeyStorageClient, crypto: KeyStorageCrypto): Promise<void> {
    const check = await crypto.checkKeyBackupAndEnable(); // null: no backup on the server
    const version = check?.backupInfo?.version;
    if (!check || !version) {
        logger.info("Clariva key storage: no key backup on the server");
        return;
    }
    if (!check.trustInfo.trusted) {
        logger.warn("Clariva key storage: the key backup is not trusted by this device; not loading its key");
        return;
    }
    if (check.trustInfo.matchesDecryptionKey) return; // the key is already cached

    const stored = await client.secretStorage.get("m.megolm_backup.v1");
    if (!stored) {
        logger.warn("Clariva key storage: the backup key is not in secret storage");
        return;
    }
    const backupKey = decodeBase64(stored);
    try {
        await crypto.storeSessionBackupPrivateKey(backupKey, version);
    } finally {
        backupKey.fill(0);
    }

    const after = await crypto.checkKeyBackupAndEnable();
    if (!after?.trustInfo.matchesDecryptionKey) {
        logger.warn("Clariva key storage: the backup key in secret storage does not match the current backup version");
    }
}

// ── module-level service ────────────────────────────────────────────────────────────────────────────

/**
 * Single-flight wrapper started by `Clariva.onSignedIn`. Lives outside React so a route change cannot cancel it.
 */
export class ClarivaKeyStorage {
    private static internalInstance: ClarivaKeyStorage | undefined;

    public static get instance(): ClarivaKeyStorage {
        if (!ClarivaKeyStorage.internalInstance) ClarivaKeyStorage.internalInstance = new ClarivaKeyStorage();
        return ClarivaKeyStorage.internalInstance;
    }

    public static resetForTests(): void {
        ClarivaKeyStorage.internalInstance?.stop();
        ClarivaKeyStorage.internalInstance = undefined;
    }

    private current: { client: KeyStorageClient; promise: Promise<KeyStorageOutcome>; abort: AbortController } | null =
        null;
    private lastOutcomeInternal: KeyStorageOutcome | null = null;

    private constructor() {}

    public get lastOutcome(): KeyStorageOutcome | null {
        return this.lastOutcomeInternal;
    }

    /**
     * Start (at most once per client) and return the settled outcome. A second call for the same client returns the
     * running attempt; a call for another client aborts the previous one first.
     */
    public start(
        client: KeyStorageClient,
        passphrase: string | null | undefined,
        deps?: Partial<KeyStorageDeps>,
    ): Promise<KeyStorageOutcome> {
        if (this.current?.client === client) return this.current.promise;
        this.stop();

        const abort = new AbortController();
        const promise = runKeyStorage(client, passphrase, { ...deps, signal: abort.signal }).then((outcome) => {
            if (this.current?.abort === abort) this.lastOutcomeInternal = outcome;
            return outcome;
        });
        this.current = { client, promise, abort };
        return promise;
    }

    /** Sign-out / account switch: abort, and make sure no key stays in memory. */
    public stop(): void {
        this.current?.abort.abort();
        this.current = null;
        this.lastOutcomeInternal = null;
        clarivaSecretStorageKeys.clear();
    }
}
