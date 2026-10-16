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

import { isLess } from "../money";

/**
 * The chat-gate decision table (docs/clariva/spec/03-chat-gate-holds-refunds.md §3.3), as a pure function so every
 * row can be unit-tested. It is the web port of Android's `isRestricted` (MessageComposerPresenter.kt:182-199) with
 * the two deliberate improvements of decision D5:
 *
 *  - amounts are compared at 2 decimals (`money.isLess`), not truncated to integers;
 *  - with `billConsultantsOnly` (default) only a DM whose peer is a CONSULTANT can ever restrict. An unknown peer
 *    role never restricts (fail open), and neither does a client-to-client chat.
 *
 * Lesson L1 (never regress): an unknown role, hold state, balance or rate NEVER restricts.
 */

/** Why the decision came out the way it did (row of the table). Only used for tests, logs and the UI hint. */
export type GateReason =
    | "no-peer" // 1: not a DM / peer gone / members still loading
    | "consultant" // 2: consultants are never gated
    | "role-unknown" // 3: wait for the role (restricting by default flashed the banner for consultants)
    | "peer-not-billable" // D5: client-to-client chat, or the peer's role is unknown
    | "hold-covers" // 4: an active hold covers chat AND call, whatever the balance
    | "hold-unknown" // 5: never restrict on an unknown hold state (lesson 93b7510204)
    | "balance-or-rate-unknown" // 6: not enough knowledge, fail open
    | "free" // rate 0 can never restrict
    | "insufficient" // 7: the only restricting row
    | "sufficient"; // 8: composer open; the first send will warn

export interface GateInput {
    /** The other party of a 1:1 chat; `null` for non-DM rooms. */
    peerId: string | null;
    /** MY role: `true` consultant · `false` client · `null` unknown. */
    role: boolean | null;
    /** A hold covering "a new message won't charge" exists: `null` = unknown (never checked / last check failed). */
    holdExists: boolean | null;
    /** My spendable wallet balance, or `null` while unknown. */
    balance: number | null;
    /** The peer's price per 24 h chat (`max_credits`), or `null` while unknown. */
    rate: number | null;
    /** The PEER's role (`GET /v1/users/{peer}.isConsultant`), or `null` while unknown. */
    peerIsConsultant: boolean | null;
    /** `Clariva.config.bill_consultants_only` (decision D5). */
    billConsultantsOnly: boolean;
}

export interface GateDecision {
    restricted: boolean;
    reason: GateReason;
}

/** Evaluate top to bottom; the first matching row wins. */
export function decideGate(input: GateInput): GateDecision {
    const { peerId, role, holdExists, balance, rate, peerIsConsultant, billConsultantsOnly } = input;

    // 1. not a DM / peer gone / loading
    if (!peerId) return { restricted: false, reason: "no-peer" };
    // 2. consultants are never gated
    if (role === true) return { restricted: false, reason: "consultant" };
    // 3. unknown role: wait for it
    if (role === null) return { restricted: false, reason: "role-unknown" };

    // D5: only a consultant peer is ever paid. Client-to-client chats (and peers whose role we could not learn)
    // are never restricted.
    if (billConsultantsOnly && peerIsConsultant !== true) return { restricted: false, reason: "peer-not-billable" };

    // 4. an active hold covers chat AND call, whatever the balance
    if (holdExists === true) return { restricted: false, reason: "hold-covers" };
    // 5. unknown hold state never restricts: inside a paid session balance < rate is normal (the hold already
    //    debited it), and the server enforces billing on `initiate` regardless
    if (holdExists === null) return { restricted: false, reason: "hold-unknown" };

    // 6. not enough knowledge
    if (balance === null || rate === null) return { restricted: false, reason: "balance-or-rate-unknown" };

    // rate 0 can never restrict (the consultant has not set a price)
    if (!(rate > 0)) return { restricted: false, reason: "free" };

    // 7. holdExists === false and the balance cannot pay for a new session (compared at 2 decimals)
    if (isLess(balance, rate)) return { restricted: true, reason: "insufficient" };

    // 8. enough credits: composer open
    return { restricted: false, reason: "sufficient" };
}

/** The slice of a peer's wallet row that decides whether a chat with them is billable. */
export interface BillablePeerInfo {
    isConsultant: boolean | null;
    maxCredits: number | null;
}

/**
 * Is a chat with this peer billed at all (dialog, hold, gate)? Decision D5: with `billConsultantsOnly` only when the
 * peer is a consultant with a known price > 0 (an unknown peer never bills). With the flag off, Android's behaviour:
 * every DM peer is billable (the server decides the amount).
 */
export function isBillablePeer(info: BillablePeerInfo | null | undefined, billConsultantsOnly: boolean): boolean {
    if (!billConsultantsOnly) return true;
    return !!info && info.isConsultant === true && info.maxCredits !== null && info.maxCredits > 0;
}
