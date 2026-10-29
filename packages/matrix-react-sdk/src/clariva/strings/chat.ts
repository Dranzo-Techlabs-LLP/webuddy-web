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
 * User-visible English strings for the Clariva "chat" area, copied verbatim from the Android app (see the
 * Appendix of the matching spec in docs/clariva/spec). Owned by the chat workstream; keep literals here (not in
 * en_EN.json) so Android parity is reviewable in one place.
 */
export const chatStrings = {
    // ── gate: "Chat restricted" bar (spec 03 U1; Android DisabledComposerView). Keys prefixed `gate`/`session`. ────
    gateRestricted: "Chat restricted. Please recharge your wallet to continue.",
    /** `Current: {credits} | Required: {maxCredits}` — only when both numbers are known. */
    gateCurrentRequired: (credits: string, required: string): string => `Current: ${credits} | Required: ${required}`,
    /** Web improvement over Android (the bar has no action there): jump to the Wallet settings tab. */
    gateRecharge: "Recharge",
    /** Chat-list rate label (U8), e.g. `50 credits` (Android prints the unit even for 1). */
    gateRateLabel: (n: string): string => `${n} credits`,

    // ── consultant <-> consultant rule (Android DisabledComposerView / ConsultantChatNotAllowedException) ──────────
    /** The bar that replaces the composer of an existing consultant <-> consultant chat (no Recharge button). */
    gateConsultantPeerTitle: "You can't chat with other consultants.",
    gateConsultantPeerSubtitle: "Consultants can only chat with clients.",
    /** The warning shown instead of creating a NEW consultant <-> consultant chat (no retry). */
    consultantChatNotAllowedTitle: "Can't start chat",
    consultantChatNotAllowedMessage: "You can't chat with other consultants. Consultants can only chat with clients.",

    // ── session: "Start a new session?" dialog (spec 03 U2) ──────────────────────────────────────────────────
    sessionNewTitle: "Start a new session?",
    sessionNewBody:
        "Your previous session has ended. Sending this message starts a new billable session and places a fresh hold on your credits.",
    sessionNeverRemind: "Never remind me again for this consultant",
    sessionContinue: "Continue",
    sessionCancel: "Cancel",

    // ── session: the server refused the hold (web improvement, spec 03 §4.12 / §7.1-1) ───────────────────────────
    sessionInsufficientTitle: "Not enough credits",
    /** Shown when the server gives no message of its own. */
    sessionInsufficientFallback: "You do not have enough credits to start this chat. Please recharge to continue.",
    sessionInsufficientClose: "Close",

    // ── refunds (spec 03 U3-U8, Appendix A). Keys are prefixed `refund`; keep them verbatim. ──────────────────────
    /** Client: header button (U3). */
    refundRequestButton: "Request refund",
    refundConfirmTitle: "Request Refund",
    refundConfirmBody: "Are you sure you want to request a refund?",
    refundConfirmSubmit: "Request",
    refundCancel: "Cancel",

    /** Consultant: banner under the room header (U4). */
    refundBannerTitle: "Refund request",
    refundBannerBody:
        "The client has asked for a refund. Approve to return the held amount (in full or in part) immediately, or reject to keep the funds (transferred at the end of the hold window).",
    refundApprove: "Approve",
    refundReject: "Reject",

    /** Consultant: "Approve Refund" dialog (U5). `held` is already formatted (integer if whole, else the decimal). */
    refundApproveDialogTitle: "Approve Refund",
    refundFullOptionWithHeld: (held: string): string => `Full refund (₹${held})`,
    refundFullOption: "Full refund",
    refundPartialOption: "Partial refund",
    refundFullHelper: "The full held amount will be returned to the client immediately.",
    refundAmountLabel: "Refund amount",
    refundAmountHelperWithHeld: (held: string): string => `The client gets this back; you keep the rest of ₹${held}.`,
    refundAmountHelperNoHeld: "The client gets this back; you keep the remainder.",
    refundAmountErrorWithHeld: (held: string): string => `Enter an amount greater than 0 and at most ₹${held}.`,
    refundAmountErrorNoHeld: "Enter an amount greater than 0.",

    /** Consultant: "Reject Refund" confirm (U6). */
    refundRejectTitle: "Reject Refund",
    refundRejectBody: "The held amount will transfer to your wallet at the end of the hold window.",

    /** Chat-local toasts (U7). A failed call shows the server's own message, falling back to this. */
    refundToastRequested: "Refund request sent",
    refundToastApproved: "Refund approved",
    refundToastRejected: "Refund rejected",
    refundToastError: "Error",

    /** Chat-list pill beside the client's name, consultants only (U8). */
    refundPill: "Refund",
} as const;
