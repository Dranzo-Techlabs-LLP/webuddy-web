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
import { CryptoEvent } from "matrix-js-sdk/src/crypto";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

/**
 * Tracks how many room keys are still waiting to be backed up, so the sign-out dialog can show Android's
 * "Your keys are still being backed up" variant (spec 01 §2.7). js-sdk 34.4 has no "how many are left" query, only
 * the `KeyBackupSessionsRemaining` event emitted by the upload loop, so this listens for it from sign-in on.
 *
 * `remaining === null` means "unknown / nothing reported": the dialog then shows the plain sign-out copy.
 */
export class ClarivaBackupProgress extends EventEmitter {
    private static internalInstance: ClarivaBackupProgress | undefined;

    public static get instance(): ClarivaBackupProgress {
        if (!ClarivaBackupProgress.internalInstance)
            ClarivaBackupProgress.internalInstance = new ClarivaBackupProgress();
        return ClarivaBackupProgress.internalInstance;
    }

    public static resetForTests(): void {
        ClarivaBackupProgress.internalInstance?.detach();
        ClarivaBackupProgress.internalInstance = undefined;
    }

    public static readonly UPDATE = "update";

    private client: MatrixClient | null = null;
    private remainingInternal: number | null = null;

    /** Keys still to upload, or `null` when unknown. */
    public get remaining(): number | null {
        return this.remainingInternal;
    }

    public get isUploading(): boolean {
        return this.remainingInternal !== null && this.remainingInternal > 0;
    }

    public attach(client: MatrixClient): void {
        if (this.client === client) return;
        this.detach();
        this.client = client;
        client.on(CryptoEvent.KeyBackupSessionsRemaining, this.onRemaining);
        client.on(CryptoEvent.KeyBackupStatus, this.onStatus);
    }

    public detach(): void {
        if (this.client) {
            this.client.removeListener(CryptoEvent.KeyBackupSessionsRemaining, this.onRemaining);
            this.client.removeListener(CryptoEvent.KeyBackupStatus, this.onStatus);
        }
        this.client = null;
        this.set(null);
    }

    private set(value: number | null): void {
        if (this.remainingInternal === value) return;
        this.remainingInternal = value;
        this.emit(ClarivaBackupProgress.UPDATE);
    }

    private onRemaining = (remaining: number): void => this.set(remaining);

    private onStatus = (enabled: boolean): void => {
        if (!enabled) this.set(null);
    };
}
