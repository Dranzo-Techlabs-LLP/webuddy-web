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

import { getClarivaConfig } from "../config";
import { ClarivaHttpError } from "../api/http";
import { ClarivaWalletApi } from "../api/wallet";
import { parseAmount } from "../money";
import {
    DEFAULT_PRESENCE_PRIVACY,
    designationOf,
    mergeSettings,
    normalizeDesignation,
    presencePrivacyOf,
    presencePrivacyToJson,
    samePresencePrivacy,
    SETTINGS_DESIGNATION_KEY,
    SETTINGS_PRESENCE_PRIVACY_KEY,
    type PresencePrivacy,
} from "../profile/settings";
import {
    type CreateOrderResponse,
    type TransactionHistoryResponse,
    type VerifyPaymentRequest,
    type VerifyPaymentResponse,
    type WalletUser,
} from "../api/types";

/**
 * The web port of Android's `WalletService` (libraries/network/.../wallet/WalletService.kt): the single source of
 * truth for the signed-in user's balance, role, own consultant price, and the caches that the chat gate, the room
 * list and the consultant refund pills read. The behaviour — including every "lesson" recorded in the Android
 * commit history — is specified in docs/clariva/spec/02 §3 and spec/03 §3.8 / §3.11:
 *
 *  - L1/L5  unknown (role, hold, balance, rate) is `null`, never `false`/`0`; callers must fail open.
 *  - L2     a failed hold re-check must not leave a stale cached `false` behind (the *caller* assigns the null).
 *  - L8     looking up a chat PEER must never touch the LOCAL user's own `maxCredits`.
 *  - L9     balance/price are only overwritten by a successfully parsed value (no fake `0`/`100` fallbacks);
 *           everything is flushed when the active user changes; a 404 is self-healed once.
 *  - L7     polling never goes faster than the configured floor and pauses while the tab is hidden.
 *
 * Identifiers: every wallet call uses the Matrix user ID (== `Webuddy_name` for every Clariva account).
 */

export enum WalletStoreEvent {
    /** Balance, role, own price, or load state changed. */
    Update = "Clariva.Wallet.update",
    /** The consultant's set of clients with an open refund request changed. */
    PendingRefunds = "Clariva.Wallet.pendingRefunds",
    /** A peer's wallet row (role, price, designation, "Last seen" choice) was (re)loaded and changed. */
    Peer = "Clariva.Wallet.peer",
}

type EmittedEvents = WalletStoreEvent;
type EventHandlerMap = {
    [WalletStoreEvent.Update]: () => void;
    [WalletStoreEvent.PendingRefunds]: (clientIds: ReadonlySet<string>) => void;
    [WalletStoreEvent.Peer]: (peerId: string) => void;
};

/** What the wallet knows about someone else (a chat peer). `null` fields mean "unknown". */
export interface PeerWalletInfo {
    /** The peer's price per 24 h chat (`max_credits`). Only meaningful when `isConsultant === true`. */
    maxCredits: number | null;
    isConsultant: boolean | null;
    /**
     * The peer's designation from their `settings` (`null` = none set, the UI shows the default "Consultant"). Only
     * meaningful when `isConsultant === true`; `undefined` = not looked up with settings yet.
     */
    designation?: string | null;
    /** The peer's "Last seen and online" choice; `undefined` = unknown, and their presence stays hidden (fail closed). */
    presencePrivacy?: PresencePrivacy;
    fetchedAt: number;
}

export type HoldResult =
    | { ok: true; skipped: boolean }
    | { ok: false; status: number; message: string; insufficientCredits: boolean; isNetwork: boolean };

export interface WalletSnapshot {
    userId: string | null;
    credits: number | null;
    maxCredits: number | null;
    isConsultant: boolean | null;
    /** True once the first balance fetch succeeded. */
    loaded: boolean;
    /** CLARIVA(wallet UI): the latest balance fetch failed (the last good values are kept); cleared by the next success. */
    balanceFailed?: boolean;
    /** My designation (consultants), `null` when none is set or not loaded yet. */
    designation?: string | null;
    /** My "Last seen and online" choice, `null` until the first successful load. */
    presencePrivacy?: PresencePrivacy | null;
}

const holdKey = (me: string, peer: string): string => `${me}|${peer}`;

/** Did anything the UI shows about a peer change (role, price, designation, "Last seen" choice)? */
function samePeerProfile(a: PeerWalletInfo, b: PeerWalletInfo): boolean {
    if (a.maxCredits !== b.maxCredits || a.isConsultant !== b.isConsultant) return false;
    if ((a.designation ?? null) !== (b.designation ?? null)) return false;
    if ((a.presencePrivacy === undefined) !== (b.presencePrivacy === undefined)) return false;
    return samePresencePrivacy(a.presencePrivacy ?? DEFAULT_PRESENCE_PRIVACY, b.presencePrivacy ?? DEFAULT_PRESENCE_PRIVACY);
}

/** After a 404 for a peer (not a Clariva user, e.g. a bridge or bot) do not ask again for this long. */
const PEER_NOT_FOUND_BACKOFF_MS = 5 * 60_000;

export class WalletStore extends TypedEventEmitter<EmittedEvents, EventHandlerMap> {
    private static internalInstance: WalletStore | undefined;

    public static get instance(): WalletStore {
        if (!WalletStore.internalInstance) WalletStore.internalInstance = new WalletStore();
        return WalletStore.internalInstance;
    }

    /** Test helper: drop the singleton (and its timers). */
    public static resetForTests(): void {
        WalletStore.internalInstance?.stop();
        WalletStore.internalInstance = undefined;
    }

    // ── state ────────────────────────────────────────────────────────────────
    private userIdInternal: string | null = null;
    private creditsInternal: number | null = null;
    private maxCreditsInternal: number | null = null;
    private isConsultantInternal: boolean | null = null;
    private designationInternal: string | null = null;
    private presencePrivacyInternal: PresencePrivacy | null = null;
    private webuddyNameInternal: string | null = null;
    private pendingRefundClientsInternal: ReadonlySet<string> = new Set();
    private loadedInternal = false;
    private balanceFailedInternal = false;
    private ensureAttempted = false;

    // ── caches (flushed on user change / stop) ──────────────────────────────
    private readonly peers = new Map<string, PeerWalletInfo>();
    private readonly peerInFlight = new Map<string, Promise<PeerWalletInfo | null>>();
    private readonly peerNotFoundUntil = new Map<string, number>();
    private readonly holdExistsCache = new Map<string, boolean>();
    private readonly holdInFlight = new Map<string, Promise<HoldResult>>();
    private balanceInFlight: Promise<void> | null = null;
    private refundsInFlight: Promise<void> | null = null;

    // ── polling ──────────────────────────────────────────────────────────────
    private balanceTimer: ReturnType<typeof setInterval> | undefined;
    private pillsTimer: ReturnType<typeof setInterval> | undefined;
    private visibilityHandlerInstalled = false;

    private constructor() {
        super();
    }

    // ── read access ──────────────────────────────────────────────────────────

    public get userId(): string | null {
        return this.userIdInternal;
    }

    /** Spendable wallet balance (`current_hold`), or `null` while unknown. */
    public get credits(): number | null {
        return this.creditsInternal;
    }

    /** The signed-in consultant's own price per chat (`max_credits`), or `null` while unknown. */
    public get maxCredits(): number | null {
        return this.maxCreditsInternal;
    }

    /** `true` consultant · `false` client · `null` unknown (callers must NOT gate on unknown). */
    public get isConsultant(): boolean | null {
        return this.isConsultantInternal;
    }

    /**
     * The server's own identifier for the signed-in user (`Webuddy_name`), once seen. It equals the Matrix ID for
     * every Clariva-provisioned account; refund role detection compares against both (spec 03 §4).
     */
    public get webuddyName(): string | null {
        return this.webuddyNameInternal;
    }

    public get pendingRefundClients(): ReadonlySet<string> {
        return this.pendingRefundClientsInternal;
    }

    public get loaded(): boolean {
        return this.loadedInternal;
    }

    public getSnapshot(): WalletSnapshot {
        return {
            userId: this.userIdInternal,
            credits: this.creditsInternal,
            maxCredits: this.maxCreditsInternal,
            isConsultant: this.isConsultantInternal,
            loaded: this.loadedInternal,
            balanceFailed: this.balanceFailedInternal,
            designation: this.designationInternal,
            presencePrivacy: this.presencePrivacyInternal,
        };
    }

    // ── lifecycle ────────────────────────────────────────────────────────────

    /**
     * Begin tracking `userId` (the Matrix user ID). Flushes everything when the user differs from the previous one
     * (B6: otherwise the previous account's balance/role leaks into the new session), seeds the role from the
     * login response when given, kicks the first balance load and starts polling.
     */
    public start(userId: string, seed?: { isConsultant?: boolean | null }): void {
        if (this.userIdInternal !== null && this.userIdInternal !== userId) {
            logger.debug(`Clariva wallet: active user changed (${this.userIdInternal} -> ${userId}); flushing`);
            this.flush();
        }
        this.userIdInternal = userId;
        if (seed?.isConsultant === true || seed?.isConsultant === false) {
            this.isConsultantInternal = seed.isConsultant;
        }
        this.emit(WalletStoreEvent.Update);
        this.installVisibilityHandler();
        this.syncTimers();
        void this.refreshBalance();
        if (this.isConsultantInternal === true) void this.refreshPendingRefunds();
    }

    /** Sign-out / account switch: stop timers and forget everything. */
    public stop(): void {
        this.clearTimers();
        this.removeVisibilityHandler();
        this.flush();
        this.userIdInternal = null;
        this.emit(WalletStoreEvent.Update);
    }

    private flush(): void {
        this.creditsInternal = null;
        this.maxCreditsInternal = null;
        this.isConsultantInternal = null;
        this.designationInternal = null;
        this.presencePrivacyInternal = null;
        this.webuddyNameInternal = null;
        this.loadedInternal = false;
        this.balanceFailedInternal = false;
        this.ensureAttempted = false;
        this.pendingRefundClientsInternal = new Set();
        this.peers.clear();
        this.peerInFlight.clear();
        this.peerNotFoundUntil.clear();
        this.holdExistsCache.clear();
        this.holdInFlight.clear();
        this.balanceInFlight = null;
        this.refundsInFlight = null;
    }

    // ── own balance / role ───────────────────────────────────────────────────

    /**
     * Refresh balance, role and own price from `GET /v1/users/{me}`. Single-flight (a second caller joins the
     * running request). Overwrites a field only when it parses (L9); on failure the previous values stay and the
     * store reports "unknown" rather than inventing numbers. A 404 triggers one provisioning self-heal + retry.
     */
    public refreshBalance(): Promise<void> {
        const me = this.userIdInternal;
        if (!me) return Promise.resolve();
        if (this.balanceInFlight) return this.balanceInFlight;

        const run = async (): Promise<void> => {
            try {
                let user: WalletUser;
                try {
                    user = await ClarivaWalletApi.getUser(me);
                } catch (e) {
                    if (!(e instanceof ClarivaHttpError) || !e.isNotFound) throw e;
                    logger.warn(`Clariva wallet: 404 for ${me}; attempting one-time provisioning`);
                    if (!(await this.ensureWalletUserExists())) throw e;
                    user = await ClarivaWalletApi.getUser(me);
                }
                if (this.userIdInternal !== me) return; // the user changed while we were waiting
                const wasFailed = this.balanceFailedInternal;
                this.balanceFailedInternal = false;
                this.applyOwnUser(user);
                if (wasFailed) this.emit(WalletStoreEvent.Update);
            } catch (e) {
                logger.warn("Clariva wallet: failed to refresh balance", e);
                if (this.userIdInternal === me && !this.balanceFailedInternal) {
                    this.balanceFailedInternal = true; // the wallet UI shows "Balance unavailable" + Retry instead of an invented 0
                    this.emit(WalletStoreEvent.Update);
                }
            } finally {
                this.balanceInFlight = null;
            }
        };
        this.balanceInFlight = run();
        return this.balanceInFlight;
    }

    private applyOwnUser(user: WalletUser): void {
        let changed = false;
        if (typeof user.Webuddy_name === "string" && user.Webuddy_name) this.webuddyNameInternal = user.Webuddy_name;
        const credits = parseAmount(user.current_hold);
        if (credits !== null && credits !== this.creditsInternal) {
            this.creditsInternal = credits;
            changed = true;
        }
        const price = parseAmount(user.max_credits);
        if (price !== null && price !== this.maxCreditsInternal) {
            this.maxCreditsInternal = price;
            changed = true;
        }
        // No designation in the record is a real value ("none"), so it always overwrites (Android `refreshBalance`).
        const designation = designationOf(user.settings);
        if (designation !== this.designationInternal) {
            this.designationInternal = designation;
            changed = true;
        }
        const privacy = presencePrivacyOf(user.settings);
        if (!this.presencePrivacyInternal || !samePresencePrivacy(privacy, this.presencePrivacyInternal)) {
            this.presencePrivacyInternal = privacy;
            changed = true;
        }
        if (user.isConsultant === 0 || user.isConsultant === 1) {
            const role = user.isConsultant === 1;
            if (role !== this.isConsultantInternal) {
                this.isConsultantInternal = role;
                changed = true;
                this.syncTimers();
                // the role may only now have become known: load the consultant's refund pills right away
                if (role) void this.refreshPendingRefunds();
                if (!role && this.pendingRefundClientsInternal.size > 0) {
                    this.pendingRefundClientsInternal = new Set();
                    this.emit(WalletStoreEvent.PendingRefunds, this.pendingRefundClientsInternal);
                }
            }
        }
        // Role/balance may have *just* become known for the first time, and `loaded` is part of the snapshot.
        if (credits !== null && !this.loadedInternal) {
            this.loadedInternal = true;
            changed = true;
        }
        if (changed) this.emit(WalletStoreEvent.Update);
    }

    /**
     * One-time provisioning self-heal for a missing wallet row (the 2026-06 outage: `POST /v1/users` without
     * `isConsultant` was rejected and the row was never created). The server's POST is idempotent for existing
     * rows but, for an unknown Matrix ID, creates an orphan row and a second Matrix account — so it is attempted at
     * most once per session and its answer is only trusted when `matrixUserId` matches ours.
     */
    public async ensureWalletUserExists(): Promise<boolean> {
        const me = this.userIdInternal;
        if (!me || this.ensureAttempted) return false;
        this.ensureAttempted = true;
        try {
            const created = await ClarivaWalletApi.createUser({
                name: me,
                Webuddy_name: me,
                // ALWAYS serialised: the server requires 0 or 1.
                isConsultant: this.isConsultantInternal === true ? 1 : 0,
            });
            if (created.matrixUserId && created.matrixUserId !== me) {
                logger.error(
                    `Clariva wallet: provisioning returned a different Matrix ID (${created.matrixUserId}) for ${me}; ignoring`,
                );
                return false;
            }
            return true;
        } catch (e) {
            logger.warn(`Clariva wallet: provisioning failed for ${me}`, e);
            return false;
        }
    }

    /** Consultant: save the price per 24 h chat (`PATCH /v1/users/{me} { max_credits }`). Throws on failure. */
    public async updateMaxCredits(maxCredits: number): Promise<void> {
        const me = this.requireUser();
        await ClarivaWalletApi.updateUser(me, { max_credits: maxCredits });
        this.maxCreditsInternal = maxCredits;
        // our own price is also what clients would read for us
        this.peers.set(me, { ...this.peers.get(me), maxCredits, isConsultant: true, fetchedAt: Date.now() });
        this.emit(WalletStoreEvent.Update);
    }

    // ── settings JSON: designation + "Last seen and online" (Android ee053dc156) ─────────────────────────────

    /**
     * Save my designation (consultants: the title shown under their name, e.g. "Cardiologist"). Blank removes it, so
     * the default "Consultant" shows again. Throws for more than `MAX_DESIGNATION_LENGTH` characters or on failure.
     */
    public async updateDesignation(designation: string | null): Promise<void> {
        const value = normalizeDesignation(designation);
        const me = this.requireUser();
        await this.updateSettings(SETTINGS_DESIGNATION_KEY, value);
        if (this.userIdInternal !== me) return;
        this.designationInternal = value;
        const own = this.peers.get(me);
        if (own) this.peers.set(me, { ...own, designation: value });
        this.emit(WalletStoreEvent.Update);
    }

    /** Save my "Last seen and online" choice. Throws on failure (the caller reverts its UI). */
    public async updatePresencePrivacy(privacy: PresencePrivacy): Promise<void> {
        const me = this.requireUser();
        await this.updateSettings(SETTINGS_PRESENCE_PRIVACY_KEY, presencePrivacyToJson(privacy));
        if (this.userIdInternal !== me) return;
        this.presencePrivacyInternal = privacy;
        const own = this.peers.get(me);
        if (own) this.peers.set(me, { ...own, presencePrivacy: privacy });
        this.emit(WalletStoreEvent.Update);
    }

    /**
     * Set one key of my `settings` JSON (`value === null` removes it). The Wallet-API REPLACES the whole object, so this
     * re-reads it first and writes it back with only that key changed, keeping every other key (Android
     * `WalletService.updateSettings`).
     */
    private async updateSettings(key: string, value: unknown | null): Promise<void> {
        const me = this.requireUser();
        const current = await ClarivaWalletApi.getUser(me);
        await ClarivaWalletApi.updateUser(me, { settings: mergeSettings(current.settings, key, value) });
    }

    /**
     * Re-read a peer's role, price, designation and "Last seen" choice, bypassing the cache, so a designation a
     * consultant just changed shows the next time their chat is opened (Android `refreshPeerProfile`). Resolves
     * `null` when the lookup failed; the previously cached values are kept.
     */
    public refreshPeer(peerId: string): Promise<PeerWalletInfo | null> {
        return this.getPeer(peerId, { force: true });
    }

    // ── peers (rate + role of the other party) ──────────────────────────────

    /** Synchronous first-paint hint; may be stale. Never a substitute for `getPeer`. */
    public getCachedPeer(peerId: string): PeerWalletInfo | undefined {
        return this.peers.get(peerId);
    }

    /**
     * The peer's price and role via `GET /v1/users/{peer}`. Cache-first within `maxAgeMs` (default: the open-chat
     * TTL; Android never expired — a quirk we fixed). Never touches the LOCAL user's own state (L8). Returns `null`
     * when unknown (network error, no wallet row): callers fail open.
     */
    public getPeer(peerId: string, options?: { maxAgeMs?: number; force?: boolean }): Promise<PeerWalletInfo | null> {
        const maxAge = options?.maxAgeMs ?? getClarivaConfig().polling.peer_rate_ttl_ms;
        const cached = this.peers.get(peerId);
        if (cached && !options?.force && Date.now() - cached.fetchedAt <= maxAge) return Promise.resolve(cached);

        const notFoundUntil = this.peerNotFoundUntil.get(peerId);
        if (notFoundUntil !== undefined && Date.now() < notFoundUntil) return Promise.resolve(cached ?? null);

        const inFlight = this.peerInFlight.get(peerId);
        if (inFlight) return inFlight;

        const me = this.userIdInternal;
        const run = async (): Promise<PeerWalletInfo | null> => {
            try {
                const user = await ClarivaWalletApi.getUser(peerId);
                if (this.userIdInternal !== me) return null;
                const info: PeerWalletInfo = {
                    maxCredits: parseAmount(user.max_credits),
                    isConsultant: user.isConsultant === 1 ? true : user.isConsultant === 0 ? false : null,
                    designation: designationOf(user.settings),
                    presencePrivacy: presencePrivacyOf(user.settings),
                    fetchedAt: Date.now(),
                };
                const previous = this.peers.get(peerId);
                this.peers.set(peerId, info);
                if (!previous || !samePeerProfile(previous, info)) this.emit(WalletStoreEvent.Peer, peerId);
                this.peerNotFoundUntil.delete(peerId);
                return info;
            } catch (e) {
                if (e instanceof ClarivaHttpError && e.isNotFound) {
                    this.peerNotFoundUntil.set(peerId, Date.now() + PEER_NOT_FOUND_BACKOFF_MS);
                    if (this.userIdInternal !== me) return null;
                    // No wallet row is a real answer (Android `lookUpUser`): a client with default settings.
                    const info: PeerWalletInfo = {
                        maxCredits: null,
                        isConsultant: false,
                        designation: null,
                        presencePrivacy: DEFAULT_PRESENCE_PRIVACY,
                        fetchedAt: Date.now(),
                    };
                    const previous = this.peers.get(peerId);
                    this.peers.set(peerId, info);
                    if (!previous || !samePeerProfile(previous, info)) this.emit(WalletStoreEvent.Peer, peerId);
                    return info;
                } else {
                    logger.debug(`Clariva wallet: failed to look up ${peerId}`, e);
                }
                // fall back to a stale value rather than nothing
                return cached ?? null;
            } finally {
                this.peerInFlight.delete(peerId);
            }
        };
        const promise = run();
        this.peerInFlight.set(peerId, promise);
        return promise;
    }

    /**
     * The chat-list label value: the peer's price, but ONLY if the peer is a consultant (clients have no rate; the
     * row stays blank rather than showing a meaningless number). Uses the long list TTL.
     */
    public async getConsultantRate(peerId: string): Promise<number | null> {
        const info = await this.getPeer(peerId, { maxAgeMs: getClarivaConfig().polling.peer_rate_list_ttl_ms });
        return info && info.isConsultant === true ? info.maxCredits : null;
    }

    // ── holds ────────────────────────────────────────────────────────────────

    /** Synchronous first-paint hint for the gate (`undefined` = never checked this session). */
    public getCachedHoldExists(peerId: string): boolean | undefined {
        const me = this.userIdInternal;
        return me ? this.holdExistsCache.get(holdKey(me, peerId)) : undefined;
    }

    /**
     * Is a hold covering "a new message wouldn't charge" right now? `null` = unknown (network error): NEVER map
     * that to `false` (L5). Updates the first-paint cache on success.
     */
    public async checkHoldExists(peerId: string): Promise<boolean | null> {
        const me = this.userIdInternal;
        if (!me) return null;
        try {
            const res = await ClarivaWalletApi.holdExists(me, peerId);
            if (this.userIdInternal !== me) return null;
            this.holdExistsCache.set(holdKey(me, peerId), res.exists);
            return res.exists;
        } catch (e) {
            logger.debug(`Clariva wallet: hold-exists check failed for ${peerId}`, e);
            return null;
        }
    }

    /**
     * Create / re-use the 24 h hold paying `peerId` (the sender is the payer). Consultants never pay (client-side
     * short-circuit, the server would 403). Single-flight per pair so two quick first sends cannot race two
     * `initiate` calls (improvement over Android). On success the first-paint cache is set; on any failure the
     * cached entry is dropped because the server may have committed before the response was lost (L2).
     */
    public initiateHold(peerId: string): Promise<HoldResult> {
        const me = this.userIdInternal;
        if (!me) return Promise.resolve({ ok: true, skipped: true });
        if (this.isConsultantInternal === true) return Promise.resolve({ ok: true, skipped: true });

        const key = holdKey(me, peerId);
        const existing = this.holdInFlight.get(key);
        if (existing) return existing;

        const run = async (): Promise<HoldResult> => {
            try {
                await ClarivaWalletApi.initiateHold(me, peerId);
                this.holdExistsCache.set(key, true);
                return { ok: true, skipped: false };
            } catch (e) {
                this.holdExistsCache.delete(key);
                if (e instanceof ClarivaHttpError) {
                    const message = e.serverMessage ?? e.message;
                    return {
                        ok: false,
                        status: e.status,
                        message,
                        insufficientCredits: e.status === 400 && /insufficient/i.test(message),
                        isNetwork: e.isNetwork,
                    };
                }
                return { ok: false, status: 0, message: String(e), insufficientCredits: false, isNetwork: true };
            } finally {
                this.holdInFlight.delete(key);
            }
        };
        const promise = run();
        this.holdInFlight.set(key, promise);
        return promise;
    }

    // ── consultant: refund pills ─────────────────────────────────────────────

    /**
     * Refresh the set of clients with an open refund request awaiting this consultant. No-op (and clears the set)
     * for non-consultants. On failure the previous set is kept: a stale badge beats a wrongly cleared one.
     */
    public refreshPendingRefunds(): Promise<void> {
        const me = this.userIdInternal;
        if (!me) return Promise.resolve();
        if (this.isConsultantInternal !== true) {
            if (this.pendingRefundClientsInternal.size > 0) {
                this.pendingRefundClientsInternal = new Set();
                this.emit(WalletStoreEvent.PendingRefunds, this.pendingRefundClientsInternal);
            }
            return Promise.resolve();
        }
        if (this.refundsInFlight) return this.refundsInFlight;
        const run = async (): Promise<void> => {
            try {
                const res = await ClarivaWalletApi.pendingRefundsForConsultant(me);
                if (this.userIdInternal !== me) return;
                const next = new Set(res.clientIds ?? []);
                const prev = this.pendingRefundClientsInternal;
                const same = next.size === prev.size && [...next].every((id) => prev.has(id));
                if (!same) {
                    this.pendingRefundClientsInternal = next;
                    this.emit(WalletStoreEvent.PendingRefunds, next);
                }
            } catch (e) {
                logger.debug("Clariva wallet: failed to refresh pending refunds", e);
            } finally {
                this.refundsInFlight = null;
            }
        };
        this.refundsInFlight = run();
        return this.refundsInFlight;
    }

    // ── recharge + history (thin; UI in components/wallet) ──────────────────

    /** Step 1 of a recharge. One 404 self-heal like Android. Throws `ClarivaHttpError`. */
    public async createOrder(amount: number): Promise<CreateOrderResponse> {
        const me = this.requireUser();
        try {
            return await ClarivaWalletApi.createOrder(me, amount);
        } catch (e) {
            if (e instanceof ClarivaHttpError && e.isNotFound && (await this.ensureWalletUserExists())) {
                return ClarivaWalletApi.createOrder(me, amount);
            }
            throw e;
        }
    }

    /** Step 2: verify the Razorpay signature and refresh the balance. Throws `ClarivaHttpError`. */
    public async verifyPayment(request: Omit<VerifyPaymentRequest, "userId">): Promise<VerifyPaymentResponse> {
        const me = this.requireUser();
        const response = await ClarivaWalletApi.verifyPayment({ ...request, userId: me });
        if (response.success) {
            const newBalance = parseAmount(response.newBalance);
            if (newBalance !== null) {
                this.creditsInternal = newBalance;
                this.emit(WalletStoreEvent.Update);
            }
            void this.refreshBalance();
        }
        return response;
    }

    /** Ledger page, newest first. One 404 self-heal. Throws `ClarivaHttpError`. */
    public async getHistory(page: number, pageSize = 10): Promise<TransactionHistoryResponse> {
        const me = this.requireUser();
        const safePage = Math.max(1, Math.floor(page));
        const safeSize = Math.min(50, Math.max(10, Math.floor(pageSize)));
        try {
            return await ClarivaWalletApi.getHistory(me, safePage, safeSize);
        } catch (e) {
            if (e instanceof ClarivaHttpError && e.isNotFound && (await this.ensureWalletUserExists())) {
                return ClarivaWalletApi.getHistory(me, safePage, safeSize);
            }
            throw e;
        }
    }

    private requireUser(): string {
        if (!this.userIdInternal) throw new Error("Clariva wallet: not started (no signed-in user)");
        return this.userIdInternal;
    }

    // ── timers (paused while the tab is hidden) ─────────────────────────────

    private syncTimers(): void {
        this.clearTimers();
        if (!this.userIdInternal) return;
        if (typeof document !== "undefined" && document.hidden) return;
        const { balance_ms: balanceMs, refund_pills_ms: pillsMs } = getClarivaConfig().polling;
        this.balanceTimer = setInterval(() => void this.refreshBalance(), balanceMs);
        if (this.isConsultantInternal === true) {
            this.pillsTimer = setInterval(() => void this.refreshPendingRefunds(), pillsMs);
        }
    }

    private clearTimers(): void {
        if (this.balanceTimer !== undefined) clearInterval(this.balanceTimer);
        if (this.pillsTimer !== undefined) clearInterval(this.pillsTimer);
        this.balanceTimer = undefined;
        this.pillsTimer = undefined;
    }

    private readonly onVisibilityChange = (): void => {
        if (!this.userIdInternal) return;
        if (document.hidden) {
            this.clearTimers();
        } else {
            this.syncTimers();
            void this.refreshBalance();
            if (this.isConsultantInternal === true) void this.refreshPendingRefunds();
        }
    };

    private installVisibilityHandler(): void {
        if (this.visibilityHandlerInstalled || typeof document === "undefined") return;
        document.addEventListener("visibilitychange", this.onVisibilityChange);
        this.visibilityHandlerInstalled = true;
    }

    private removeVisibilityHandler(): void {
        if (!this.visibilityHandlerInstalled || typeof document === "undefined") return;
        document.removeEventListener("visibilitychange", this.onVisibilityChange);
        this.visibilityHandlerInstalled = false;
    }
}
