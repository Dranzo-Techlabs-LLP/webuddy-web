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

import { TypedEventEmitter } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { ClarivaHttpError } from "../api/http";
import { type ClarivaWalletApi } from "../api/wallet";
import { type PendingAutoApprovalNotification, type PendingHoldStatus } from "../api/types";
import { parseAmount, round2 } from "../money";
import { chatStrings } from "../strings/chat";
import {
    REFUND_BODY_APPROVED_FULL,
    REFUND_BODY_AUTO_APPROVED,
    REFUND_BODY_REJECTED,
    REFUND_BODY_REQUESTED,
    buildRefundMessage,
    refundBodyApprovedPartial,
    type RefundEventKind,
    type RefundMessageContent,
} from "./messages";

/**
 * Per-open-DM hold / refund state machine. Port of the poll loop, the three actions and the 24 h auto-approval
 * claim protocol of Android's `MessagesPresenter` (docs/clariva/spec/03 §3.6.4, §3.7), with these deliberate
 * differences (spec §6.4 / §7.2):
 *
 *  - the claim protocol has its OWN "attempted" set (Android shares one with the consultant branch, which silently
 *    disables the consultant's claim) and an id is only marked attempted after a DEFINITIVE answer, so a network
 *    error or a 5xx is retried on the next tick;
 *  - failures surface the SERVER's message ("Refund is not awaiting a decision (current status: approved).") instead
 *    of a generic "Error";
 *  - a poll that was already in flight when an action completed cannot resurrect the old state (epoch guard);
 *  - decision D5: with `bill_consultants_only` the refund UI is only offered when the payee is really a consultant.
 *
 * The controller is framework-free (no React, no Matrix client): everything it needs is injected, which keeps the
 * protocol unit-testable with fakes and fake timers. `registry.ts` wires the real dependencies.
 */

export type RefundApi = Pick<
    typeof ClarivaWalletApi,
    "holdStatus" | "requestRefund" | "approveRefund" | "rejectRefund" | "claimAutoApprovalNotification"
>;

export interface RefundControllerDeps {
    api: RefundApi;
    /** Own Matrix user ID (also the identifier sent to the Wallet-API). */
    myUserId: string;
    /**
     * Other identifiers the server may know me by (my `Webuddy_name`; equal to the Matrix ID for every Clariva
     * account, but a legacy account may differ). Read lazily: it is only learned after the first balance load.
     */
    getOwnAliases: () => ReadonlyArray<string | null | undefined>;
    /** The other party of this 1:1 room. */
    peerId: string;
    /** Send `content` into the DM's MAIN timeline as a plain event (no composer, no gate, no hold logic). */
    sendMessage: (content: RefundMessageContent) => Promise<unknown>;
    /** Is `userId` a consultant? `null` = unknown (fail open). Only asked when `billConsultantsOnly()` is true. */
    isConsultant: (userId: string) => Promise<boolean | null>;
    /** Re-read the consultant's list pills right after approve/reject so the pill disappears at once. */
    refreshPendingRefunds: () => Promise<unknown>;
    getPollIntervalMs: () => number;
    /** Decision D5 switch (`Clariva.config.bill_consultants_only`). */
    billConsultantsOnly: () => boolean;
}

export interface RefundState {
    /** `status.consultantId` is me (or my Webuddy_name). Set on EVERY successful poll, even when no hold exists. */
    isConsultantInThisRoom: boolean;
    /** `none` | `requested` (| legacy `approved`/`rejected`, or a transient LOCAL `approved`/`rejected`), `null` = no hold. */
    refundStatus: string | null;
    pendingHoldId: string | null;
    refundRequestId: string | null;
    /** The held amount in credits (the status poll's `amount`), `null` when unknown. */
    refundHeldAmount: number | null;
    /** A live hold with an open refund window exists (and the refund UI is allowed for this pair, D5). */
    isRefundButtonVisible: boolean;
    /** The single in-flight guard shared by request / approve / reject. */
    isRequestInProgress: boolean;
}

export const INITIAL_REFUND_STATE: Readonly<RefundState> = Object.freeze({
    isConsultantInThisRoom: false,
    refundStatus: null,
    pendingHoldId: null,
    refundRequestId: null,
    refundHeldAmount: null,
    isRefundButtonVisible: false,
    isRequestInProgress: false,
});

/** Client: "Request refund" header button (spec U3). */
export function canRequestRefund(state: RefundState): boolean {
    return (
        state.isRefundButtonVisible &&
        !state.isConsultantInThisRoom &&
        (state.refundStatus === "none" || state.refundStatus === null)
    );
}

/** Consultant: the "Refund request" banner (spec U4). */
export function showRefundBanner(state: RefundState): boolean {
    return state.isConsultantInThisRoom && state.refundStatus === "requested";
}

export type RefundActionResult =
    /** The API accepted the action. `message` is the toast text. */
    | { ok: true; message: string }
    /** The API refused / the call failed. `message` is the server's own text when it sent one. */
    | { ok: false; message: string; ignored?: false }
    /** Nothing was done: another action is in flight, or a precondition (hold/request id) is missing. */
    | { ok: false; message: ""; ignored: true };

const IGNORED: RefundActionResult = { ok: false, message: "", ignored: true };

export interface RefundToast {
    id: number;
    text: string;
    kind: "success" | "error";
}

export enum RefundControllerEvent {
    /** `state` changed. */
    Update = "Clariva.Refund.update",
    /** A chat-local toast should be shown (spec U7). */
    Toast = "Clariva.Refund.toast",
}

type EventHandlerMap = {
    [RefundControllerEvent.Update]: (state: RefundState) => void;
    [RefundControllerEvent.Toast]: (toast: RefundToast) => void;
};

/** The text to show for a failed call: the server's message when it sent one, otherwise the generic `Error`. */
export function refundErrorMessage(e: unknown): string {
    if (e instanceof ClarivaHttpError && e.serverMessage) return e.serverMessage;
    return chatStrings.refundToastError;
}

/** A claim answer is DEFINITIVE unless the request never got an answer (offline, timeout) or the server failed. */
function isDefinitiveFailure(e: unknown): boolean {
    return e instanceof ClarivaHttpError && !e.isNetwork && !e.isServerError;
}

export class RefundController extends TypedEventEmitter<RefundControllerEvent, EventHandlerMap> {
    private stateInternal: RefundState = { ...INITIAL_REFUND_STATE };
    /** The row the last poll described: ids to send back to the server (they may differ from me/peer for a legacy account). */
    private holdClientId: string | null = null;
    private holdConsultantId: string | null = null;

    private started = false;
    private disposed = false;
    private cycleRunning = false;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private abort: AbortController | undefined;

    /** Bumped whenever an action changes the state; a poll that started before that must not overwrite it. */
    private epoch = 0;
    private toastSeq = 0;

    /** Refund-request ids whose auto-approval claim got a definitive answer. SEPARATE from anything else (spec §3.7). */
    private readonly claimAttempted = new Set<string>();

    public constructor(private readonly deps: RefundControllerDeps) {
        super();
    }

    public get state(): RefundState {
        return this.stateInternal;
    }

    public get peerId(): string {
        return this.deps.peerId;
    }

    // ── lifecycle ────────────────────────────────────────────────────────────

    /** Begin polling: immediately, then every `hold_status_ms`, paused while the tab is hidden. Idempotent. */
    public start(): void {
        if (this.started || this.disposed) return;
        this.started = true;
        if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisibilityChange);
        if (!this.isHidden()) void this.runCycle();
    }

    /** Stop polling and cancel anything in flight. In-flight ACTIONS are not cancelled: they must run to completion. */
    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibilityChange);
        this.clearTimer();
        this.abort?.abort();
        this.removeAllListeners();
    }

    /** Poll right now (outside the schedule). Mostly for tests and for "refresh after an external hint". */
    public pollNow(): Promise<void> {
        return this.pollOnce();
    }

    private isHidden(): boolean {
        return typeof document !== "undefined" && document.hidden === true;
    }

    private clearTimer(): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
    }

    private readonly onVisibilityChange = (): void => {
        if (this.disposed) return;
        this.clearTimer();
        if (!this.isHidden()) void this.runCycle(); // back in the foreground: refresh right away
    };

    /** One poll, then the next after `hold_status_ms` (a delay AFTER completion, like Android: slow rounds cannot pile up). */
    private async runCycle(): Promise<void> {
        if (this.disposed || this.cycleRunning || this.isHidden()) return;
        this.cycleRunning = true;
        this.clearTimer();
        try {
            await this.pollOnce();
        } finally {
            this.cycleRunning = false;
        }
        if (this.disposed || this.isHidden()) return;
        this.clearTimer();
        this.timer = setTimeout(() => void this.runCycle(), this.deps.getPollIntervalMs());
    }

    // ── identity ─────────────────────────────────────────────────────────────

    private isMine(userId: string | null | undefined): boolean {
        if (!userId) return false;
        if (userId === this.deps.myUserId) return true;
        return this.deps.getOwnAliases().some((alias) => !!alias && alias === userId);
    }

    // ── state ────────────────────────────────────────────────────────────────

    private setState(patch: Partial<RefundState>): void {
        const next = { ...this.stateInternal, ...patch };
        const changed = (Object.keys(next) as Array<keyof RefundState>).some((k) => next[k] !== this.stateInternal[k]);
        if (!changed) return;
        this.stateInternal = next;
        this.emit(RefundControllerEvent.Update, next);
    }

    private emitToast(text: string, kind: RefundToast["kind"]): void {
        this.emit(RefundControllerEvent.Toast, { id: ++this.toastSeq, text, kind });
    }

    // ── poll (spec 03 §3.6.4) ────────────────────────────────────────────────

    private async pollOnce(): Promise<void> {
        if (this.disposed) return;
        const { api, myUserId, peerId } = this.deps;
        const epochAtStart = this.epoch;
        this.abort = new AbortController();
        let status: PendingHoldStatus;
        try {
            status = await api.holdStatus(myUserId, peerId, { signal: this.abort.signal });
        } catch (e) {
            // Errors are swallowed and the previous UI state is KEPT (a blip must not flash the banner away).
            logger.debug("Clariva refund: status poll failed", e);
            return;
        }
        if (this.disposed || !status) return;

        // 1. hold / refund state. Resolve the D5 role check first (it awaits), then apply synchronously.
        const allowed = await this.refundUiAllowed(status);
        if (this.disposed) return;
        if (this.epoch === epochAtStart) {
            this.applyStatus(status, allowed);
        } else {
            // An action completed while this poll was in flight: its local result is newer than this response.
            // The next poll (<= hold_status_ms) reconciles.
            logger.debug("Clariva refund: dropping a poll response that raced an action");
        }

        // 2. the 24 h auto-approval announcement (independent of the hold: the hold is deleted by then)
        await this.handleAutoApproval(status.pendingAutoApprovalNotification);
    }

    /** D5: only offer refunds when the payee of the hold is really a consultant. Unknown fails open. */
    private async refundUiAllowed(status: PendingHoldStatus): Promise<boolean> {
        if (!status.exists || !status.consultantId || !this.deps.billConsultantsOnly()) return true;
        try {
            return (await this.deps.isConsultant(status.consultantId)) !== false;
        } catch {
            return true;
        }
    }

    private applyStatus(status: PendingHoldStatus, allowed: boolean): void {
        // Set on EVERY poll, even when no hold exists (`consultantId` is then null -> false).
        const isConsultantInThisRoom = this.isMine(status.consultantId);
        if (status.exists && allowed) {
            const holdId = status.pendingHoldId;
            const requestId = status.refundRequestId;
            this.holdClientId = status.clientId ?? null;
            this.holdConsultantId = status.consultantId ?? null;
            this.setState({
                isConsultantInThisRoom,
                refundStatus: status.refund_status ?? "none",
                pendingHoldId: holdId === null || holdId === undefined ? null : String(holdId),
                refundRequestId: requestId === null || requestId === undefined ? null : String(requestId),
                refundHeldAmount: parseAmount(status.amount),
                isRefundButtonVisible: true,
            });
        } else {
            this.holdClientId = null;
            this.holdConsultantId = null;
            this.setState({
                isConsultantInThisRoom: status.exists ? isConsultantInThisRoom : false,
                refundStatus: null,
                pendingHoldId: null,
                refundRequestId: null,
                refundHeldAmount: null,
                isRefundButtonVisible: false,
            });
        }
    }

    // ── 24 h auto-approval + atomic claim (spec 03 §3.7) ─────────────────────

    private async handleAutoApproval(n: PendingAutoApprovalNotification | null | undefined): Promise<void> {
        if (!n || n.refundRequestId === null || n.refundRequestId === undefined) return;
        const id = String(n.refundRequestId);
        if (this.claimAttempted.has(id)) return; // do not hit the claim endpoint every tick (L12)

        // Use whichever of my identifiers the row carries (they are equal for every Clariva account).
        const userId = [n.clientId, n.consultantId].find((candidate) => this.isMine(candidate)) ?? this.deps.myUserId;
        let claimed: boolean;
        try {
            const res = await this.deps.api.claimAutoApprovalNotification(n.refundRequestId, userId);
            claimed = res?.claimed === true;
        } catch (e) {
            if (isDefinitiveFailure(e)) {
                this.claimAttempted.add(id); // a 4xx will never succeed: stop asking
            } // else: network / timeout / 5xx -> not definitive, retry on the next tick
            logger.debug(`Clariva refund: auto-approval claim for ${id} failed`, e);
            return;
        }
        this.claimAttempted.add(id);
        // Exactly one caller (across both parties and all devices) wins; only the winner announces — even when the
        // chat was closed while the claim was in flight (the claim is already spent, nobody else would announce it).
        if (claimed) {
            this.announce(buildRefundMessage("auto_approved", REFUND_BODY_AUTO_APPROVED, n.refundRequestId));
        }
    }

    // ── actions ──────────────────────────────────────────────────────────────

    /** Client: ask for a refund of the live hold. */
    public async requestRefund(): Promise<RefundActionResult> {
        const { pendingHoldId } = this.stateInternal;
        if (this.stateInternal.isRequestInProgress || pendingHoldId === null) return IGNORED;
        this.setState({ isRequestInProgress: true });
        try {
            const res = await this.deps.api.requestRefund({
                clientId: this.holdClientId ?? this.deps.myUserId,
                consultantId: this.holdConsultantId ?? this.deps.peerId,
                pendingHoldId,
            });
            // Any 2xx is success: the response has NO `success` field (L10).
            this.epoch++;
            this.setState({ refundStatus: "requested" });
            this.emitToast(chatStrings.refundToastRequested, "success");
            this.announce(buildRefundMessage("requested", REFUND_BODY_REQUESTED, res?.refundRequestId));
            return { ok: true, message: chatStrings.refundToastRequested };
        } catch (e) {
            return this.failed(e);
        } finally {
            this.setState({ isRequestInProgress: false });
        }
    }

    /**
     * Consultant: approve. `refundAmount` undefined = FULL refund (the field is then omitted from the request); a
     * number is a PARTIAL refund, rounded to 2 dp like the server.
     */
    public async approve(refundAmount?: number): Promise<RefundActionResult> {
        const { refundRequestId, pendingHoldId } = this.stateInternal;
        if (this.stateInternal.isRequestInProgress || refundRequestId === null || pendingHoldId === null)
            return IGNORED;
        let amount: number | undefined;
        if (refundAmount !== undefined) {
            amount = round2(refundAmount);
            if (!Number.isFinite(amount) || amount <= 0) {
                return { ok: false, message: chatStrings.refundAmountErrorNoHeld };
            }
        }
        this.setState({ isRequestInProgress: true });
        try {
            const res = await this.deps.api.approveRefund({
                refundRequestId,
                pendingHoldId,
                ...(amount !== undefined ? { refundAmount: amount } : {}),
            });
            this.epoch++;
            this.setState({ refundStatus: "approved", isRefundButtonVisible: false });
            this.emitToast(chatStrings.refundToastApproved, "success");
            void this.refreshPills();
            // The partial text states what was REALLY returned (`response.amount ?? refundAmount`).
            const body =
                amount === undefined
                    ? REFUND_BODY_APPROVED_FULL
                    : refundBodyApprovedPartial(parseAmount(res?.amount) ?? amount);
            this.announce(buildRefundMessage("approved", body, refundRequestId));
            return { ok: true, message: chatStrings.refundToastApproved };
        } catch (e) {
            return this.failed(e);
        } finally {
            this.setState({ isRequestInProgress: false });
        }
    }

    /** Consultant: reject (the held amount is paid out at the end of the hold window). */
    public async reject(): Promise<RefundActionResult> {
        const { refundRequestId } = this.stateInternal;
        if (this.stateInternal.isRequestInProgress || refundRequestId === null) return IGNORED;
        this.setState({ isRequestInProgress: true });
        try {
            await this.deps.api.rejectRefund(refundRequestId);
            this.epoch++;
            this.setState({ refundStatus: "rejected" });
            this.emitToast(chatStrings.refundToastRejected, "success");
            void this.refreshPills();
            this.announce(buildRefundMessage("rejected", REFUND_BODY_REJECTED, refundRequestId));
            return { ok: true, message: chatStrings.refundToastRejected };
        } catch (e) {
            return this.failed(e);
        } finally {
            this.setState({ isRequestInProgress: false });
        }
    }

    private failed(e: unknown): RefundActionResult {
        const message = refundErrorMessage(e);
        logger.warn("Clariva refund: action failed", e);
        this.emitToast(message, "error");
        return { ok: false, message };
    }

    private async refreshPills(): Promise<void> {
        try {
            await this.deps.refreshPendingRefunds();
        } catch (e) {
            logger.debug("Clariva refund: failed to refresh pending refunds", e);
        }
    }

    /** Best-effort: the refund itself is NEVER rolled back when the announcement fails (spec §5.1). */
    private announce(content: RefundMessageContent): void {
        const kind: RefundEventKind = content["com.clariva.refund"].event;
        try {
            Promise.resolve(this.deps.sendMessage(content)).catch((e) => {
                logger.warn(`Clariva refund: could not announce '${kind}' in the room`, e);
            });
        } catch (e) {
            logger.warn(`Clariva refund: could not announce '${kind}' in the room`, e);
        }
    }
}
