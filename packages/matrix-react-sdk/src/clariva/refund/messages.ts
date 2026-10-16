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

import { formatPlainAmount } from "./amount";

/* eslint-disable camelcase */
/* eslint @typescript-eslint/naming-convention: "off" */

/**
 * The Matrix announcements of refund events (spec 03 §5.1). They are the ONLY thing that notifies the other party
 * when the app is closed (homeserver -> push gateway), so they must be ordinary `m.text` events — never `m.notice`,
 * which the default `.m.rule.suppress_notices` push rule silences.
 *
 * Bodies are copied verbatim from the Android app (U+2014 EM DASH in three of them). Never match on them: earlier
 * Android builds prefixed emojis, and old rooms still contain those variants.
 */

export type RefundEventKind = "requested" | "approved" | "rejected" | "auto_approved";

export const REFUND_BODY_REQUESTED = "Refund requested for the held credits";
export const REFUND_BODY_APPROVED_FULL = "Your refund was approved — credits returned to your wallet";
export const REFUND_BODY_REJECTED = "Your refund was rejected by the consultant";
export const REFUND_BODY_AUTO_APPROVED =
    "Refund auto-approved after 24h with no response — credits returned to the client";

/** Partial approval: states the amount that was really returned (`response.amount ?? refundAmount`). */
export function refundBodyApprovedPartial(amount: number): string {
    return `Your refund was approved — ${formatPlainAmount(amount)} credits returned to your wallet`;
}

/** Event content: `m.text` + empty `m.mentions` (decision D6) + a machine-readable marker (ignored by Android). */
export interface RefundMessageContent {
    "msgtype": "m.text";
    "body": string;
    "m.mentions": Record<string, never>;
    "com.clariva.refund": {
        event: RefundEventKind;
        refund_request_id?: number;
    };
}

/** Normalise a server/state refund-request id (number, numeric string, or absent) to a number, if it is one. */
export function toRefundRequestId(id: number | string | null | undefined): number | undefined {
    if (id === null || id === undefined || id === "") return undefined;
    const n = typeof id === "number" ? id : Number(id);
    return Number.isFinite(n) ? n : undefined;
}

export function buildRefundMessage(
    event: RefundEventKind,
    body: string,
    refundRequestId?: number | string | null,
): RefundMessageContent {
    const id = toRefundRequestId(refundRequestId);
    return {
        "msgtype": "m.text",
        body,
        "m.mentions": {},
        "com.clariva.refund": id === undefined ? { event } : { event, refund_request_id: id },
    };
}
