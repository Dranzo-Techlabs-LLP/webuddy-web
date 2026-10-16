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
 * Is the ringtone of a ringing call being held back by the browser's autoplay policy?
 *
 * The ringtone plays through a Web Audio `AudioContext` that Element creates at start-up, before the user has touched
 * the page; browsers keep such a context `suspended` until a user gesture resumes it, and `source.start()` on a
 * suspended context neither throws nor makes a sound. The runtime sets this flag while a ring is playing on a context
 * that is not running, and the ring toast shows a "click anywhere to enable call sound" hint while it is set.
 *
 * Kept as a tiny store of its own (no Matrix or React imports) so the toast does not pull in the call runtime.
 */

type Listener = () => void;

let blocked = false;
const listeners = new Set<Listener>();

export function isRingSoundBlocked(): boolean {
    return blocked;
}

export function setRingSoundBlocked(value: boolean): void {
    if (blocked === value) return;
    blocked = value;
    for (const listener of [...listeners]) listener();
}

/** Subscribe to changes of `isRingSoundBlocked()`. Returns the unsubscribe function. */
export function subscribeRingSoundBlocked(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
