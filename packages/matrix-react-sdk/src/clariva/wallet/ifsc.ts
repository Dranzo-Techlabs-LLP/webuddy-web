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

import { useEffect, useRef, useState } from "react";
import { logger } from "matrix-js-sdk/src/logger";

import { walletStrings as S } from "../strings/wallet";
import { BankAccountRules, normalizeIfsc } from "./bankDetails";

/**
 * Live IFSC lookup, ported from Android's `IfscLookup.kt`: once a typed IFSC is well-formed it is looked up in
 * Razorpay's public IFSC directory, so a mistyped code is caught before it becomes a failed payout, and the bank and
 * branch fill themselves in. Used by Settings > Bank Details, the sign-up payout section and the Google payout step.
 */

/** Razorpay's public IFSC directory: 200 with the branch, or 404 for a code that does not exist. */
export const IFSC_DIRECTORY_URL = "https://ifsc.razorpay.com/";
/** Long enough that pasting or fast typing triggers one lookup, not one per key (Android: IFSC_LOOKUP_DEBOUNCE_MS). */
export const IFSC_LOOKUP_DEBOUNCE_MS = 300;
/** [WEB] the directory is a third party: a hung request reads as "unavailable", which never blocks saving. */
export const IFSC_LOOKUP_TIMEOUT_MS = 10_000;

/** The bank branch an IFSC belongs to; `branch` and `city` are title-cased for display. */
export interface IfscBranch {
    bank: string;
    branch: string;
    city: string | null;
}

/** e.g. "State Bank of India · Hajiganj, Patna". */
export function ifscSummary(branch: IfscBranch): string {
    const place = [branch.branch.trim() ? branch.branch : null, branch.city].filter((p): p is string => !!p);
    return `${branch.bank} · ${place.join(", ")}`;
}

/** What the payout forms know about the IFSC being typed. */
export type IfscStatus =
    /** Empty or not yet a well-formed code: nothing to look up. */
    | { kind: "none" }
    | { kind: "checking" }
    | { kind: "found"; branch: IfscBranch }
    /** Well-formed, but no such branch: blocks saving. */
    | { kind: "notFound" }
    /** The directory could not be reached; saving is allowed and the API checks again. */
    | { kind: "unavailable" };

export const IFSC_NONE: IfscStatus = { kind: "none" };
export const IFSC_CHECKING: IfscStatus = { kind: "checking" };

/** Wrong, or still being checked: hold off saving. An unreachable directory does not block. */
export function ifscBlocksSave(status: IfscStatus): boolean {
    return status.kind === "notFound" || status.kind === "checking";
}

/** The line under the IFSC field for a lookup result (`null` when there is nothing to say). */
export function ifscStatusText(status: IfscStatus): string | null {
    switch (status.kind) {
        case "checking":
            return S.ifscChecking;
        case "found":
            return ifscSummary(status.branch);
        case "notFound":
            return S.ifscNotFound;
        case "unavailable":
            return S.ifscUnavailable;
        default:
            return null;
    }
}

/** "HAJIGANJ  ROAD" -> "Hajiganj  Road" (Android: lowercase, split on spaces, capitalise each word, trim). */
export function titleCase(value: string): string {
    return value
        .toLowerCase()
        .split(" ")
        .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
        .join(" ")
        .trim();
}

interface IfscApiResponse {
    BANK?: string | null;
    BRANCH?: string | null;
    CITY?: string | null;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class IfscLookup {
    // Only definite answers are cached (null = no such IFSC); an unreachable directory is retried.
    private readonly cache = new Map<string, IfscBranch | null>();

    /** `fetchImpl` defaults to the global `fetch` at call time (so tests can swap it). */
    public constructor(private readonly fetchImpl?: FetchLike) {}

    public async lookup(rawIfsc: string, signal?: AbortSignal): Promise<IfscStatus> {
        const ifsc = normalizeIfsc(rawIfsc);
        if (!BankAccountRules.isValidIfsc(ifsc)) return IFSC_NONE;
        if (this.cache.has(ifsc)) {
            const cached = this.cache.get(ifsc);
            return cached ? { kind: "found", branch: cached } : { kind: "notFound" };
        }

        const controller = new AbortController();
        const onAbort = (): void => controller.abort();
        signal?.addEventListener("abort", onAbort);
        const timer = setTimeout(() => controller.abort(), IFSC_LOOKUP_TIMEOUT_MS);
        try {
            const doFetch = this.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
            const response = await doFetch(`${IFSC_DIRECTORY_URL}${encodeURIComponent(ifsc)}`, {
                method: "GET",
                credentials: "omit",
                signal: controller.signal,
            });
            if (response.status === 404) {
                this.cache.set(ifsc, null);
                return { kind: "notFound" };
            }
            if (!response.ok) {
                logger.warn(`Clariva: IFSC lookup failed with HTTP ${response.status}`);
                return { kind: "unavailable" };
            }
            const body = JSON.parse(await response.text()) as IfscApiResponse;
            const bank = typeof body?.BANK === "string" ? body.BANK.trim() : "";
            if (!bank) return { kind: "unavailable" };
            const city = typeof body.CITY === "string" ? titleCase(body.CITY) : "";
            const branch: IfscBranch = {
                bank,
                branch: titleCase(typeof body.BRANCH === "string" ? body.BRANCH : ""),
                city: city || null,
            };
            this.cache.set(ifsc, branch);
            return { kind: "found", branch };
        } catch (e) {
            if (signal?.aborted) throw e;
            logger.warn("Clariva: IFSC lookup unavailable", e);
            return { kind: "unavailable" };
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
        }
    }

    /** Test seam. */
    public clearCache(): void {
        this.cache.clear();
    }
}

/** App-wide, so a code looked up on the sign-up form is not fetched again in Settings. */
export const ifscLookup = new IfscLookup();

interface LookupResult {
    ifsc: string;
    status: IfscStatus;
}

/**
 * The live status of `rawIfsc`: `none` until it is well-formed, then `checking` for the 300 ms debounce and the
 * request, then the answer. The result is keyed by the code it is for, so an answer for a code the user has since
 * changed is never shown, and it is forgotten as soon as the code changes: typing a code again checks it again
 * (Android sets Checking on every run), so an old "unavailable" never lets a save through while a lookup runs.
 * `onFound` runs once per answer that found a branch (the forms fill in bank and branch).
 */
export function useIfscLookup(
    rawIfsc: string,
    onFound?: (branch: IfscBranch) => void,
    lookup: IfscLookup = ifscLookup,
): IfscStatus {
    const ifsc = normalizeIfsc(rawIfsc);
    const valid = BankAccountRules.isValidIfsc(ifsc);
    const [result, setResult] = useState<LookupResult | null>(null);
    const onFoundRef = useRef(onFound);
    onFoundRef.current = onFound;
    // reset during render (React re-renders before committing), so not even one frame shows the old answer
    if (result !== null && result.ifsc !== ifsc) setResult(null);

    useEffect(() => {
        if (!valid) return;
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            let status: IfscStatus;
            try {
                status = await lookup.lookup(ifsc, controller.signal);
            } catch {
                return; // aborted: the code changed or the form went away
            }
            if (controller.signal.aborted) return;
            setResult({ ifsc, status });
            if (status.kind === "found") onFoundRef.current?.(status.branch);
        }, IFSC_LOOKUP_DEBOUNCE_MS);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [ifsc, valid, lookup]);

    if (!valid) return IFSC_NONE;
    return result?.ifsc === ifsc ? result.status : IFSC_CHECKING;
}
