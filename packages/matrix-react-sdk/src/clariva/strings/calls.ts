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
 * User-visible English strings for the Clariva "calls" area, copied verbatim from the Android app (see the
 * Appendix of the matching spec in docs/clariva/spec). Owned by the calls workstream; keep literals here (not in
 * en_EN.json) so Android parity is reviewable in one place.
 *
 * Source: docs/clariva/spec/04-calls-qr-search.md §2.12 ("Verbatim string table").
 */
export const callsStrings = {
    /** Call button a11y label and chooser title. */
    startCall: "Start a call",
    /** Chooser body. */
    chooseHowToCall: "Choose how you want to call.",
    voiceCall: "Voice call",
    videoCall: "Video call",
    /** Room-list summary of a voice call you are not in (Element's own line says "Video"). */
    liveVoice: "Voice",
    cancel: "Cancel",
    /** Top-bar / tile Join button. */
    join: "Join",
    /** Timeline tile text (and the room-list preview of a ring event). */
    callStarted: "Call started",
    incomingVoiceCall: "Incoming voice call",
    incomingVideoCall: "Incoming video call",
    accept: "Accept",
    reject: "Reject",
    /** Page-title prefix while a call rings (the ring toast and its notification say "Incoming voice/video call"). */
    incomingCall: "Incoming call",
    // ── web only (no Android equivalent) ──
    /** Body of the browser notification of a call the user did not get to answer. */
    missedCall: "Missed call",
    /** Ring toast hint while the browser's autoplay policy keeps the ringtone silent. */
    enableCallSound: "Click anywhere to enable call sound",
    /** Toast after an accepted ring could not be joined: its title, its text and its retry button. */
    joinFailedTitle: "Couldn't join the call",
    joinFailed: "The call is still running.",
    tryAgain: "Try again",
    dismiss: "Dismiss",
} as const;

/** Page title while a call rings: `(Incoming call) <title>`. */
export function incomingCallTitlePrefix(): string {
    return `(${callsStrings.incomingCall}) `;
}

/** "Incoming voice call" / "Incoming video call" for the resolved media type. */
export function incomingCallLabel(mediaType: "voice" | "video"): string {
    return mediaType === "video" ? callsStrings.incomingVideoCall : callsStrings.incomingVoiceCall;
}

/** Accessible name of the ring's Accept button: "Accept video call from Dr Rao". */
export function acceptCallLabel(mediaType: "voice" | "video", callerName: string): string {
    return `Accept ${mediaType === "video" ? "video" : "voice"} call from ${callerName}`;
}

/** Accessible name of the ring's Reject button: "Reject call from Dr Rao". */
export function rejectCallLabel(callerName: string): string {
    return `Reject call from ${callerName}`;
}
