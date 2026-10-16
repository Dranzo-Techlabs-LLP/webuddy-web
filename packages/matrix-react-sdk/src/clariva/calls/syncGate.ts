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

import { SyncState } from "matrix-js-sdk/src/matrix";

/**
 * Should timeline events be treated as live right now, judging by the client's sync state?
 *
 * js-sdk emits a new sync state only AFTER it has processed the response, so the events of a response are always
 * handled while the PREVIOUS state is still current. A gate that only opens on `Syncing` therefore drops everything in
 * the first response after `Prepared` and after `Reconnecting` / `Catchup`, which is exactly where a ring that arrived
 * during a network hiccup or right after a page load sits. The gate is therefore closed only when we know nothing is
 * being delivered live:
 *
 *  - before the first `Prepared` / `Syncing`: the initial load (the cache replay is processed BEFORE js-sdk emits
 *    `Prepared`, and its events are flagged `liveEvent: false` anyway),
 *  - on `Stopped`: the client is shut down.
 *
 * `Error` does NOT close it, unlike `Notifier`: the response that recovers from an error (the one with the ring that
 * arrived while the connection was bad) is processed while the state is still `Error`, so closing on it would drop
 * exactly that ring. History cannot sneak in through it, see below.
 *
 * It is never the only guard: callers still require `liveEvent`, and `parseRtcNotification` drops a ring older than its
 * lifetime, so a gate that stays open cannot make history ring.
 */
export function nextSyncGate(open: boolean, state: SyncState | null | undefined): boolean {
    switch (state) {
        case SyncState.Syncing:
        case SyncState.Prepared:
        case SyncState.Catchup:
        case SyncState.Reconnecting:
            return true;
        case SyncState.Stopped:
            return false;
        default:
            // `Error` (see above), `null` (nothing yet) and anything unknown: no change
            return open;
    }
}
