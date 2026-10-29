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
 * User-visible English strings of the "Clear Water" chat room chrome (src/clariva/components/room): the glass header,
 * the DM intro card, the composer action and the delivery ticks. Plain verbs, sentence case, no exclamation marks
 * (docs/clariva/DESIGN-SYSTEM.md section 7). [WEB] marks copy that only exists on the web. The designation badge and the
 * presence line ("online", "last seen ...") are Android copy: see `strings/profile.ts`.
 */
export const roomStrings = {
    /** [WEB] rate chip of the intro card, e.g. `100 credits per 24 h chat`. `n` is already formatted. */
    introRate: (n: string): string => `${n} credits per 24 h chat`,
    /** [WEB] only shown when the room is actually end-to-end encrypted. */
    introPrivate: "Private and end-to-end encrypted",
    /** [WEB] visible labels of the two call buttons of the intro card. */
    introVoice: "Voice",
    introVideo: "Video",
    /** [WEB] gentle prompt of an empty chat. */
    introSayHello: (name: string): string => `Say hello to ${name}`,
    /** [WEB] a11y label of the intro card region. */
    introLabel: "About this chat",

    /** [WEB] the status glyph next to an own message's time. */
    tickSending: "Sending",
    tickSent: "Sent",
    tickRead: "Read",
    tickFailed: "Not sent",

    /** [WEB] the small label of the unread divider (the divider is a hairline; the label is decorative). */
    unreadDivider: "New",
} as const;
