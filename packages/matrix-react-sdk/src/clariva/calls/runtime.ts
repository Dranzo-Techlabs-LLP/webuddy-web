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

import {
    ClientEvent,
    type IRoomTimelineData,
    type MatrixClient,
    type MatrixEvent,
    MatrixEventEvent,
    type Room,
    RoomEvent,
    RoomStateEvent,
    type SyncState,
    type TimelineEvents,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";
import { KnownMembership } from "matrix-js-sdk/src/types";

import { ElementCall } from "../../models/Call";
import { CallStore, CallStoreEvent } from "../../stores/CallStore";
import ToastStore from "../../stores/ToastStore";
import defaultDispatcher from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import { type ViewRoomPayload } from "../../dispatcher/payloads/ViewRoomPayload";
import LegacyCallHandler, { AudioID } from "../../LegacyCallHandler";
import GenericToast from "../../components/views/toasts/GenericToast";
import { WalletStore } from "../stores/WalletStore";
import { safeCallDmPeerId } from "../chat/useChatGate";
import { callsStrings, incomingCallLabel, incomingCallTitlePrefix } from "../strings/calls";
import { ClarivaIncomingCallToast, incomingCallToastKey } from "../components/calls/ClarivaIncomingCallToast";
import { CallBillingWatcher } from "./billingWatcher";
import { billPeerAnsweredForSession } from "./callBilling";
import { setRingSoundBlocked } from "./callAudio";
import { fetchCallType, recordCallType } from "./callType";
import { applyClarivaCallsDefaults, isClarivaCallsEnabled } from "./config";
import {
    CALL_MEMBER_EVENT_TYPE,
    HANGUP_GRACE_MS,
    JOIN_FAILED_TOAST_PRIORITY,
    RING_CAP_MS,
    RING_TOAST_PRIORITY,
    RTC_DECLINE_EVENT_TYPE,
    RTC_NOTIFICATION_EVENT_TYPE,
    BILLING_ANSWER_WINDOW_MS,
    SOUND_HINT_RECHECK_MS,
} from "./constants";
import { CallerDeclineWatcher } from "./declineWatcher";
import { closeCallNotification, showCallNotification } from "./desktopNotify";
import { type ActiveRing, IncomingCallsManager, type IncomingCallsHost, type RingEndReason } from "./incomingCalls";
import { type ElementCallIntent, intentSkipsLobby } from "./intent";
import {
    callMediaTypeOf,
    getRoomLiveMemberships,
    hasUserJoinedSince,
    isUserInCall,
    roomHasLiveCall,
} from "./memberships";
import { type JoinOptions, type OutgoingHost, joinDmCall, startDmCall } from "./outgoing";
import { setIncomingCalls } from "./registry";
import { declinedRingId } from "./ring";
import { nextSyncGate } from "./syncGate";
import { TitleFlasher } from "./titleFlash";

/**
 * The long-lived part of Clariva calls: one instance per signed-in session, started from `Notifier.start()` and
 * stopped from `Notifier.stop()`. It owns what must survive the chat view being closed — the billing watchers, the
 * caller-side decline safety net, and the incoming-ring service (client events -> `IncomingCallsManager` -> toast,
 * ringtone, flashing page title, browser notification).
 */

const ringTag = (ringEventId: string): string => `clariva_ring_${ringEventId}`;
const missedTag = (roomId: string): string => `clariva_missed_${roomId}`;
const joinFailedToastKey = (roomId: string): string => `clariva_call_join_failed_${roomId}`;

/** How long an encrypted event is held back for its keys: a ring is over after `RING_CAP_MS` whatever its keys say. */
const PARKED_DECRYPT_MS = RING_CAP_MS;

/**
 * Input that lets the browser start audio ("user activation"): the first of these on the page resumes the ringtone's
 * `AudioContext`. `pointerup` is there for touch, where `pointerdown` does not count as a gesture.
 */
const AUDIO_GESTURE_EVENTS = ["pointerdown", "pointerup", "keydown"] as const;

/**
 * Could `room` be a 1:1 chat? Joined, with at most two ACTIVE members. This is only the cheap pre-filter for parking
 * encrypted events; whether it really is a DM is decided (with `safeCallDmPeerId`) after decryption, when it matters.
 */
function mayBeDmRoom(room: Room): boolean {
    return room.getMyMembership() === KnownMembership.Join && room.getInvitedAndJoinedMemberCount() <= 2;
}

class ClarivaCallsRuntime {
    private client: MatrixClient | null = null;
    private incoming: IncomingCallsManager | null = null;
    /** May timeline events be live right now? See `nextSyncGate`. */
    private syncing = false;
    /** Encrypted events waiting for their decryption (rooms that may be 1:1 chats), id -> when to stop waiting. */
    private readonly pendingDecrypt = new Map<string, number>();
    /** Event ids already routed, so Timeline + Decrypted (+ local echo) cannot process an event twice. */
    private readonly routed: string[] = [];
    private readonly billing = new Map<string, CallBillingWatcher>();
    private readonly declineWatchers = new Map<
        string,
        { watcher: CallerDeclineWatcher; timer: ReturnType<typeof setTimeout> }
    >();
    private readonly roomStateListeners = new Map<string, Set<() => void>>();
    private ringtonePlaying = false;
    private readonly titleFlash = new TitleFlasher(incomingCallTitlePrefix);
    private audioUnlockArmed = false;
    /** The late re-check of the "click anywhere" hint, see `startRingtone`. */
    private soundHintTimer: ReturnType<typeof setTimeout> | undefined;
    /** Unsubscribes from the ringtone context's state changes while a ring plays. */
    private unwatchAudioState: (() => void) | undefined;
    /** Rooms with a "couldn't join" toast up. */
    private readonly joinFailedRooms = new Set<string>();

    public get started(): boolean {
        return this.client !== null;
    }

    public get incomingCalls(): IncomingCallsManager | null {
        return this.incoming;
    }

    // ── lifecycle ───────────────────────────────────────────────────────────

    /** Start for the signed-in `client`. Idempotent for the same client. A no-op unless Clariva calls are enabled. */
    public start(client: MatrixClient): void {
        if (!isClarivaCallsEnabled()) return;
        if (this.client === client) return;
        this.stop();
        try {
            applyClarivaCallsDefaults();
            this.client = client;
            this.syncing = nextSyncGate(false, client.getSyncState());
            this.incoming = new IncomingCallsManager(this.makeIncomingHost(client));
            setIncomingCalls(this.incoming);

            client.on(ClientEvent.Sync, this.onSync);
            client.on(RoomEvent.Timeline, this.onTimeline);
            client.on(MatrixEventEvent.Decrypted, this.onDecrypted);
            client.on(RoomStateEvent.Events, this.onStateEvent);
            CallStore.instance.on(CallStoreEvent.ConnectedCalls, this.onConnectedCalls);
            document.addEventListener("visibilitychange", this.onVisibility);
            this.armAudioUnlock();
            logger.info("Clariva calls: started");
        } catch (e) {
            // calls are optional: a failure here must never break login (this runs inside Notifier.start)
            logger.error("Clariva calls: failed to start", e);
            this.stop();
        }
    }

    public stop(): void {
        const client = this.client;
        if (client) {
            client.off(ClientEvent.Sync, this.onSync);
            client.off(RoomEvent.Timeline, this.onTimeline);
            client.off(MatrixEventEvent.Decrypted, this.onDecrypted);
            client.off(RoomStateEvent.Events, this.onStateEvent);
            CallStore.instance.off(CallStoreEvent.ConnectedCalls, this.onConnectedCalls);
            document.removeEventListener("visibilitychange", this.onVisibility);
        }
        this.disarmAudioUnlock();
        this.incoming?.stop();
        this.incoming = null;
        setIncomingCalls(null);
        for (const watcher of this.billing.values()) watcher.cancel();
        this.billing.clear();
        for (const { watcher, timer } of this.declineWatchers.values()) {
            watcher.stop();
            clearTimeout(timer);
        }
        this.declineWatchers.clear();
        this.roomStateListeners.clear();
        this.pendingDecrypt.clear();
        this.routed.length = 0;
        for (const roomId of [...this.joinFailedRooms]) this.dismissJoinFailed(roomId);
        this.client = null;
        this.syncing = false;
        this.stopRingtone();
    }

    // ── placing and joining calls (header, tile, ring) ───────────────────────

    /** The chooser's choice. Resolves to the intent, or `null` when `room` is not a 1:1 chat. */
    public startCall(room: Room, voice: boolean): Promise<ElementCallIntent | null> {
        return startDmCall(this.outgoingHost(room.client), room, voice);
    }

    /** Join the running call of a 1:1 chat (Join button, tile, accepted ring). */
    public joinCall(room: Room, options: JoinOptions): Promise<ElementCallIntent | null> {
        return joinDmCall(this.outgoingHost(room.client), room, options);
    }

    private outgoingHost(client: MatrixClient): OutgoingHost<Room> {
        return {
            myUserId: () => client.getSafeUserId(),
            dmPeerOf: (room) => safeCallDmPeerId(room),
            roomIdOf: (room) => room.roomId,
            hasLiveCall: (room) => roomHasLiveCall(room),
            liveCallMedia: (room) => callMediaTypeOf(getRoomLiveMemberships(room)),
            recordCallType,
            fetchCallType,
            watchBilling: (room, peerId, mode, startedAt) => this.watchBilling(room, peerId, mode, startedAt),
            watchDecline: (room) => this.watchDecline(room),
            openCall: async (room, intent) => {
                const skipLobby = intentSkipsLobby(intent);
                await ElementCall.create(room, skipLobby, intent);
                defaultDispatcher.dispatch<ViewRoomPayload>({
                    action: Action.ViewRoom,
                    room_id: room.roomId,
                    view_call: true,
                    skipLobby,
                    metricsTrigger: undefined,
                });
            },
            now: () => Date.now(),
        };
    }

    // ── billing ─────────────────────────────────────────────────────────────

    private watchBilling(room: Room, peerId: string, mode: "start" | "join", startedAt: number): void {
        if (WalletStore.instance.isConsultant === true) return; // consultants never pay: nothing to watch
        this.billing.get(room.roomId)?.cancel();
        const watcher = new CallBillingWatcher({
            isPeerInCall: () => {
                const memberships = getRoomLiveMemberships(room);
                return mode === "start"
                    ? hasUserJoinedSince(memberships, peerId, startedAt)
                    : isUserInCall(memberships, peerId);
            },
            subscribe: (onChange) => this.subscribeRoomCallState(room.roomId, onChange),
            bill: async () => {
                await billPeerAnsweredForSession(peerId);
            },
            windowMs: BILLING_ANSWER_WINDOW_MS,
        });
        this.billing.set(room.roomId, watcher);
        void watcher.start().then((outcome) => {
            logger.debug(`Clariva calls: billing watcher for ${room.roomId} ended: ${outcome}`);
            if (this.billing.get(room.roomId) === watcher) this.billing.delete(room.roomId);
        });
    }

    private subscribeRoomCallState(roomId: string, onChange: () => void): () => void {
        let listeners = this.roomStateListeners.get(roomId);
        if (!listeners) this.roomStateListeners.set(roomId, (listeners = new Set()));
        listeners.add(onChange);
        return () => {
            const set = this.roomStateListeners.get(roomId);
            set?.delete(onChange);
            if (set?.size === 0) this.roomStateListeners.delete(roomId);
        };
    }

    // ── caller side: the peer declines ───────────────────────────────────────

    private watchDecline(room: Room): void {
        const client = this.client ?? room.client;
        this.declineWatchers.get(room.roomId)?.watcher.stop();
        const existing = this.declineWatchers.get(room.roomId);
        if (existing) clearTimeout(existing.timer);

        const watcher = new CallerDeclineWatcher({
            myUserId: () => client.getSafeUserId(),
            ownRingIds: () => this.ownRingIds(room, client.getSafeUserId()),
            hangUp: () => this.hangUpAfterGrace(room.roomId),
        });
        // A decline only matters while the ring is out (EC's lifetime is 30 s); do not keep watching forever.
        const timer = setTimeout(() => {
            watcher.stop();
            this.declineWatchers.delete(room.roomId);
        }, BILLING_ANSWER_WINDOW_MS);
        this.declineWatchers.set(room.roomId, { watcher, timer });
    }

    private ownRingIds(room: Room, me: string): Set<string> {
        const ids = new Set<string>();
        for (const ev of room.getLiveTimeline().getEvents()) {
            const id = ev.getId();
            if (ev.getType() !== RTC_NOTIFICATION_EVENT_TYPE || ev.getSender() !== me || !id || id.startsWith("~"))
                continue;
            ids.add(id);
        }
        return ids;
    }

    /** EC 0.16.3 leaves by itself on a decline; give it a moment, then hang up from the host if it did not. */
    private hangUpAfterGrace(roomId: string): void {
        setTimeout(() => {
            const call = CallStore.instance.getActiveCall(roomId);
            if (!call?.connected) return;
            logger.info(`Clariva calls: the peer declined and EC did not leave; hanging up ${roomId}`);
            call.disconnect().catch((e) => logger.warn("Clariva calls: hang-up after a decline failed", e));
        }, HANGUP_GRACE_MS);
    }

    // ── client events ───────────────────────────────────────────────────────

    private readonly onSync = (state: SyncState): void => {
        this.syncing = nextSyncGate(this.syncing, state);
    };

    // The handlers below run inside js-sdk's emit (sync processing, decryption): whatever goes wrong in them must never
    // propagate into the SDK, and one failing handler must not keep the others from running.

    private readonly onTimeline = (
        ev: MatrixEvent,
        room: Room | undefined,
        toStartOfTimeline: boolean | undefined,
        removed: boolean,
        data: IRoomTimelineData,
    ): void => {
        if (!this.client || removed || toStartOfTimeline || !data.liveEvent || !this.syncing || !room) return;
        try {
            if (data.timeline.getTimelineSet().threadListType !== null) return;
            void this.client.decryptEventIfNeeded(ev);
            if (ev.isBeingDecrypted() || ev.isDecryptionFailure()) {
                // Keys may take a while (or not come at all). Whether this is a ring in a 1:1 chat is only known once
                // it is decrypted, and `m.direct` may not even be loaded yet, so hold back every event of a room that
                // could be one rather than only those of rooms already known to be DMs.
                const id = ev.getId();
                if (id && mayBeDmRoom(room)) this.parkForDecryption(id);
                return;
            }
            this.route(ev);
        } catch (e) {
            logger.warn("Clariva calls: failed to handle a timeline event", e);
        }
    };

    private parkForDecryption(id: string): void {
        const now = Date.now();
        for (const [parkedId, until] of this.pendingDecrypt) {
            if (until <= now) this.pendingDecrypt.delete(parkedId);
        }
        this.pendingDecrypt.set(id, now + PARKED_DECRYPT_MS);
    }

    private readonly onDecrypted = (ev: MatrixEvent): void => {
        try {
            const id = ev.getId();
            const until = id ? this.pendingDecrypt.get(id) : undefined;
            if (!id || until === undefined) return;
            // Still undecryptable: stay parked. js-sdk decrypts such events again when the missing keys arrive and
            // emits `Decrypted` once more, which brings us back here with the ring readable.
            if (ev.isDecryptionFailure()) return;
            this.pendingDecrypt.delete(id);
            if (until > Date.now()) this.route(ev); // after `PARKED_DECRYPT_MS` the ring is over whatever it says
        } catch (e) {
            logger.warn("Clariva calls: failed to handle a decrypted event", e);
        }
    };

    private readonly onStateEvent = (ev: MatrixEvent): void => {
        if (ev.getType() !== CALL_MEMBER_EVENT_TYPE) return;
        const roomId = ev.getRoomId();
        if (!roomId) return;
        try {
            this.incoming?.onRoomStateChanged(roomId);
            if (this.joinFailedRooms.has(roomId)) {
                const room = this.client?.getRoom(roomId);
                if (!room || !roomHasLiveCall(room)) this.dismissJoinFailed(roomId); // the call is over: nothing to retry
            }
        } catch (e) {
            logger.warn("Clariva calls: failed to handle a call membership change", e);
        }
        for (const listener of [...(this.roomStateListeners.get(roomId) ?? [])]) {
            try {
                listener();
            } catch (e) {
                logger.warn("Clariva calls: a call state listener failed", e);
            }
        }
    };

    private readonly onConnectedCalls = (calls: Set<{ roomId: string }>): void => {
        for (const call of calls) {
            this.incoming?.onLocalCallConnected(call.roomId);
            this.dismissJoinFailed(call.roomId); // I am in the call now: a "couldn't join" toast is obsolete
        }
    };

    private readonly onVisibility = (): void => {
        if (!document.hidden) this.incoming?.checkExpiry();
    };

    private route(ev: MatrixEvent): void {
        const id = ev.getId();
        const roomId = ev.getRoomId();
        const sender = ev.getSender();
        if (!id || !roomId || !sender || this.routed.includes(id)) return;
        const type = ev.getType();
        if (type !== RTC_NOTIFICATION_EVENT_TYPE && type !== RTC_DECLINE_EVENT_TYPE) return;
        this.routed.push(id);
        if (this.routed.length > 200) this.routed.shift();

        if (type === RTC_NOTIFICATION_EVENT_TYPE) {
            void this.incoming?.handleRing({
                eventId: id,
                roomId,
                sender,
                originTs: ev.getTs(),
                localTs: ev.localTimestamp,
                content: ev.getContent(),
            });
            return;
        }
        const ringId = declinedRingId(ev.getContent());
        if (ringId) this.incoming?.onDecline(ringId, sender);
        this.declineWatchers.get(roomId)?.watcher.onDecline(sender, ev.getContent());
    }

    // ── incoming ring plumbing ──────────────────────────────────────────────

    private makeIncomingHost(client: MatrixClient): IncomingCallsHost {
        const roomOf = (roomId: string): Room | null => client.getRoom(roomId);
        return {
            now: () => Date.now(),
            myUserId: () => client.getSafeUserId(),
            dmPeerOf: (roomId) => safeCallDmPeerId(roomOf(roomId)),
            liveMemberships: (roomId) => {
                const room = roomOf(roomId);
                return room ? getRoomLiveMemberships(room) : [];
            },
            waitForMembership: (roomId, userId, timeoutMs) => this.waitForMembership(client, roomId, userId, timeoutMs),
            fetchCallType,
            isBusy: () => CallStore.instance.connectedCalls.size > 0,
            sendDecline: async (roomId, ringEventId) => {
                await client.sendEvent(
                    roomId,
                    RTC_DECLINE_EVENT_TYPE as keyof TimelineEvents,
                    {
                        "m.relates_to": { rel_type: "m.reference", event_id: ringEventId },
                    } as unknown as TimelineEvents[keyof TimelineEvents],
                );
            },
            joinCall: async (roomId, mediaType) => {
                const room = roomOf(roomId);
                // A call that did not open must not look like one that did: the manager reports a rejection.
                if (!room) throw new Error(`Clariva calls: room ${roomId} is unknown`);
                // Android parity (spec 04 §3.6.4-a): answering a ring is neither gated nor billed.
                const intent = await this.joinCall(room, { mediaType, billing: false });
                if (intent === null) throw new Error(`Clariva calls: ${roomId} is not a 1:1 chat`);
            },
            showRing: (ring) => this.showRing(client, ring),
            hideRing: (ring, reason) => this.hideRing(ring, reason),
            startRingtone: () => this.startRingtone(),
            stopRingtone: () => this.stopRingtone(),
            notifyMissed: (ring) => this.notifyMissed(client, ring),
            joinFailed: (ring) => this.showJoinFailed(ring),
        };
    }

    // ── an accepted ring that could not be joined ────────────────────────────

    private showJoinFailed(ring: ActiveRing): void {
        this.joinFailedRooms.add(ring.roomId);
        ToastStore.sharedInstance().addOrReplaceToast({
            key: joinFailedToastKey(ring.roomId),
            // below the ring toasts (100): a new ring must never end up hidden beneath this
            priority: JOIN_FAILED_TOAST_PRIORITY,
            className: "mx_ClarivaJoinFailedToast", // CLARIVA: the call sheet look (_calls.pcss)
            title: callsStrings.joinFailedTitle,
            component: GenericToast,
            props: {
                description: callsStrings.joinFailed,
                primaryLabel: callsStrings.tryAgain,
                onPrimaryClick: () => this.retryJoin(ring),
                secondaryLabel: callsStrings.dismiss,
                onSecondaryClick: () => this.dismissJoinFailed(ring.roomId),
            },
        });
    }

    private dismissJoinFailed(roomId: string): void {
        if (!this.joinFailedRooms.delete(roomId)) return;
        ToastStore.sharedInstance().dismissToast(joinFailedToastKey(roomId));
    }

    /** The toast's Join button: try again, but only while there is still a call to join (never start one by accident). */
    private retryJoin(ring: ActiveRing): void {
        this.dismissJoinFailed(ring.roomId);
        const room = this.client?.getRoom(ring.roomId);
        if (!room || !roomHasLiveCall(room)) return;
        this.joinCall(room, { mediaType: ring.mediaType, billing: false })
            .then((intent) => {
                if (intent === null) throw new Error(`Clariva calls: ${ring.roomId} is not a 1:1 chat`);
            })
            .catch((e) => {
                logger.warn("Clariva calls: joining the call again failed", e);
                if (this.client) this.showJoinFailed(ring);
            });
    }

    private waitForMembership(
        client: MatrixClient,
        roomId: string,
        userId: string,
        timeoutMs: number,
    ): Promise<boolean> {
        const room = client.getRoom(roomId);
        if (!room) return Promise.resolve(false);
        const present = (): boolean => isUserInCall(getRoomLiveMemberships(room), userId);
        if (present()) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
            let finish: (result: boolean) => void = () => undefined;
            const unsubscribe = this.subscribeRoomCallState(roomId, () => {
                if (present()) finish(true);
            });
            const timer = setTimeout(() => finish(present()), timeoutMs);
            finish = (result) => {
                clearTimeout(timer);
                unsubscribe();
                resolve(result);
            };
        });
    }

    private callerName(client: MatrixClient, roomId: string, senderId: string): string {
        const room = client.getRoom(roomId);
        return room?.getMember(senderId)?.name ?? senderId;
    }

    private showRing(client: MatrixClient, ring: ActiveRing): void {
        ToastStore.sharedInstance().addOrReplaceToast({
            key: incomingCallToastKey(ring.ringEventId),
            priority: RING_TOAST_PRIORITY,
            className: "mx_ClarivaIncomingCallToast", // CLARIVA: the ring sheet (_calls.pcss)
            component: ClarivaIncomingCallToast,
            bodyClassName: "mx_ClarivaIncomingCall",
            props: { ringEventId: ring.ringEventId },
        });
        showCallNotification({
            title: this.callerName(client, ring.roomId, ring.senderId),
            body: incomingCallLabel(ring.mediaType),
            tag: ringTag(ring.ringEventId),
            sticky: true,
            onClick: () =>
                defaultDispatcher.dispatch<ViewRoomPayload>({
                    action: Action.ViewRoom,
                    room_id: ring.roomId,
                    metricsTrigger: undefined,
                }),
        });
    }

    private hideRing(ring: ActiveRing, _reason: RingEndReason): void {
        ToastStore.sharedInstance().dismissToast(incomingCallToastKey(ring.ringEventId));
        closeCallNotification(ringTag(ring.ringEventId));
    }

    /**
     * A missed call is an ordinary notification with the body "Missed call" (Android: "Incoming call"; the web says what
     * it is). A ring the user never saw (`ring` has no `ringEventId`: never shown, the caller gave up first, already
     * over, or I was in another call) is shown even when the tab has the focus: a consultant on a web call keeps the
     * focus inside the Element Call iframe, so "focused" does not mean "saw the ring". A ring that was on screen and
     * ran out keeps the usual background-only rule.
     */
    private notifyMissed(client: MatrixClient, ring: { roomId: string; senderId: string } | ActiveRing): void {
        showCallNotification({
            title: this.callerName(client, ring.roomId, ring.senderId),
            body: callsStrings.missedCall,
            tag: missedTag(ring.roomId),
            always: !("ringEventId" in ring),
            onClick: () =>
                defaultDispatcher.dispatch<ViewRoomPayload>({
                    action: Action.ViewRoom,
                    room_id: ring.roomId,
                    metricsTrigger: undefined,
                }),
        });
    }

    /**
     * Everything that makes a ring noticeable besides the toast: the ringtone and the flashing page title (the browser
     * notification is posted by `showRing`). Called when the first ring starts.
     */
    private startRingtone(): void {
        if (this.ringtonePlaying) return;
        this.ringtonePlaying = true;
        this.titleFlash.start();
        // Before the first click on the page the browser keeps the AudioContext suspended: `play` then "succeeds"
        // without a sound. Say so on the toast, and make sure the next gesture lifts it.
        this.armAudioUnlock();
        this.watchAudioState();
        this.refreshSoundHint();
        // `play` is async: if the ring ended before it resolved, stop the loop that has just started.
        LegacyCallHandler.instance
            .play(AudioID.Ring)
            .then(() => {
                if (!this.ringtonePlaying) {
                    LegacyCallHandler.instance.pause(AudioID.Ring);
                    return;
                }
                // Some browsers resume the context by themselves when a sound starts, but a moment AFTER `start()`
                // (the state is still `suspended` right now): look again shortly, in case no state change is reported.
                this.refreshSoundHint();
                this.recheckSoundHintSoon();
            })
            .catch((e) => logger.debug("Clariva calls: ringtone blocked", e));
    }

    private stopRingtone(): void {
        this.titleFlash.stop();
        this.clearSoundHintWatchers();
        if (!this.ringtonePlaying) return;
        this.ringtonePlaying = false;
        setRingSoundBlocked(false);
        LegacyCallHandler.instance.pause(AudioID.Ring);
    }

    // ── ringtone vs. the browser's autoplay policy ───────────────────────────

    private audioBlocked(): boolean {
        try {
            return LegacyCallHandler.instance.isAudioBlocked();
        } catch (e) {
            logger.debug("Clariva calls: could not read the audio state", e);
            return false;
        }
    }

    /** The ring toast shows its "click anywhere" hint exactly while a ring plays on a context that cannot make sound. */
    private refreshSoundHint(): void {
        setRingSoundBlocked(this.ringtonePlaying && this.audioBlocked());
    }

    /** Re-read the audio state once, `SOUND_HINT_RECHECK_MS` from now (cancelled when the ring ends or on `stop`). */
    private recheckSoundHintSoon(): void {
        if (this.soundHintTimer !== undefined) clearTimeout(this.soundHintTimer);
        this.soundHintTimer = setTimeout(() => {
            this.soundHintTimer = undefined;
            this.refreshSoundHint();
        }, SOUND_HINT_RECHECK_MS);
    }

    /** Follow the ringtone context's `statechange` while a ring plays, so the hint goes the moment sound can start. */
    private watchAudioState(): void {
        this.unwatchAudioState?.();
        this.unwatchAudioState = undefined;
        try {
            this.unwatchAudioState = LegacyCallHandler.instance.onAudioBlockedChange(() => this.refreshSoundHint());
        } catch (e) {
            logger.debug("Clariva calls: could not follow the audio state", e);
        }
    }

    private clearSoundHintWatchers(): void {
        if (this.soundHintTimer !== undefined) clearTimeout(this.soundHintTimer);
        this.soundHintTimer = undefined;
        this.unwatchAudioState?.();
        this.unwatchAudioState = undefined;
    }

    /**
     * Resume the ringtone's AudioContext (and have the ring sound decoded) on the first user gesture. Listens in the
     * capture phase so no handler on the page can swallow the event, and goes away once it worked (or on `stop`).
     */
    private armAudioUnlock(): void {
        if (this.audioUnlockArmed || !this.client) return;
        this.audioUnlockArmed = true;
        for (const type of AUDIO_GESTURE_EVENTS) document.addEventListener(type, this.onUserGesture, true);
    }

    private disarmAudioUnlock(): void {
        if (!this.audioUnlockArmed) return;
        this.audioUnlockArmed = false;
        for (const type of AUDIO_GESTURE_EVENTS) document.removeEventListener(type, this.onUserGesture, true);
    }

    private readonly onUserGesture = (): void => {
        void this.unlockAudio();
    };

    private async unlockAudio(): Promise<void> {
        try {
            await LegacyCallHandler.instance.unlockAudio();
        } catch (e) {
            logger.debug("Clariva calls: could not unlock call audio", e);
        }
        if (!this.client) return; // stopped while the browser was deciding
        this.refreshSoundHint();
        // Not every gesture counts (a bare Shift keydown, say): keep listening until the context really runs.
        if (!this.audioBlocked()) this.disarmAudioUnlock();
    }
}

/** The one instance. Upstream code only calls `start` / `stop` (from `Notifier`). */
export const ClarivaCalls = new ClarivaCallsRuntime();
