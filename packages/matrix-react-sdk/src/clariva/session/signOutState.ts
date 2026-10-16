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

/**
 * Tiny in-memory state shared between the sign-out/deactivation code and the landing page:
 *
 *  - `markDeliberateSignOut()`: set right before a deactivation (and cleared by `onSignedOut`) so the "You’re signed
 *    out" dialog is not shown when the server invalidates the token we just killed ourselves.
 *  - a one-shot notice for the landing page (e.g. "Your account has been deactivated.").
 */

let deliberateSignOut = false;
let pendingNotice: string | null = null;

export function markDeliberateSignOut(): void {
    deliberateSignOut = true;
}

export function isDeliberateSignOut(): boolean {
    return deliberateSignOut;
}

export function clearDeliberateSignOut(): void {
    deliberateSignOut = false;
}

export function setLandingNotice(notice: string): void {
    pendingNotice = notice;
}

/** Returns the notice once, then forgets it. */
export function takeLandingNotice(): string | null {
    const notice = pendingNotice;
    pendingNotice = null;
    return notice;
}
