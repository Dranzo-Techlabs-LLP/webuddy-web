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

import { clarivaGet, clarivaPatch, clarivaPost, seg, type RequestOptions } from "./http";
import {
    type ApproveRefundBody,
    type CallTypeResponse,
    type ClaimAutoApprovalResponse,
    type CreateOrderResponse,
    type HoldExistsResponse,
    type MyBankAccountResponse,
    type MyBankDetailsBody,
    type PendingHoldStatus,
    type PendingRefundsForConsultantResponse,
    type RefundDecisionResponse,
    type RefundRequestBody,
    type RefundRequestResponse,
    type SavedBankAccount,
    type SetCallTypeBody,
    type TransactionHistoryResponse,
    type VerifyPaymentRequest,
    type VerifyPaymentResponse,
    type WalletCreateUserRequest,
    type WalletUpdateUserRequest,
    type WalletUser,
} from "./types";

/**
 * Thin typed wrapper over the unauthenticated wallet routes. Every identifier is the user's **Matrix user ID**
 * (`Webuddy_name` equals the Matrix ID for every Clariva account). Path segments are URL-encoded here and query
 * values by `URLSearchParams`, so callers pass raw IDs.
 *
 * Business rules (self-heal, caches, gate, hold semantics) live in the stores, not here.
 */
/** Adds `Authorization: Bearer <token>` (the only Wallet-API routes that need one are the `/v1/experts` ones). */
function withBearer(bearer: string, options?: RequestOptions): RequestOptions {
    return { ...options, headers: { ...options?.headers, Authorization: `Bearer ${bearer}` } };
}

export const ClarivaWalletApi = {
    // ─── users ───────────────────────────────────────────────────────────────
    /** Own balance + role, or a peer's rate + role. 404 when the user has no wallet row. */
    getUser: (id: string, options?: RequestOptions): Promise<WalletUser> =>
        clarivaGet(`/v1/users/${seg(id)}`, options),

    /** Idempotent provisioning (also used as the 404 self-heal). `isConsultant` must always be present. */
    createUser: (request: WalletCreateUserRequest, options?: RequestOptions): Promise<WalletUser> =>
        clarivaPost("/v1/users", request, options),

    /** Consultant price (`max_credits`) and, in principle, role. */
    updateUser: (id: string, request: WalletUpdateUserRequest, options?: RequestOptions): Promise<WalletUser> =>
        clarivaPatch(`/v1/users/${seg(id)}`, request, options),

    // ─── wallet ──────────────────────────────────────────────────────────────
    /** Step 1 of a recharge: create a Razorpay order for `amount` whole INR. */
    createOrder: (userId: string, amount: number, options?: RequestOptions): Promise<CreateOrderResponse> =>
        clarivaPost("/v1/wallet/recharge", { userId, amount }, options),

    /** Step 2: verify the Razorpay signature server-side and credit the wallet (idempotent). */
    verifyPayment: (request: VerifyPaymentRequest, options?: RequestOptions): Promise<VerifyPaymentResponse> =>
        clarivaPost("/v1/wallet/verify", request, options),

    /** Ledger, newest first. Send integers: page >= 1, pageSize 10..50 (the server does not validate). */
    getHistory: (
        userId: string,
        page: number,
        pageSize: number,
        options?: RequestOptions,
    ): Promise<TransactionHistoryResponse> =>
        clarivaGet("/v1/wallet/history", { ...options, query: { userId, page, pageSize } }),

    // ─── holds ───────────────────────────────────────────────────────────────
    /**
     * Create / re-use the 24 h hold for (payer, payee). Idempotent inside the window. Errors: 400 insufficient
     * credits, 403 payer is a consultant, 404 payee/payer unknown.
     */
    initiateHold: (clientId: string, consultantId: string, options?: RequestOptions): Promise<unknown> =>
        clarivaPost("/v1/pending-holds/initiate", { clientId, consultantId }, options),

    /** "Is the chat paid for right now?" — exactly the reuse condition of `initiateHold`. */
    holdExists: (clientId: string, consultantId: string, options?: RequestOptions): Promise<HoldExistsResponse> =>
        clarivaGet("/v1/pending-holds/exists", { ...options, query: { clientId, consultantId } }),

    /** Bidirectional hold + refund state for the pair; polled while a DM is open. */
    holdStatus: (clientId: string, consultantId: string, options?: RequestOptions): Promise<PendingHoldStatus> =>
        clarivaGet("/v1/pending-holds/status", { ...options, query: { clientId, consultantId } }),

    // ─── refunds ─────────────────────────────────────────────────────────────
    requestRefund: (body: RefundRequestBody, options?: RequestOptions): Promise<RefundRequestResponse> =>
        clarivaPost("/v1/refund/request", body, options),

    approveRefund: (body: ApproveRefundBody, options?: RequestOptions): Promise<RefundDecisionResponse> =>
        clarivaPost("/v1/refund/approve", body, options),

    rejectRefund: (refundRequestId: string, options?: RequestOptions): Promise<RefundDecisionResponse> =>
        clarivaPost("/v1/refund/reject", { refundRequestId }, options),

    /** Bulk lookup for the consultant's room-list pills: clients with an open refund request. */
    pendingRefundsForConsultant: (
        consultantId: string,
        options?: RequestOptions,
    ): Promise<PendingRefundsForConsultantResponse> =>
        clarivaGet("/v1/refund/pending-for-consultant", { ...options, query: { consultantId } }),

    /** Atomic claim for announcing an auto-approved refund; `claimed: true` for exactly one caller. */
    claimAutoApprovalNotification: (
        refundRequestId: number | string,
        userId: string,
        options?: RequestOptions,
    ): Promise<ClaimAutoApprovalResponse> =>
        clarivaPost(`/v1/refund/auto-approval-claim/${seg(String(refundRequestId))}`, { userId }, options),

    // ─── calls ───────────────────────────────────────────────────────────────
    /** Record the caller's voice/video choice for the call about to start in `roomId`. Never block a call on it. */
    setCallType: (body: SetCallTypeBody, options?: RequestOptions): Promise<CallTypeResponse> =>
        clarivaPost("/v1/calls/type", body, options),

    /** The media type of the latest call in `roomId`, or `callType: null` when unknown. */
    getCallType: (roomId: string, options?: RequestOptions): Promise<CallTypeResponse> =>
        clarivaGet("/v1/calls/type", { ...options, query: { roomId } }),

    // ─── consultant payout details ───────────────────────────────────────────
    /**
     * The caller's active payout account, masked (last 4 digits). `bearer` is the Clariva JWT or the session's
     * Matrix access token (Android: `getMyBankDetails(bearer)`).
     */
    getMyBankDetails: (bearer: string, options?: RequestOptions): Promise<MyBankAccountResponse> =>
        clarivaGet("/v1/experts/me/bank-details", withBearer(bearer, options)),

    /** Save (replace) the caller's payout account. Consultants only; 400 with the API's reason for a bad IFSC. */
    saveMyBankDetails: (
        bearer: string,
        body: MyBankDetailsBody,
        options?: RequestOptions,
    ): Promise<SavedBankAccount> => clarivaPost("/v1/experts/me/bank-details", body, withBearer(bearer, options)),
};
