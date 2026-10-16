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
 * Event types and timings of the Clariva call flow. The literals are the ones Element Call 0.16.3 and the Android
 * Rust SDK use on the wire (docs/clariva/spec/04-calls-qr-search.md §5.1): there is NO stable `m.rtc.*` literal yet.
 * js-sdk 34.4 predates the RTC notification/decline constants, so they live here.
 */

/** State event: one per device (`_<user>_<device>_m.call`), EC 0.16.x "session" memberships. */
export const CALL_MEMBER_EVENT_TYPE = "org.matrix.msc3401.call.member";
/** The ring. Sent by Element Call (only by the first joiner). Android rings on this one only. */
export const RTC_NOTIFICATION_EVENT_TYPE = "org.matrix.msc4075.rtc.notification";
/** The legacy duplicate of the ring. Android neither rings on nor renders it. */
export const CALL_NOTIFY_EVENT_TYPE = "org.matrix.msc4075.call.notify";
/** Sent by the declining party's host app (never by EC itself). */
export const RTC_DECLINE_EVENT_TYPE = "org.matrix.msc4310.rtc.decline";
export const CALL_ENCRYPTION_KEYS_EVENT_TYPE = "io.element.call.encryption_keys";
export const CALL_REACTION_EVENT_TYPE = "io.element.call.reaction";
export const RAGESHAKE_REQUEST_EVENT_TYPE = "org.matrix.rageshake_request";

/** The per-call media type EC 0.16.x puts on the ring and on its membership: `"audio" | "video"`. */
export const CALL_INTENT_KEY = "m.call.intent";

/** Android caps the ring at 90 s (`ElementCallConfig`), EC's own `lifetime` is 30 s. */
export const RING_CAP_MS = 90_000;
/** MSC4075: trust `sender_ts` only when it is this close to `origin_server_ts`. */
export const SENDER_TS_SANITY_MS = 20_000;
/** Wallet call-type record: write before starting, read when ringing / joining. Never block a call longer. */
export const CALL_TYPE_TIMEOUT_MS = 2_000;
/** Android bills only when the peer actually joins within this window of starting / joining. */
export const BILLING_ANSWER_WINDOW_MS = 2 * 60_000;
/** After a ring arrives, wait this long for the caller's membership to show up in room state (Android: 3 s). */
export const RING_MEMBERSHIP_WAIT_MS = 3_000;
/** How long EC gets to publish its leave after a host-requested hang-up (Android: 2 s). */
export const HANGUP_GRACE_MS = 2_000;
/** EC `DEFAULT_EXPIRE_DURATION` for a membership event that carries no `expires`. */
export const DEFAULT_MEMBERSHIP_EXPIRY_MS = 4 * 60 * 60_000;

/** Toast priorities (the highest is shown on top): the "couldn't join" toast must stay below every ring toast. */
export const RING_TOAST_PRIORITY = 100;
export const JOIN_FAILED_TOAST_PRIORITY = 90;
/** How long after the ringtone started playing the "click anywhere" hint is checked again (the context may resume late). */
export const SOUND_HINT_RECHECK_MS = 250;

/** Does `eventType` get the Android-style "Call started" tile (only when Clariva calls are enabled, see `pickFactory`)? */
export function isClarivaCallStartedType(eventType: string): boolean {
    return eventType === RTC_NOTIFICATION_EVENT_TYPE;
}
