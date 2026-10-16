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

import { type SecretStorage } from "matrix-js-sdk/src/matrix";

/**
 * In-memory holder for the secret-storage private key while the silent key-storage service runs
 * (src/clariva/session/keyStorage.ts). `SecurityManager.getSecretStorageKey` asks it for a key *instead of opening
 * Element's "Security Phrase" dialog. The key only lives for the duration of one unlock/creation and is zeroed
 * afterwards; it is never logged or persisted.
 *
 * This is a leaf module (no heavy imports) so `SecurityManager` can use it without import cycles.
 */
export class SilentSecretStorageKeys {
    private keys: Uint8Array[] = [];

    /** Make `key` available to the secret-storage callbacks (replaces any previous key). */
    public set(key: Uint8Array): void {
        this.clear();
        this.keys = [key];
    }

    /** Forget (and zero) every key. Safe to call repeatedly. */
    public clear(): void {
        for (const key of this.keys) key.fill(0);
        this.keys = [];
    }

    public get hasKey(): boolean {
        return this.keys.length > 0;
    }

    /**
     * Pick the held key that opens one of `keyInfos` (the candidate keys the SDK offers: `{ [keyId]: description }`).
     * `check` verifies a key against a description (`ServerSideSecretStorage.checkKey`: a MAC over a zero block), so a
     * wrong key can never be returned. Returns `null` when nothing matches; the caller must then fail, not prompt.
     */
    public async select(
        keyInfos: Record<string, SecretStorage.SecretStorageKeyDescription>,
        check: (key: Uint8Array, info: SecretStorage.SecretStorageKeyDescription) => Promise<boolean>,
    ): Promise<[string, Uint8Array] | null> {
        for (const [keyId, info] of Object.entries(keyInfos)) {
            for (const key of this.keys) {
                try {
                    if (await check(key, info)) return [keyId, key];
                } catch {
                    // an unsupported algorithm is simply not a match
                }
            }
        }
        return null;
    }
}

/** The one shared instance used by SecurityManager and ClarivaKeyStorage. */
export const clarivaSecretStorageKeys = new SilentSecretStorageKeys();
