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
 * Money helpers. 1 credit = INR 1. The Wallet-API stores DECIMAL(10,2) and returns most amounts as *strings*
 * (e.g. "250.00"), occasionally as numbers (e.g. `newBalance` on a first verify), so every read goes through
 * `parseAmount`.
 */

/** Parse an API amount; `null` when absent or not a finite number (callers must NOT fall back to 0/100: lesson L9). */
export function parseAmount(value: unknown): number | null {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const n = Number(trimmed);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

/**
 * Round to 2 decimals exactly like the server (JS `Math.round`, half-up). Kotlin's `round` is half-even, which
 * Android uses for the partial-refund field; the server is the authority, so the web matches the server.
 */
export function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/** Compare two amounts at the server's 2-decimal precision (avoids 0.1 + 0.2 style float surprises). */
export function compareAmounts(a: number, b: number): number {
    return Math.sign(Math.round(a * 100) - Math.round(b * 100));
}

/** `a < b` at 2-decimal precision. */
export function isLess(a: number, b: number): boolean {
    return compareAmounts(a, b) < 0;
}

/**
 * Display a credit amount: whole numbers without decimals (Android's look: "1195"), otherwise two decimals
 * ("99.99" — Android truncates to "99", which hides partial-refund cents). Thousands separators follow the locale
 * only when `grouped` is set (tables); the chip and gate text stay plain like Android.
 */
export function formatCredits(value: number, grouped = false): string {
    const rounded = round2(value);
    const whole = Number.isInteger(rounded);
    if (!grouped) return whole ? String(rounded) : rounded.toFixed(2);
    return rounded.toLocaleString(undefined, {
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: 2,
    });
}

/** "₹1,195" style amount for rupee-denominated dialogs (the refund dialog shows rupees, everything else credits). */
export function formatRupees(value: number): string {
    return `₹${formatCredits(value, true)}`;
}
