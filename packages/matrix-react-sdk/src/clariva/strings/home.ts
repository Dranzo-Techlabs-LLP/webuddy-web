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
 * User-visible English strings of the Home dashboard (src/clariva/components/home): the desktop pane that shows while no
 * chat is open. Every string is [WEB]: the Android app has no dashboard. Plain verbs, sentence case, no exclamation marks.
 * Strings that already exist elsewhere (the QR labels, "Start a chat", the wallet hints) are reused from their own tables.
 */
export const homeStrings = {
    /** Accessible name of the whole dashboard (a `region`). */
    dashboardLabel: "Home",
    greetingMorning: "Good morning",
    greetingAfternoon: "Good afternoon",
    greetingEvening: "Good evening",
    /** "Good evening, Asha"; without a name just "Good evening". */
    greeting: (greeting: string, name: string | null): string => (name ? `${greeting}, ${name}` : greeting),
    /** Quiet line under the greeting (the brand byline). */
    tagline: "Private conversations. Real value.",

    // ── wallet card ───────────────────────────────────────────────────────────
    walletCardLabel: "Your wallet",
    /** Small caption above the balance. */
    balanceCaption: "Your balance",
    earningsCaption: "Your earnings",
    /** The unit beside the big number. */
    creditsUnit: "credits",
    /** The one action of a client's card (opens the Wallet tab, where the recharge dialog lives). */
    addCredits: "Add credits",
    /** Consultant card: how many clients are waiting for an answer to a refund request. */
    pendingRefunds: (count: number): string =>
        count === 1 ? "1 refund request is waiting" : `${count} refund requests are waiting`,
    noPendingRefunds: "No refund requests are waiting",
    reviewRefunds: "Review refunds",

    // ── recent chats rail ─────────────────────────────────────────────────────
    recentChats: "Recent chats",
    recentChatsList: "Recent chats, scroll sideways for more",

    // ── quick actions ─────────────────────────────────────────────────────────
    quickActions: "Quick actions",
} as const;
