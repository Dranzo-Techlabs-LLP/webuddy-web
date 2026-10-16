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

import { declinedRingId } from "./ring";

/**
 * Caller-side "decline cuts the DM call for both sides" (Android `fc38a7a6a0`, spec 04 §3.10 / §6.8).
 *
 * Element Call 0.16.3 already leaves the call by itself when the peer declines (`CallViewModel.ring$`), once the
 * decline event reaches its widget client. This is the host's safety net, with the lessons of the Android version:
 *
 *  - Identify THIS call's ring by its id, never by a time window: a decline can only hang up a ring that is among my
 *    own `rtc.notification` events AND was not already there when the call started (`baseline`). A stale decline of an
 *    earlier call refers to a baseline ring and must not end the fresh call.
 *  - Ignore declines I sent myself (echo from another device of mine).
 *  - Only for 1:1 calls: the caller of this module only creates a watcher for DMs (a group call survives a decline).
 */

export interface DeclineDecisionInput {
    /** The ring event id the decline refers to (`m.relates_to.event_id`), `null` if the decline is malformed. */
    declinedRingId: string | null;
    declinerId: string;
    myUserId: string;
    /** Ids of my own ring events that existed when the call started. */
    baseline: ReadonlySet<string>;
    /** Ids of my own ring events in the live timeline right now (real event ids, no local echoes). */
    ownRingIds: ReadonlySet<string>;
}

/** Should this decline hang up the call this watcher belongs to? */
export function peerDeclinedThisCall(input: DeclineDecisionInput): boolean {
    const { declinedRingId: ringId, declinerId, myUserId, baseline, ownRingIds } = input;
    if (!ringId || declinerId === myUserId) return false;
    if (baseline.has(ringId)) return false; // a stale ring from an earlier call
    return ownRingIds.has(ringId);
}

export interface DeclineWatcherHost {
    myUserId(): string;
    /** My own `rtc.notification` event ids in the room's live timeline right now. */
    ownRingIds(): Set<string>;
    /** Hang up the call (the caller applies its own grace period for EC's native handling first). */
    hangUp(): void;
}

export class CallerDeclineWatcher {
    private readonly baseline: ReadonlySet<string>;
    private triggered = false;
    private stopped = false;

    /** Snapshots the baseline: construct it at the moment the call is started, before EC can send the ring. */
    public constructor(private readonly host: DeclineWatcherHost) {
        this.baseline = new Set(host.ownRingIds());
    }

    public get hasTriggered(): boolean {
        return this.triggered;
    }

    /** Feed every `org.matrix.msc4310.rtc.decline` of the room. */
    public onDecline(declinerId: string, content: unknown): void {
        if (this.triggered || this.stopped) return;
        const decide = peerDeclinedThisCall({
            declinedRingId: declinedRingId(content),
            declinerId,
            myUserId: this.host.myUserId(),
            baseline: this.baseline,
            ownRingIds: this.host.ownRingIds(),
        });
        if (!decide) return;
        this.triggered = true;
        this.host.hangUp();
    }

    public stop(): void {
        this.stopped = true;
    }
}
