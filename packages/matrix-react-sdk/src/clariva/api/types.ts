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

/* eslint-disable camelcase */
/* eslint @typescript-eslint/naming-convention: "off" */

/**
 * Wire types of the Clariva Wallet-API, derived from the Android clients
 * (libraries/network/.../wallet/*.kt) and the NestJS controllers. Field names intentionally keep the server's
 * spelling (`Webuddy_name`, `current_hold`, `razorpay_order_id`, ...). All response fields are optional where the
 * server may omit them: Android decodes with `ignoreUnknownKeys` and tolerates missing fields, so do we.
 *
 * Reference: docs/clariva/spec/05 (in the Wallet-API repo: docs/web-client-api-reference-and-security-review.md).
 */

/** DECIMAL columns arrive as strings ("250.00"); a few fields arrive as numbers. Always go through parseAmount(). */
export type Decimal = string | number;

/** `isConsultant` tinyint: 1 = consultant, 0 = normal client (a.k.a. "user" / "member"). */
export type RoleFlag = 0 | 1;

// ───────────────────────────── /v1/auth ─────────────────────────────

export interface ClarivaPublicUser {
    id: string;
    email?: string | null;
    username?: string | null;
    name?: string | null;
    /** Full Matrix user ID, e.g. `@jane:clarivahub.com`. */
    matrixUserId?: string | null;
    isConsultant?: RoleFlag | null;
    isGoogleAccount?: boolean | null;
}

export interface ClarivaAuthResponse {
    /** Clariva JWT (HS256, 30 days). Only used to call `POST /v1/auth/matrix-session`. */
    token: string;
    user: ClarivaPublicUser;
}

export interface ClarivaRegisterRequest {
    email: string;
    password: string;
    /** Display name, mandatory (otherwise Matrix shows the raw localpart). */
    name: string;
    /** `^[a-z0-9][a-z0-9._-]{2,29}$`; becomes `@username:clarivahub.com`. */
    username: string;
    /** MUST always be sent (server validates 0 or 1; omitting it caused the 2026-06 wallet-404 outage). */
    isConsultant: RoleFlag;
}

export interface ClarivaLoginRequest {
    /** Email address OR username. */
    identifier: string;
    password: string;
}

export interface ClarivaGoogleRequest {
    idToken: string;
    /** Omit on the first call so a brand-new user gets `needsRole` instead of a silent default. */
    isConsultant?: RoleFlag;
    /** "signup" turns an already-registered email into a hard error. Omit for sign-in. */
    mode?: "signup";
}

export interface ClarivaGoogleResponse {
    needsRole?: boolean;
    email?: string | null;
    name?: string | null;
    /** The row exists and only its role is missing ("finish setting up" rather than "create your account"). */
    isExisting?: boolean;
    token?: string;
    user?: ClarivaPublicUser;
}

export interface ClarivaAvailability {
    available: boolean;
    reason?: string | null;
}

export interface ClarivaOkResponse {
    ok?: boolean;
}

export interface ClarivaMatrixSessionResponse {
    userId: string;
    accessToken: string;
    deviceId: string;
    /** Server-derived secret-storage passphrase; absent on an API without a configured secret. */
    recoveryPassphrase?: string | null;
}

export interface ClarivaReauthMethod {
    isGoogleAccount: boolean;
}

export interface ClarivaDeactivateRequest {
    matrixUserId: string;
    /** Exactly one proof: password (email account) or a fresh Google ID token (Google account). */
    password?: string;
    googleIdToken?: string;
    /** Always sent explicitly. */
    eraseData: boolean;
}

export interface ClarivaDeactivateResponse {
    deactivated?: boolean;
}

// ───────────────────────────── /v1/users ─────────────────────────────

/**
 * `GET /v1/users/:Webuddy_name` (passwordHash/googleId are stripped server-side).
 * `current_hold` is the spendable WALLET BALANCE (historic name); `max_credits` is a consultant's price per 24 h chat.
 */
export interface WalletUser {
    id?: string;
    Webuddy_name?: string | null;
    matrixUserId?: string | null;
    name?: string | null;
    email?: string | null;
    username?: string | null;
    max_credits?: Decimal | null;
    current_hold?: Decimal | null;
    isConsultant?: RoleFlag | null;
    settings?: unknown;
    createdAt?: string;
    updatedAt?: string;
}

export interface WalletCreateUserRequest {
    name: string;
    Webuddy_name: string;
    isConsultant: RoleFlag;
}

export interface WalletUpdateUserRequest {
    max_credits?: number;
    isConsultant?: RoleFlag;
    /**
     * Free-form per-user JSON (designation, "Last seen and online" choice, ...). The server REPLACES the whole object,
     * so callers always send the merged object (see `WalletStore.updateSettings`).
     */
    settings?: Record<string, unknown>;
}

// ───────────────────────────── /v1/wallet ─────────────────────────────

export interface RechargeRequest {
    /** Webuddy_name == Matrix user ID. */
    userId: string;
    /** Whole INR / credits, 1..100000. */
    amount: number;
}

export interface CreateOrderResponse {
    /** Razorpay public key id for this order's mode (test/live). */
    keyId: string;
    orderId: string;
    amountInPaise: number;
    currency: string;
    transactionId: string | number;
}

export interface VerifyPaymentRequest {
    userId: string;
    transactionId: string | number;
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
}

export interface VerifyPaymentResponse {
    success: boolean;
    /** Number on the first credit, DECIMAL string on the idempotent replay (verify/webhook race). */
    newBalance?: Decimal;
    transactionId?: string | number;
}

export type TransactionSource =
    | "RECHARGE"
    | "HOLD"
    | "HOLD_SETTLED"
    | "REFUND"
    | "REFERRAL"
    | "BONUS"
    | "CREDIT"
    | "DEBIT";

export interface WalletTransaction {
    id?: string;
    userId?: string;
    /** DECIMAL string. */
    amount: string;
    currency?: string;
    /** "CREDIT" | "DEBIT" (and legacy values). */
    type: string;
    /** Business source, see TransactionSource; kept open because the server may add values. */
    source?: TransactionSource | string | null;
    /** "PAID" | "CREATED" | "FAILED" | "PENDING" | ... */
    status: string;
    provider?: string | null;
    providerOrderId?: string | null;
    providerPaymentId?: string | null;
    createdAt?: string | null;
    metaData?: unknown;
}

export interface TransactionHistoryResponse {
    data: WalletTransaction[];
    total?: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

// ───────────────────────────── /v1/pending-holds ─────────────────────────────

export interface InitiateHoldRequest {
    /** The payer: the user who sends the message / places the call (Webuddy_name == Matrix ID). */
    clientId: string;
    /** The payee: the DM peer. The hold amount is the payee's `max_credits`. */
    consultantId: string;
}

export interface HoldExistsResponse {
    exists: boolean;
}

export interface PendingAutoApprovalNotification {
    refundRequestId: number;
    amount: number;
    clientId: string;
    consultantId: string;
}

/**
 * `GET /v1/pending-holds/status`. Bidirectional (either party may ask). The server only ever reports
 * `refund_status` "none" or "requested" because it filters on isRefundActive = 1; see spec 03 §3.6.3.
 */
export interface PendingHoldStatus {
    exists: boolean;
    refund_status?: "none" | "requested" | "approved" | "rejected" | string;
    pendingHoldId?: number | string | null;
    clientId?: string | null;
    consultantId?: string | null;
    amount?: Decimal | null;
    refundRequestId?: number | string | null;
    pendingAutoApprovalNotification?: PendingAutoApprovalNotification | null;
}

// ───────────────────────────── /v1/refund ─────────────────────────────

export interface RefundRequestBody {
    clientId: string;
    consultantId: string;
    pendingHoldId: string;
}

/** There is NO `success` field: any 2xx is success (lesson L10). */
export interface RefundRequestResponse {
    message?: string;
    refundRequestId?: number;
}

export interface ApproveRefundBody {
    refundRequestId: string;
    pendingHoldId: string;
    /** Omit for a full refund; a number 0 < x <= held makes it a partial refund. */
    refundAmount?: number;
}

export interface RejectRefundBody {
    refundRequestId: string;
}

export interface RefundDecisionResponse {
    message?: string;
    amount?: Decimal;
    toConsultant?: Decimal;
    isAutomatic?: boolean;
}

export interface PendingRefundsForConsultantResponse {
    clientIds: string[];
}

export interface ClaimAutoApprovalBody {
    userId: string;
}

export interface ClaimAutoApprovalResponse {
    claimed: boolean;
}

// ───────────────────────────── /v1/calls, /v1/experts ─────────────────────────────

export type CallMediaType = "voice" | "video";

export interface SetCallTypeBody {
    roomId: string;
    callType: CallMediaType;
    callerId?: string;
}

export interface CallTypeResponse {
    roomId?: string | null;
    callType?: CallMediaType | null;
    updatedAt?: string | null;
}

// ─────────────────────── /v1/experts/me/bank-details ───────────────────────
// Consultants only. Authorised by a Bearer token: the Clariva JWT (in memory right after sign-in / sign-up) OR the
// session's Matrix access token (verified by the API with the homeserver's whoami). Whose account it is comes from
// the token, never from the body. Mirrors Android `BankDetails.kt` / the API's `AddMyBankDetailDto`.

/** Body of `POST /v1/experts/me/bank-details`. */
export interface MyBankDetailsBody {
    accountHolderName: string;
    bankName: string;
    /** 9 to 18 digits. */
    accountNumber: string;
    /** `ABCD0123456`, upper case. Looked up server-side: an unknown IFSC is rejected with 400. */
    ifscCode: string;
    /** Optional; omitted rather than sent blank. The API fills it in from the IFSC directory when missing. */
    branchName?: string;
}

/** The saved payout account as the API returns it: never the full account number. */
export interface SavedBankAccount {
    id?: string | null;
    bankName: string;
    accountNumberLast4: string;
    ifscCode: string;
    accountHolderName: string;
    branchName?: string | null;
}

/** `GET /v1/experts/me/bank-details`: `bankDetail` is `null` until a payout account has been saved. */
export interface MyBankAccountResponse {
    bankDetail: SavedBankAccount | null;
}
