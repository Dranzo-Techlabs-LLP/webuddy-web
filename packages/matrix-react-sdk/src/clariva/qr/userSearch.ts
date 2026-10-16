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

import { isMatrixUserId } from "./payload";

/**
 * Clariva user search rules for "Start chat" (spec 04 §3.15, port of Android `MatrixUserRepository`).
 *
 *  1. `trimmed = query.trim()`.
 *  2. `isFullUserId = isUserId(trimmed) && trimmed != me`.
 *  3. `derivedUserId` (only if !isFullUserId and `trimmed` matches `^[a-zA-Z0-9._=/+-]+$`):
 *     `"@" + trimmed.lowercase() + ":" + <domain of MY user id>`, kept only if it is a valid id and not me.
 *  4. `shouldFetch = trimmed.length >= 3`.
 *  5. If `isFullUserId || shouldFetch` -> emit #1 `{top:[bare row for the full id], isSearching: shouldFetch}`.
 *  6. If `shouldFetch`: wait 250 ms (the debounce), then `user_directory/search {search_term, limit: 10}` (errors ->
 *     empty), drop me, and
 *       - full id not among the results: put its profile first (resolved row) or an UNRESOLVED row if the profile
 *         lookup failed;
 *       - derived id not among the results: look its profile up and put it first ONLY when it resolves (no phantom
 *         rows for free-text searches).
 *     -> emit #2 `{top, directory, isSearching: false}`.
 *  7. Queries shorter than 3 characters emit nothing (except a complete user id).
 *
 * The result is split in `top` (rows Android inserts at index 0) and `directory` so the dialog can keep Element's
 * local suggestions between them. The state machine is UI-free and dependency-injected so it can be unit tested.
 */

export const SEARCH_MIN_CHARS = 3;
export const SEARCH_DEBOUNCE_MS = 250;
export const SEARCH_LIMIT = 10;

const DERIVABLE_USERNAME = /^[a-zA-Z0-9._=/+-]+$/;

export interface SearchRow {
    userId: string;
    displayName?: string;
    avatarUrl?: string;
    /** Explicit Matrix id whose profile lookup failed: "This Matrix ID can't be found, ..." warning row. */
    unresolved?: boolean;
}

export interface SearchState {
    /** Rows Android puts at index 0 (explicit id / derived username). At most one. */
    top: SearchRow[];
    /** Directory results (without me). */
    directory: SearchRow[];
    /** True while the debounced server lookups are pending (spinner instead of "No results"). */
    isSearching: boolean;
}

export const EMPTY_SEARCH_STATE: Readonly<SearchState> = Object.freeze({ top: [], directory: [], isSearching: false });

export interface DirectoryResult {
    user_id: string; // eslint-disable-line camelcase
    display_name?: string; // eslint-disable-line camelcase
    avatar_url?: string; // eslint-disable-line camelcase
}

export interface UserProfile {
    displayname?: string;
    avatar_url?: string; // eslint-disable-line camelcase
}

export interface SearchDeps {
    /** My Matrix user id (never offered as a result; supplies the server name for bare usernames). */
    myUserId: string;
    /** `POST /user_directory/search`. May reject: that is treated as "no results". */
    searchDirectory(term: string, limit: number): Promise<DirectoryResult[]>;
    /** `GET /profile/{userId}`. Resolve with the profile when it exists; reject / resolve null when it does not. */
    getProfile(userId: string): Promise<UserProfile | null | undefined>;
    /** Called with every state change. Never called after {@link ClarivaUserSearch.dispose}. */
    onState(state: SearchState): void;
    /** Defaults to 250 ms. */
    debounceMs?: number;
}

export interface SearchPlan {
    trimmed: string;
    isFullUserId: boolean;
    derivedUserId: string | null;
    shouldFetch: boolean;
}

/** The server name part of a Matrix user id (everything after the first ':'), or "" when there is none. */
export function serverNameOf(userId: string): string {
    const idx = userId.indexOf(":");
    return idx < 0 ? "" : userId.slice(idx + 1);
}

/** Steps 1-4 of the algorithm. Pure. */
export function planSearch(query: string, myUserId: string): SearchPlan {
    const trimmed = query.trim();
    const isFullUserId = isMatrixUserId(trimmed) && trimmed !== myUserId;

    let derivedUserId: string | null = null;
    if (!isFullUserId && DERIVABLE_USERNAME.test(trimmed)) {
        const domain = serverNameOf(myUserId);
        const derived = "@" + trimmed.toLowerCase() + ":" + domain;
        if (domain.length > 0 && isMatrixUserId(derived) && derived !== myUserId) derivedUserId = derived;
    }

    return { trimmed, isFullUserId, derivedUserId, shouldFetch: trimmed.length >= SEARCH_MIN_CHARS };
}

/**
 * One instance per dialog. Call {@link update} on every keystroke (the pending lookup of the previous keystroke is
 * cancelled, which is what makes the 250 ms delay a debounce) and {@link dispose} when the dialog closes.
 */
export class ClarivaUserSearch {
    private timer: ReturnType<typeof setTimeout> | undefined;
    /** Incremented on every update/dispose; async work from an older generation is discarded. */
    private generation = 0;
    private disposed = false;

    public constructor(private readonly deps: SearchDeps) {}

    public update(query: string): void {
        if (this.disposed) return;
        this.cancel();
        const generation = ++this.generation;
        const plan = planSearch(query, this.deps.myUserId);

        // Step 7: queries below the minimum emit nothing (stale results of a longer query are cleared, though).
        if (!plan.isFullUserId && !plan.shouldFetch) {
            this.emit(generation, EMPTY_SEARCH_STATE);
            return;
        }

        // Step 5, emit #1: the explicit id shows up immediately as a bare row.
        this.emit(generation, {
            top: plan.isFullUserId ? [{ userId: plan.trimmed }] : [],
            directory: [],
            isSearching: plan.shouldFetch,
        });
        if (!plan.shouldFetch) return;

        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.run(generation, plan);
        }, this.deps.debounceMs ?? SEARCH_DEBOUNCE_MS);
    }

    public dispose(): void {
        this.disposed = true;
        this.generation++;
        this.cancel();
    }

    private cancel(): void {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }

    private emit(generation: number, state: SearchState): void {
        if (this.disposed || generation !== this.generation) return;
        this.deps.onState(state);
    }

    private async lookupProfile(userId: string): Promise<UserProfile | null> {
        try {
            return (await Promise.resolve().then(() => this.deps.getProfile(userId))) ?? null;
        } catch {
            return null; // 404 / M_NOT_FOUND / hidden profile / network: all "does not resolve"
        }
    }

    private async run(generation: number, plan: SearchPlan): Promise<void> {
        const me = this.deps.myUserId;

        // The directory search and the (at most one) profile lookup are independent: run them concurrently.
        const directoryPromise = Promise.resolve()
            .then(() => this.deps.searchDirectory(plan.trimmed, SEARCH_LIMIT))
            .catch((): DirectoryResult[] => []); // errors -> empty list (Android)
        const extraId = plan.isFullUserId ? plan.trimmed : plan.derivedUserId;
        const profilePromise = extraId ? this.lookupProfile(extraId) : Promise.resolve(null);
        const [rawDirectory, profile] = await Promise.all([directoryPromise, profilePromise]);
        if (this.disposed || generation !== this.generation) return;

        const directory: SearchRow[] = (Array.isArray(rawDirectory) ? rawDirectory : [])
            .filter((r) => r && typeof r.user_id === "string" && r.user_id !== me)
            .map((r) => ({ userId: r.user_id, displayName: r.display_name, avatarUrl: r.avatar_url }));

        const top: SearchRow[] = [];
        if (extraId && !directory.some((r) => r.userId === extraId)) {
            if (profile) {
                top.push({ userId: extraId, displayName: profile.displayname, avatarUrl: profile.avatar_url });
            } else if (plan.isFullUserId) {
                top.push({ userId: extraId, unresolved: true });
            }
            // derived id without a profile: no phantom row
        }

        this.emit(generation, { top, directory, isSearching: false });
    }
}
