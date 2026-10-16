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

import { TypedEventEmitter } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { RING_MEMBERSHIP_WAIT_MS } from "./constants";
import { type CallMediaType, mediaTypeForRing } from "./intent";
import { type LiveMembership, isUserAnsweringRing, isUserInCall } from "./memberships";
import { type ParsedRing, type RtcNotificationInput, parseRtcNotification } from "./ring";

/**
 * The ring lifecycle of an incoming 1:1 call (port of Android's `ActiveCallManager` + `CallNotificationEventResolver`,
 * spec 04 §3.8 / §3.9 / §6.7), with every outside effect behind `IncomingCallsHost` so the state machine can be tested
 * with fakes and fake timers:
 *
 *     handleRing --(DM, not mine, not expired, caller really in a call)--> ringing
 *                --(caller never seen in the call within 3 s)-----------> missed-call trace, no ring
 *     ringing --> accepted | rejected                       (the user)
 *             --> expired                                    (lifetime over: missed)
 *             --> cancelled-by-caller                        (caller's membership vanished: missed)
 *             --> answered-elsewhere | declined-elsewhere    (another device of mine: silent)
 *             --> joined-locally                             (I joined this call from this tab: silent)
 *
 * "Another device of mine answered" means a LIVE membership of mine created at or after the ring (see
 * `isUserAnsweringRing`): a membership a crashed tab left behind predates the ring and must not silence it.
 *
 * Expiry is decided on timestamps (`ParsedRing.expiresAt`), with a timer only as the wake-up call: background tabs
 * throttle timers, so `checkExpiry()` is also run when the tab becomes visible again.
 */

export type RingEndReason =
    | "accepted"
    | "rejected"
    | "expired"
    | "cancelled-by-caller"
    | "answered-elsewhere"
    | "declined-elsewhere"
    | "joined-locally"
    | "stopped";

/** Reasons that leave a "missed call" behind (Android posts the "Incoming call" notification for these). */
const MISSED_REASONS: ReadonlySet<RingEndReason> = new Set(["expired", "cancelled-by-caller"]);

export interface ActiveRing {
    ringEventId: string;
    roomId: string;
    senderId: string;
    mediaType: CallMediaType;
    /** Local time (ms) at which the ring is over. */
    expiresAt: number;
}

export interface IncomingCallsHost {
    now(): number;
    myUserId(): string;
    /** The peer of the room if it is a 1:1 chat, else `null` (groups never ring: spec 04 §6.7). */
    dmPeerOf(roomId: string): string | null;
    /** Live call memberships of the room right now. */
    liveMemberships(roomId: string): LiveMembership[];
    /** Resolves to whether `userId` has a live membership in `roomId`, waiting up to `timeoutMs` for it to appear. */
    waitForMembership(roomId: string, userId: string, timeoutMs: number): Promise<boolean>;
    /** `GET /v1/calls/type` (2 s bounded, never rejects). */
    fetchCallType(roomId: string): Promise<CallMediaType | null>;
    /** Is a call already connected on this device (any room)? Android: no second ring, a missed-call entry instead. */
    isBusy(): boolean;
    /** Send `org.matrix.msc4310.rtc.decline` for the ring. */
    sendDecline(roomId: string, ringEventId: string): Promise<void>;
    /** Start the call (`join_existing_dm[_voice]`) for an accepted ring. Rejects when the call could not be opened. */
    joinCall(roomId: string, mediaType: CallMediaType): Promise<void>;
    // UI side effects
    showRing(ring: ActiveRing): void;
    hideRing(ring: ActiveRing, reason: RingEndReason): void;
    startRingtone(): void;
    stopRingtone(): void;
    notifyMissed(ring: ActiveRing | { roomId: string; senderId: string }): void;
    /** The user accepted `ring` but `joinCall` failed: tell them (error toast) and leave them a way to retry. */
    joinFailed(ring: ActiveRing): void;
}

export enum IncomingCallsEvent {
    /** The set of ringing calls changed. */
    Update = "Clariva.IncomingCalls.update",
}

type EmittedEvents = IncomingCallsEvent;
type EventHandlerMap = { [IncomingCallsEvent.Update]: (rings: readonly ActiveRing[]) => void };

interface Entry {
    ring: ActiveRing | null; // null while the media type is being resolved
    parsed: ParsedRing;
    /** `origin_server_ts` of the ring event: an own membership older than this cannot be an answer to it. */
    ringTs: number;
    timer: ReturnType<typeof setTimeout> | undefined;
    ended: RingEndReason | undefined;
}

/** How many handled ring ids to remember so a re-delivered event (decryption retry, backfill) cannot ring twice. */
const HANDLED_CAP = 200;

export class IncomingCallsManager extends TypedEventEmitter<EmittedEvents, EventHandlerMap> {
    private readonly entries = new Map<string, Entry>();
    /** Ring event ids already handled. */
    private readonly handled: string[] = [];
    /** `room|membership event id` of the calls already handled: a second ring event for the same call never rings. */
    private readonly handledCalls: string[] = [];

    public constructor(private readonly host: IncomingCallsHost) {
        super();
    }

    /** The rings currently ringing, oldest first. */
    public get rings(): readonly ActiveRing[] {
        return [...this.entries.values()].flatMap((e) => (e.ring && !e.ended ? [e.ring] : []));
    }

    public getRing(ringEventId: string): ActiveRing | undefined {
        const entry = this.entries.get(ringEventId);
        return entry && !entry.ended ? (entry.ring ?? undefined) : undefined;
    }

    /**
     * A live `org.matrix.msc4075.rtc.notification` arrived (already decrypted). Resolves to the ring when the user is
     * now being rung for it, `null` when it was ignored. Never rejects.
     */
    public async handleRing(input: RtcNotificationInput): Promise<ActiveRing | null> {
        try {
            return await this.handleRingUnsafe(input);
        } catch (e) {
            logger.warn("Clariva calls: failed to handle a ring", e);
            const entry = this.entries.get(input.eventId);
            if (entry && !entry.ring) this.entries.delete(input.eventId); // never leave a half-registered ring behind
            return null;
        }
    }

    private async handleRingUnsafe(input: RtcNotificationInput): Promise<ActiveRing | null> {
        const { host } = this;
        if (input.sender === host.myUserId()) return null; // my own ring (another device of mine started the call)
        if (this.entries.has(input.eventId) || this.handled.includes(input.eventId)) return null;

        const parsed = parseRtcNotification(input, host.now());
        if (!parsed) return null; // not a ring, no lifetime, or already over
        const peer = host.dmPeerOf(input.roomId);
        if (!peer) return null; // groups never ring

        // One call, one ring: a second ring event that points at the same caller membership is the same call.
        const callKey = parsed.membershipEventId ? `${input.roomId}|${parsed.membershipEventId}` : null;
        if (callKey && this.handledCalls.includes(callKey)) {
            this.remember(input.eventId, null);
            return null;
        }
        this.remember(input.eventId, callKey);

        if (host.isBusy()) {
            // Android: a ring while a call is active is a missed-call entry, never a second ring.
            host.notifyMissed({ roomId: input.roomId, senderId: input.sender });
            return null;
        }

        // From here on, signals (decline on another device, caller gave up...) must be able to end this ring even
        // though it is not shown yet, so register it first.
        const entry: Entry = { ring: null, parsed, ringTs: input.originTs, timer: undefined, ended: undefined };
        this.entries.set(input.eventId, entry);

        // 1. The caller must really be in a call (Android waits up to 3 s for `hasRoomCall`; a ring for a call that
        //    already ended must not ring).
        const callerThere = await host.waitForMembership(input.roomId, input.sender, RING_MEMBERSHIP_WAIT_MS);
        if (entry.ended) return null;
        if (!callerThere) {
            // Not ringing, but not invisible either: the call was started and the user did not get to answer it.
            logger.info(`Clariva calls: ring ${input.eventId} not shown: ${input.sender} is not in a call`);
            this.entries.delete(input.eventId);
            host.notifyMissed({ roomId: input.roomId, senderId: input.sender });
            return null;
        }
        if (this.answeredByMe(entry, host.liveMemberships(input.roomId))) {
            this.entries.delete(input.eventId); // I am already in it (another device answered)
            return null;
        }

        // 2. The media type: the caller's EC says (m.call.intent), else the Wallet record, else voice.
        const api = parsed.wireMedia ? null : await host.fetchCallType(input.roomId);
        if (entry.ended) return null;
        const mediaType = mediaTypeForRing(parsed.wireMedia, api);
        if (!isUserInCall(host.liveMemberships(input.roomId), input.sender)) {
            // the caller gave up while we were asking the Wallet-API
            this.entries.delete(input.eventId);
            host.notifyMissed({ roomId: input.roomId, senderId: input.sender });
            return null;
        }

        // The awaits above took time: re-evaluate the expiry.
        const now = host.now();
        const remainingMs = parsed.expiresAt - now;
        if (remainingMs <= 0) {
            this.entries.delete(input.eventId);
            host.notifyMissed({ roomId: input.roomId, senderId: input.sender });
            return null;
        }

        const ring: ActiveRing = {
            ringEventId: input.eventId,
            roomId: input.roomId,
            senderId: input.sender,
            mediaType,
            expiresAt: parsed.expiresAt,
        };
        entry.ring = ring;
        entry.timer = setTimeout(() => this.checkExpiry(), remainingMs);
        host.startRingtone();
        host.showRing(ring);
        this.emitUpdate();
        return ring;
    }

    /** End every ring whose time is up. Called by the timers and when the tab becomes visible again. */
    public checkExpiry(): void {
        const now = this.host.now();
        for (const [id, entry] of [...this.entries]) {
            if (entry.ring && !entry.ended && entry.ring.expiresAt <= now) this.end(id, "expired");
        }
    }

    /** Room call state changed: the caller gave up, or one of my other devices joined. */
    public onRoomStateChanged(roomId: string): void {
        const memberships = this.host.liveMemberships(roomId);
        for (const [id, entry] of [...this.entries]) {
            const ring = entry.ring;
            if (!ring || entry.ended || ring.roomId !== roomId) continue;
            if (this.answeredByMe(entry, memberships)) this.end(id, "answered-elsewhere");
            else if (!isUserInCall(memberships, ring.senderId)) this.end(id, "cancelled-by-caller");
        }
    }

    /** Did another device of mine answer this ring (a live membership of mine created at/after the ring)? */
    private answeredByMe(entry: Entry, memberships: readonly LiveMembership[]): boolean {
        return isUserAnsweringRing(memberships, this.host.myUserId(), entry.ringTs, this.host.now());
    }

    /** A decline event for `ringEventId` was sent by `declinerId`. Only my own other devices matter. */
    public onDecline(ringEventId: string, declinerId: string): void {
        if (declinerId === this.host.myUserId() && this.entries.has(ringEventId)) {
            this.end(ringEventId, "declined-elsewhere");
        }
    }

    /** This tab connected to a call in `roomId`: stop ringing for it. */
    public onLocalCallConnected(roomId: string): void {
        for (const [id, entry] of [...this.entries]) {
            if (entry.ring && !entry.ended && entry.ring.roomId === roomId) this.end(id, "joined-locally");
        }
    }

    /** The user pressed Accept. */
    public async accept(ringEventId: string): Promise<void> {
        const ring = this.getRing(ringEventId);
        if (!ring) return;
        this.end(ringEventId, "accepted");
        try {
            await this.host.joinCall(ring.roomId, ring.mediaType);
        } catch (e) {
            logger.warn("Clariva calls: could not join the accepted call", e);
            try {
                this.host.joinFailed(ring);
            } catch (e2) {
                logger.warn("Clariva calls: could not report the failed join", e2);
            }
        }
    }

    /** The user pressed Reject: stop ringing and tell the caller (and my other devices). */
    public async reject(ringEventId: string): Promise<void> {
        const ring = this.getRing(ringEventId);
        if (!ring) return;
        this.end(ringEventId, "rejected");
        try {
            await this.host.sendDecline(ring.roomId, ring.ringEventId);
        } catch (e) {
            logger.warn("Clariva calls: could not send the decline", e);
        }
    }

    /** Sign-out / client stop: silence everything. */
    public stop(): void {
        for (const id of [...this.entries.keys()]) this.end(id, "stopped");
    }

    private end(ringEventId: string, reason: RingEndReason): void {
        const entry = this.entries.get(ringEventId);
        if (!entry || entry.ended) return;
        entry.ended = reason;
        if (entry.timer !== undefined) clearTimeout(entry.timer);
        this.entries.delete(ringEventId);
        const { ring } = entry;
        if (ring) {
            this.host.hideRing(ring, reason);
            if (MISSED_REASONS.has(reason)) this.host.notifyMissed(ring);
        }
        if (this.rings.length === 0) this.host.stopRingtone();
        this.emitUpdate();
    }

    private emitUpdate(): void {
        this.emit(IncomingCallsEvent.Update, this.rings);
    }

    private remember(id: string, callKey: string | null): void {
        this.handled.push(id);
        if (this.handled.length > HANDLED_CAP) this.handled.shift();
        if (callKey && !this.handledCalls.includes(callKey)) {
            this.handledCalls.push(callKey);
            if (this.handledCalls.length > HANDLED_CAP) this.handledCalls.shift();
        }
    }
}
