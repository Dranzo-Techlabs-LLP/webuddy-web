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
    type CallMediaType,
    type ElementCallIntent,
    callTypeForVoiceFlag,
    intentFor,
    mediaTypeForJoin,
} from "./intent";

/**
 * Starting and joining a 1:1 call, in the order Android does it (spec 04 §3.4 / §3.5 / §6.6), with the outside world
 * behind `OutgoingHost` so the ordering rules are testable:
 *
 *  Start (the chooser):
 *    1. the billing watcher first, "before anything else" (it only ever bills once the peer is really in the call);
 *    2. the Wallet call-type record, bounded to 2 s and never fatal;
 *    3. the Element Call intent: `start_call_dm[_voice]` (or `join_existing_dm[_voice]` if a call is already live);
 *    4. when we are the caller, arm the decline safety net;
 *    5. open the call.
 *  Join (header button, "Call started" tile, accepting a ring):
 *    the media type comes from the call itself (`m.call.intent` of the live memberships), else the Wallet record, else
 *    video; the intent is always `join_existing_dm[_voice]`; billing only when asked (Android: not when accepting a
 *    ring, yes when pressing Join in the chat).
 */

export interface OutgoingHost<Room> {
    myUserId(): string;
    /** The peer if `room` is a 1:1 chat, else `null`. */
    dmPeerOf(room: Room): string | null;
    roomIdOf(room: Room): string;
    /** Is there a call in progress in the room (at least one live membership)? */
    hasLiveCall(room: Room): boolean;
    /** The media type the live call is held in (from `m.call.intent`), if the memberships say. */
    liveCallMedia(room: Room): CallMediaType | null;
    recordCallType(roomId: string, mediaType: CallMediaType, callerId: string): Promise<boolean>;
    fetchCallType(roomId: string): Promise<CallMediaType | null>;
    /** Watch for the peer joining and bill once. `mode: "start"` requires the peer to join after `startedAt`. */
    watchBilling(room: Room, peerId: string, mode: "start" | "join", startedAt: number): void;
    /** Arm the host-side "peer declined -> hang up" safety net (DM callers only). */
    watchDecline(room: Room): void;
    /** Create the call widget with this intent and show the call. */
    openCall(room: Room, intent: ElementCallIntent): Promise<void>;
    now(): number;
}

/**
 * The chooser's "Voice call" / "Video call". Resolves to the intent used, or `null` when `room` is not a 1:1 chat
 * (the caller then falls back to the stock Element Call flow).
 */
export async function startDmCall<Room>(
    host: OutgoingHost<Room>,
    room: Room,
    voice: boolean,
): Promise<ElementCallIntent | null> {
    const peerId = host.dmPeerOf(room);
    if (!peerId) return null;

    const startedAt = host.now();
    host.watchBilling(room, peerId, "start", startedAt);
    await host.recordCallType(host.roomIdOf(room), callTypeForVoiceFlag(voice), host.myUserId());

    const intent = intentFor({ direct: true, hasActiveCall: host.hasLiveCall(room), voice });
    if (intent.startsWith("start_call")) host.watchDecline(room);
    await host.openCall(room, intent);
    return intent;
}

export interface JoinOptions {
    /** Override the media type (a ring we are answering already knows it). */
    mediaType?: CallMediaType;
    /** Bill when the peer is (or gets) in the call. `false` when accepting a ring (Android parity). */
    billing: boolean;
}

/** Join the call that is already running in a 1:1 chat. Resolves to the intent used, `null` if not a 1:1 chat. */
export async function joinDmCall<Room>(
    host: OutgoingHost<Room>,
    room: Room,
    options: JoinOptions,
): Promise<ElementCallIntent | null> {
    const peerId = host.dmPeerOf(room);
    if (!peerId) return null;

    const startedAt = host.now();
    if (options.billing) host.watchBilling(room, peerId, "join", startedAt);

    let mediaType = options.mediaType ?? host.liveCallMedia(room);
    if (!mediaType) mediaType = mediaTypeForJoin(null, await host.fetchCallType(host.roomIdOf(room)));

    const intent = intentFor({ direct: true, hasActiveCall: true, voice: mediaType === "voice" });
    await host.openCall(room, intent);
    return intent;
}
