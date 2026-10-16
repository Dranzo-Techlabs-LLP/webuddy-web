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

import { CALL_INTENT_KEY } from "./constants";

/** The Element Call 0.16.x `intent` URL parameter (UrlParams.ts `UserIntent`). */
export type ElementCallIntent =
    | "start_call"
    | "join_existing"
    | "start_call_dm"
    | "start_call_dm_voice"
    | "join_existing_dm"
    | "join_existing_dm_voice";

export type CallMediaType = "voice" | "video";

export interface IntentInput {
    /** A 1:1 chat: `is_direct` with at most two active (joined + invited) members. */
    direct: boolean;
    /** The room already has a live call membership at widget-creation time. */
    hasActiveCall: boolean;
    /** The camera starts off (EC `*_voice` intent). Ignored in groups (EC has no voice intent there). */
    voice: boolean;
}

/**
 * Port of Android's `DefaultCallWidgetSettingsProvider` intent mapping (spec 04 §3.4.1):
 *
 *     direct && hasActiveCall && voice -> join_existing_dm_voice
 *     direct && hasActiveCall          -> join_existing_dm
 *     hasActiveCall                    -> join_existing
 *     direct && voice                  -> start_call_dm_voice
 *     direct                           -> start_call_dm
 *     otherwise                        -> start_call
 *
 * The intent decides everything else in EC (lobby, who rings, auto-leave, camera default), so the web must pick the
 * same one Android would.
 */
export function intentFor({ direct, hasActiveCall, voice }: IntentInput): ElementCallIntent {
    if (direct && hasActiveCall && voice) return "join_existing_dm_voice";
    if (direct && hasActiveCall) return "join_existing_dm";
    if (hasActiveCall) return "join_existing";
    if (direct && voice) return "start_call_dm_voice";
    if (direct) return "start_call_dm";
    return "start_call";
}

export function isDmIntent(intent: ElementCallIntent): boolean {
    return intent.endsWith("_dm") || intent.endsWith("_dm_voice");
}

/** `*_voice`: audio only (EC `callIntent: audio`, `defaultVideoEnabled: false`). */
export function isVoiceIntent(intent: ElementCallIntent): boolean {
    return intent.endsWith("_voice");
}

export function isJoinIntent(intent: ElementCallIntent): boolean {
    return intent.startsWith("join_existing");
}

/**
 * EC skips its own lobby for every DM intent (UrlParams.ts presets). The host mirrors that in the widget data
 * (`ElementCall.performConnection` shows its own Lobby state otherwise).
 */
export function intentSkipsLobby(intent: ElementCallIntent): boolean {
    return isDmIntent(intent);
}

export function mediaTypeOfIntent(intent: ElementCallIntent): CallMediaType {
    return isVoiceIntent(intent) ? "voice" : "video";
}

/** `"audio" | "video"` (the on-wire `m.call.intent`) to our vocabulary; anything else is unknown. */
export function parseWireCallIntent(value: unknown): CallMediaType | null {
    if (value === "audio") return "voice";
    if (value === "video") return "video";
    return null;
}

/** Read `m.call.intent` from an event / membership content object. */
export function wireIntentOf(content: unknown): CallMediaType | null {
    if (!content || typeof content !== "object") return null;
    return parseWireCallIntent((content as Record<string, unknown>)[CALL_INTENT_KEY]);
}

/** Wallet-API vocabulary check (`GET /v1/calls/type` answers `voice | video | null`). */
export function parseApiCallType(value: unknown): CallMediaType | null {
    return value === "voice" || value === "video" ? value : null;
}

/**
 * Media type for a RING (spec 04 §3.7 / §6.9): the per-call on-wire value is authoritative, then the per-room Wallet
 * record, and when nothing is known **voice** (Android: camera off unless the caller chose video).
 */
export function mediaTypeForRing(wire: CallMediaType | null, api: CallMediaType | null): CallMediaType {
    return wire ?? api ?? "voice";
}

/**
 * Media type when JOINING an ongoing call (button / tile): same precedence, but unknown means **video** (Android:
 * only an explicit `voice` record turns the camera off).
 */
export function mediaTypeForJoin(wire: CallMediaType | null, api: CallMediaType | null): CallMediaType {
    return wire ?? api ?? "video";
}

/** Wallet-API `callType` body value for the chooser choice. */
export function callTypeForVoiceFlag(voice: boolean): CallMediaType {
    return voice ? "voice" : "video";
}
