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

import { type ClarivaPublicUser } from "../api/types";

/**
 * In-memory holder for the Clariva-side session data that must NEVER be persisted:
 *
 *  - the Clariva JWT (only needed to mint a Matrix session; Android also keeps it in memory only),
 *  - the public user returned by login/register/google (used to seed the role),
 *  - the server-derived secret-storage passphrase, which is consumed exactly once by the key-storage service.
 *
 * Nothing here touches localStorage/sessionStorage/IndexedDB on purpose (spec 01 §6.8).
 */
export class ClarivaSession {
    private static internalInstance: ClarivaSession | undefined;

    public static get instance(): ClarivaSession {
        if (!ClarivaSession.internalInstance) ClarivaSession.internalInstance = new ClarivaSession();
        return ClarivaSession.internalInstance;
    }

    public static resetForTests(): void {
        ClarivaSession.internalInstance = undefined;
    }

    private jwtInternal: string | null = null;
    private userInternal: ClarivaPublicUser | null = null;
    private passphraseInternal: string | null = null;

    private constructor() {}

    public setAuthenticated(jwt: string, user: ClarivaPublicUser): void {
        this.jwtInternal = jwt;
        this.userInternal = user;
    }

    public get jwt(): string | null {
        return this.jwtInternal;
    }

    public get user(): ClarivaPublicUser | null {
        return this.userInternal;
    }

    /** Role from the login response: `true`/`false`, or `null` when the server did not say. */
    public get isConsultantHint(): boolean | null {
        const flag = this.userInternal?.isConsultant;
        return flag === 1 ? true : flag === 0 ? false : null;
    }

    /** Keep the passphrase only until the key-storage service has used it. */
    public setRecoveryPassphrase(passphrase: string | null | undefined): void {
        this.passphraseInternal = passphrase?.trim() ? passphrase : null;
    }

    /** Returns the passphrase and forgets it (single use). */
    public takeRecoveryPassphrase(): string | null {
        const value = this.passphraseInternal;
        this.passphraseInternal = null;
        return value;
    }

    /** The JWT has done its job (it is only needed to mint the Matrix session): drop it as early as possible. */
    public dropJwt(): void {
        this.jwtInternal = null;
    }

    public clear(): void {
        this.jwtInternal = null;
        this.userInternal = null;
        this.passphraseInternal = null;
    }
}
