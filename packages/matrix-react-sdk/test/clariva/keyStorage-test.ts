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

import { EventEmitter } from "events";
import { ClientEvent, SyncState } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import {
    ClarivaKeyStorage,
    type KeyStorageClient,
    runKeyStorage,
    waitForInitialSync,
} from "../../src/clariva/session/keyStorage";
import { clarivaSecretStorageKeys } from "../../src/clariva/session/secretStorageKeys";

const PASSPHRASE = "s3cretPassphraseFromServer";
const KEY_ID = "KEYID";
const DERIVED = [9, 8, 7, 6];

interface Options {
    synced?: boolean;
    defaultKeyId?: string | null;
    keyInfo?: Record<string, unknown> | null;
    checkKey?: boolean;
    hasServerCrossSigning?: boolean;
    keysLocal?: boolean;
    keysInSecretStorage?: boolean;
    deviceCrossSigned?: boolean;
    backupKeyCached?: boolean;
    backup?: { version: string; trusted: boolean; matches: boolean } | null;
}

const PBKDF2_INFO = {
    algorithm: "m.secret_storage.v1.aes-hmac-sha2",
    iv: "iv",
    mac: "mac",
    passphrase: { algorithm: "m.pbkdf2", iterations: 1000, salt: "salty" },
};

function makeFakes(options: Options = {}) {
    const o: Required<Options> = {
        synced: true,
        defaultKeyId: KEY_ID,
        keyInfo: PBKDF2_INFO,
        checkKey: true,
        hasServerCrossSigning: true,
        keysLocal: false,
        keysInSecretStorage: true,
        deviceCrossSigned: false,
        backupKeyCached: false,
        backup: { version: "7", trusted: true, matches: false },
        ...options,
    };
    const holderDuring: Record<string, boolean> = {};
    const track = (name: string) => () => {
        holderDuring[name] = clarivaSecretStorageKeys.hasKey;
    };
    let backupStored = false;
    // jest keeps call arguments by reference and the service zeroes the key afterwards: copy it when called
    const storedBackupKeys: number[][] = [];

    const crypto = {
        userHasCrossSigningKeys: jest.fn(async () => o.hasServerCrossSigning),
        bootstrapCrossSigning: jest.fn(async () => track("bootstrapCrossSigning")()),
        bootstrapSecretStorage: jest.fn(async (opts: { createSecretStorageKey?: () => Promise<unknown> }) => {
            track("bootstrapSecretStorage")();
            await opts.createSecretStorageKey?.();
        }),
        createRecoveryKeyFromPassphrase: jest.fn(async () => ({
            privateKey: new Uint8Array([1, 2, 3]),
            keyInfo: { passphrase: { algorithm: "m.pbkdf2", iterations: 500000, salt: "x" } },
        })),
        getCrossSigningStatus: jest.fn(async () => ({
            publicKeysOnDevice: true,
            privateKeysInSecretStorage: o.keysInSecretStorage,
            privateKeysCachedLocally: {
                masterKey: o.keysLocal,
                selfSigningKey: o.keysLocal,
                userSigningKey: o.keysLocal,
            },
        })),
        getDeviceVerificationStatus: jest.fn(async () => ({ crossSigningVerified: o.deviceCrossSigned })),
        crossSignDevice: jest.fn(async () => {}),
        getSessionBackupPrivateKey: jest.fn(async () => (o.backupKeyCached ? new Uint8Array(32) : null)),
        storeSessionBackupPrivateKey: jest.fn(async (key: Uint8Array, _version?: string) => {
            storedBackupKeys.push(Array.from(key));
            backupStored = true;
        }),
        checkKeyBackupAndEnable: jest.fn(async () =>
            o.backup
                ? {
                      backupInfo: { version: o.backup.version },
                      trustInfo: { trusted: o.backup.trusted, matchesDecryptionKey: o.backup.matches || backupStored },
                  }
                : null,
        ),
    };

    const emitter = new EventEmitter();
    const client = {
        getSafeUserId: () => "@me:clarivahub.com",
        getDeviceId: () => "DEVICE",
        isInitialSyncComplete: jest.fn(() => o.synced),
        getCrypto: jest.fn(() => crypto),
        secretStorage: {
            getDefaultKeyId: jest.fn(async () => o.defaultKeyId),
            getKey: jest.fn(async () => (o.keyInfo ? [KEY_ID, o.keyInfo] : null)),
            checkKey: jest.fn(async () => o.checkKey),
            get: jest.fn(async () => Buffer.from(new Uint8Array(32).fill(7)).toString("base64")),
        },
        on: (event: string, handler: (...args: unknown[]) => void) => emitter.on(event, handler),
        removeListener: (event: string, handler: (...args: unknown[]) => void) =>
            emitter.removeListener(event, handler),
    };
    const deriveKey = jest.fn(async () => new Uint8Array(DERIVED));
    return {
        client: client as unknown as KeyStorageClient,
        rawClient: client,
        crypto,
        emitter,
        deriveKey,
        holderDuring,
        storedBackupKeys,
    };
}

describe("silent key storage (spec 01 §3.8 decision table)", () => {
    let logged: string[];

    beforeEach(() => {
        logged = [];
        for (const level of ["debug", "log", "info", "warn", "error"] as const) {
            jest.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
                logged.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
            });
        }
        clarivaSecretStorageKeys.clear();
        ClarivaKeyStorage.resetForTests();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        clarivaSecretStorageKeys.clear();
    });

    const run = (f: ReturnType<typeof makeFakes>, passphrase: string | null | undefined = PASSPHRASE) =>
        runKeyStorage(f.client, passphrase, { deriveKey: f.deriveKey, syncTimeoutMs: 50 });

    it("no passphrase: skip, log 'history unavailable', touch nothing", async () => {
        const f = makeFakes();
        expect(await run(f, null)).toBe("no-passphrase");
        expect(await run(f, "  ")).toBe("no-passphrase");
        expect(f.rawClient.getCrypto).not.toHaveBeenCalled();
        expect(logged.some((l) => l.includes("history unavailable"))).toBe(true);
    });

    it("first sync not done in time: abort without creating anything", async () => {
        const f = makeFakes({ synced: false, defaultKeyId: null });
        expect(await run(f)).toBe("sync-timeout");
        expect(f.rawClient.secretStorage.getDefaultKeyId).not.toHaveBeenCalled();
        expect(f.crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
        expect(f.crypto.bootstrapSecretStorage).not.toHaveBeenCalled();
    });

    it("waits for the first sync (PREPARED) before deciding", async () => {
        const f = makeFakes({ synced: false, defaultKeyId: null, hasServerCrossSigning: false });
        const promise = runKeyStorage(f.client, PASSPHRASE, { deriveKey: f.deriveKey, syncTimeoutMs: 5000 });
        await Promise.resolve();
        expect(f.rawClient.secretStorage.getDefaultKeyId).not.toHaveBeenCalled();
        f.emitter.emit(ClientEvent.Sync, SyncState.Prepared);
        expect(await promise).toBe("created");
    });

    it("DISABLED (no default key): creates cross-signing, secret storage and backup from the passphrase", async () => {
        const f = makeFakes({ defaultKeyId: null, hasServerCrossSigning: false });
        expect(await run(f)).toBe("created");

        expect(f.crypto.bootstrapCrossSigning).toHaveBeenCalledTimes(1);
        expect(f.crypto.bootstrapCrossSigning).toHaveBeenCalledWith({ setupNewCrossSigning: true });
        expect(f.crypto.createRecoveryKeyFromPassphrase).toHaveBeenCalledWith(PASSPHRASE);
        expect(f.crypto.bootstrapSecretStorage).toHaveBeenCalledWith(
            expect.objectContaining({ setupNewSecretStorage: true, setupNewKeyBackup: true }),
        );
        // the silent key answers getSecretStorageKey while it runs, and is gone afterwards
        expect(f.holderDuring.bootstrapSecretStorage).toBe(true);
        expect(clarivaSecretStorageKeys.hasKey).toBe(false);
    });

    it("DISABLED but cross-signing already exists on the account: never resets it", async () => {
        const f = makeFakes({ defaultKeyId: null, hasServerCrossSigning: true, keysLocal: false });
        expect(await run(f)).toBe("created");
        expect(f.crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
        expect(f.crypto.bootstrapSecretStorage).toHaveBeenCalledTimes(1);
    });

    it("ENABLED/INCOMPLETE: only unlocks (imports cross-signing + backup key), never creates or resets", async () => {
        const f = makeFakes();
        expect(await run(f)).toBe("unlocked");

        expect(f.deriveKey).toHaveBeenCalledWith(PASSPHRASE, "salty", 1000, 256);
        expect(f.rawClient.secretStorage.checkKey).toHaveBeenCalledTimes(1);
        // imports the cross-signing keys: `{}`, never `setupNewCrossSigning`
        expect(f.crypto.bootstrapCrossSigning).toHaveBeenCalledTimes(1);
        expect(f.crypto.bootstrapCrossSigning).toHaveBeenCalledWith({});
        expect(f.holderDuring.bootstrapCrossSigning).toBe(true);
        // backup key goes from 4S into the crypto store for the current backup version, then backup is enabled
        expect(f.crypto.storeSessionBackupPrivateKey).toHaveBeenCalledTimes(1);
        expect(f.crypto.storeSessionBackupPrivateKey.mock.calls[0][1]).toBe("7");
        expect(f.storedBackupKeys[0]).toEqual(new Array(32).fill(7));
        expect(f.crypto.checkKeyBackupAndEnable).toHaveBeenCalledTimes(2);
        // none of the destructive calls
        expect(f.crypto.bootstrapSecretStorage).not.toHaveBeenCalled();
        expect(f.crypto.createRecoveryKeyFromPassphrase).not.toHaveBeenCalled();
        expect(f.crypto.userHasCrossSigningKeys).not.toHaveBeenCalled();
        expect(clarivaSecretStorageKeys.hasKey).toBe(false);
    });

    it("cross-signs this device when importing did not trust it", async () => {
        const f = makeFakes({ deviceCrossSigned: false });
        await run(f);
        expect(f.crypto.crossSignDevice).toHaveBeenCalledWith("DEVICE");
        const g = makeFakes({ deviceCrossSigned: true });
        await run(g);
        expect(g.crypto.crossSignDevice).not.toHaveBeenCalled();
    });

    it("leaves cross-signing alone when its keys are neither on the device nor in secret storage", async () => {
        const f = makeFakes({ keysLocal: false, keysInSecretStorage: false });
        expect(await run(f)).toBe("unlocked");
        expect(f.crypto.bootstrapCrossSigning).not.toHaveBeenCalled(); // would generate NEW keys
    });

    it("does not load the backup key of an untrusted backup, nor when no backup exists", async () => {
        const untrusted = makeFakes({ backup: { version: "7", trusted: false, matches: false } });
        await run(untrusted);
        expect(untrusted.crypto.storeSessionBackupPrivateKey).not.toHaveBeenCalled();
        const none = makeFakes({ backup: null });
        await run(none);
        expect(none.crypto.storeSessionBackupPrivateKey).not.toHaveBeenCalled();
        const cached = makeFakes({ backup: { version: "7", trusted: true, matches: true } });
        await run(cached);
        expect(cached.crypto.storeSessionBackupPrivateKey).not.toHaveBeenCalled();
    });

    it("wrong passphrase: logs only, resets nothing", async () => {
        const f = makeFakes({ checkKey: false });
        expect(await run(f)).toBe("unopenable");
        expect(f.crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
        expect(f.crypto.bootstrapSecretStorage).not.toHaveBeenCalled();
        expect(f.crypto.storeSessionBackupPrivateKey).not.toHaveBeenCalled();
        expect(f.crypto.checkKeyBackupAndEnable).not.toHaveBeenCalled();
        expect(clarivaSecretStorageKeys.hasKey).toBe(false);
    });

    it("secret storage created without a passphrase: unopenable, resets nothing", async () => {
        const f = makeFakes({ keyInfo: { algorithm: "m.secret_storage.v1.aes-hmac-sha2", iv: "i", mac: "m" } });
        expect(await run(f)).toBe("unopenable");
        expect(f.deriveKey).not.toHaveBeenCalled();
        expect(f.crypto.bootstrapSecretStorage).not.toHaveBeenCalled();
    });

    it("a default key id whose description is missing is unopenable, not a reason to create", async () => {
        const f = makeFakes({ keyInfo: null });
        expect(await run(f)).toBe("unopenable");
        expect(f.crypto.bootstrapSecretStorage).not.toHaveBeenCalled();
    });

    it("skips when the device already holds everything", async () => {
        const f = makeFakes({ keysLocal: true, deviceCrossSigned: true, backupKeyCached: true });
        expect(await run(f)).toBe("already-unlocked");
        expect(f.deriveKey).not.toHaveBeenCalled();
    });

    it("never throws: failures are logged and swallowed", async () => {
        const f = makeFakes();
        f.rawClient.secretStorage.getDefaultKeyId.mockRejectedValueOnce(new Error("network down"));
        expect(await run(f)).toBe("failed");
        expect(logged.some((l) => l.includes("network down"))).toBe(true);

        const g = makeFakes({ defaultKeyId: null, hasServerCrossSigning: false });
        g.crypto.bootstrapSecretStorage.mockRejectedValueOnce(new Error("boom"));
        expect(await run(g)).toBe("failed");
        expect(clarivaSecretStorageKeys.hasKey).toBe(false); // the key never outlives a failed run
    });

    it("never logs the passphrase or any key material", async () => {
        for (const options of [{}, { defaultKeyId: null }, { checkKey: false }] as Options[]) {
            await run(makeFakes(options));
        }
        const all = logged.join("\n");
        expect(all).not.toContain(PASSPHRASE);
        expect(all).not.toContain(DERIVED.join(","));
        expect(all).not.toContain(Buffer.from(new Uint8Array(32).fill(7)).toString("base64"));
    });

    it("is single-flight per client, and stop() aborts a pending wait", async () => {
        const f = makeFakes({ synced: false });
        const service = ClarivaKeyStorage.instance;
        const first = service.start(f.client, PASSPHRASE, { deriveKey: f.deriveKey, syncTimeoutMs: 5000 });
        const second = service.start(f.client, PASSPHRASE, { deriveKey: f.deriveKey, syncTimeoutMs: 5000 });
        expect(second).toBe(first);
        service.stop();
        expect(await first).toBe("aborted");
        expect(f.rawClient.secretStorage.getDefaultKeyId).not.toHaveBeenCalled();
    });
});

describe("waitForInitialSync", () => {
    it("resolves true on SYNCING/PREPARED, false on timeout, and detaches its listener", async () => {
        const f = makeFakes({ synced: false });
        const spy = jest.spyOn(f.emitter, "removeListener");
        const pending = waitForInitialSync(f.client, 1000);
        f.emitter.emit(ClientEvent.Sync, SyncState.Error); // not ready
        f.emitter.emit(ClientEvent.Sync, SyncState.Syncing);
        expect(await pending).toBe(true);
        expect(spy).toHaveBeenCalled();
        expect(await waitForInitialSync(f.client, 10)).toBe(false);
    });
});

describe("SilentSecretStorageKeys", () => {
    it("only returns a key that the check accepts, and zeroes keys on clear", async () => {
        const good = new Uint8Array([1, 2, 3]);
        clarivaSecretStorageKeys.set(good);
        const info = { algorithm: "x", iv: "", mac: "" } as never;
        expect(await clarivaSecretStorageKeys.select({ K: info }, async () => true)).toEqual(["K", good]);
        expect(await clarivaSecretStorageKeys.select({ K: info }, async () => false)).toBeNull();
        expect(
            await clarivaSecretStorageKeys.select({ K: info }, async () => Promise.reject(new Error("x"))),
        ).toBeNull();
        clarivaSecretStorageKeys.clear();
        expect(Array.from(good)).toEqual([0, 0, 0]);
        expect(clarivaSecretStorageKeys.hasKey).toBe(false);
    });
});
