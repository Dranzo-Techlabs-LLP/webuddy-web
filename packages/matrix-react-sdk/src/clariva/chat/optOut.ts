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

import { type BillingOptOut } from "./billing";

/**
 * "Never remind me again for this consultant" (spec 03 U2): the set of consultant Matrix IDs for which the
 * "Start a new session?" dialog is skipped. Android keeps it in a per-session DataStore string set; the web keeps it in
 * `localStorage`, keyed by the OWN Matrix ID so two accounts in one browser do not share it. Device-local, never
 * synced, no secrets. Every storage access is wrapped: storage can be unavailable (private mode, blocked, quota).
 */
export const OPT_OUT_STORAGE_PREFIX = "mx_clariva_newsession_optout_";

const storageKey = (me: string): string => `${OPT_OUT_STORAGE_PREFIX}${me}`;

function read(me: string): string[] {
    try {
        const raw = window.localStorage.getItem(storageKey(me));
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch (e) {
        logger.debug("Clariva: could not read the new-session opt-out list", e);
        return [];
    }
}

export const localStorageOptOut: BillingOptOut = {
    isOptedOut(me: string, peerId: string): boolean {
        return read(me).includes(peerId);
    },

    optOut(me: string, peerId: string): void {
        try {
            const list = read(me);
            if (list.includes(peerId)) return;
            window.localStorage.setItem(storageKey(me), JSON.stringify([...list, peerId]));
        } catch (e) {
            logger.debug("Clariva: could not persist the new-session opt-out", e);
        }
    },
};
