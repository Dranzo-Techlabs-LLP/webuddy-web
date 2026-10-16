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

import { getClarivaConfig } from "./config";

/**
 * Razorpay Standard Checkout on the web (spec 02 §6.4). The script is loaded on demand from
 * `clariva.razorpay_checkout_url` (default https://checkout.razorpay.com/v1/checkout.js — already allowed by the CSP
 * in src/vector/index.html) through ONE `<script>` tag, however many times the recharge dialog is opened.
 */

/** Options we pass to `new Razorpay(...)`. Only documented Standard Checkout fields. */
export interface RazorpayCheckoutOptions {
    key: string;
    order_id: string;
    /** In paise. */
    amount: number;
    currency: string;
    name: string;
    description: string;
    theme: { color: string };
    handler: (response: RazorpaySuccessResponse) => void;
    modal: { ondismiss: () => void };
}

export interface RazorpaySuccessResponse {
    razorpay_payment_id?: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
}

export interface RazorpayFailureResponse {
    error?: {
        code?: string;
        description?: string;
        source?: string;
        step?: string;
        reason?: string;
        metadata?: { order_id?: string; payment_id?: string };
    };
}

export interface RazorpayInstance {
    open(): void;
    on(event: "payment.failed", handler: (response: RazorpayFailureResponse) => void): void;
    close?(): void;
}

export type RazorpayConstructor = new (options: RazorpayCheckoutOptions) => RazorpayInstance;

declare global {
    interface Window {
        Razorpay?: RazorpayConstructor;
    }
}

/** Marks the tag we inject so a second `loadRazorpay` joins it instead of adding another. */
const SCRIPT_ATTRIBUTE = "data-clariva-razorpay";
const LOAD_TIMEOUT_MS = 20_000;

let inFlight: Promise<RazorpayConstructor> | null = null;

/**
 * Resolve with the global `Razorpay` constructor, injecting the script the first time. Idempotent and concurrency
 * safe; after a failure the broken tag is removed so a later call can try again (e.g. after the network is back).
 */
export function loadRazorpay(url: string = getClarivaConfig().razorpay_checkout_url): Promise<RazorpayConstructor> {
    if (typeof window === "undefined" || typeof document === "undefined") {
        return Promise.reject(new Error("Razorpay can only be loaded in a browser"));
    }
    if (window.Razorpay) return Promise.resolve(window.Razorpay);
    if (inFlight) return inFlight;

    const promise = new Promise<RazorpayConstructor>((resolve, reject) => {
        let script = document.querySelector<HTMLScriptElement>(`script[${SCRIPT_ATTRIBUTE}]`);
        const created = !script;
        if (!script) {
            script = document.createElement("script");
            script.src = url;
            script.async = true;
            script.setAttribute(SCRIPT_ATTRIBUTE, "true");
        }
        const tag = script;

        let timer: ReturnType<typeof setTimeout> | undefined;
        const cleanup = (): void => {
            if (timer !== undefined) clearTimeout(timer);
            tag.removeEventListener("load", onLoad);
            tag.removeEventListener("error", onError);
        };
        const fail = (reason: string): void => {
            cleanup();
            tag.remove(); // the next attempt creates a fresh tag
            reject(new Error(reason));
        };
        const onLoad = (): void => {
            cleanup();
            if (window.Razorpay) resolve(window.Razorpay);
            else fail("Razorpay loaded but did not define window.Razorpay");
        };
        const onError = (): void => fail("Could not load the Razorpay checkout script");

        tag.addEventListener("load", onLoad);
        tag.addEventListener("error", onError);
        timer = setTimeout(() => fail("Timed out loading the Razorpay checkout script"), LOAD_TIMEOUT_MS);
        if (created) document.head.appendChild(tag);
    });

    inFlight = promise;
    const clear = (): void => {
        if (inFlight === promise) inFlight = null;
    };
    promise.then(clear, clear);
    return promise;
}

/**
 * `react-focus-lock` (used by every Element dialog, including the Settings dialog and our recharge dialog) pulls
 * focus back into the dialog whenever something else gets it. Razorpay's checkout is an `<iframe>` appended to
 * `<body>`, so without this the card/UPI fields could not be typed into. Pass as the lock's `whiteList`: returning
 * `false` tells the lock to leave that element alone.
 */
export function focusLockWhitelist(element: Element): boolean {
    try {
        return !element.closest(".razorpay-container, iframe.razorpay-checkout-frame, iframe[src*='razorpay']");
    } catch {
        return true;
    }
}

/** Test helper: forget the cached in-flight load. */
export function resetRazorpayLoaderForTests(): void {
    inFlight = null;
}
