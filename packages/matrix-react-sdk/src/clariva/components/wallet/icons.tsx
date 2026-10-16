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

import React from "react";

/**
 * Compound has no wallet glyph. Same box/behaviour as the Compound icons (24x24 viewBox, `1em`, `currentColor`) so it
 * drops into settings tab labels and buttons unchanged.
 */
export function WalletIcon(props: React.SVGAttributes<SVGElement>): JSX.Element {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="1em"
            height="1em"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            {...props}
        >
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M5 4a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-1.1A3 3 0 0 0 23 14v-4a3 3 0 0 0-1-2.23V7a3 3 0 0 0-3-3H5Zm14 2a1 1 0 0 1 1 1v.18c-.1-.02-.2-.03-.3-.03H14a3 3 0 0 0-3 3v3.7a3 3 0 0 0 3 3h5.7c.1 0 .2-.01.3-.03V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h14Zm-5 3.15a1 1 0 0 0-1 1v3.7a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-3.7a1 1 0 0 0-1-1h-6ZM16 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
            />
        </svg>
    );
}

/**
 * The empty history: a ledger card with three lines and the amber coin leaning on its corner. Decorative (`aria-hidden`):
 * the title under it says what is missing. The card and lines are currentColor, set to --cg-text-3 by the stylesheet; the coin
 * is the CoinIcon primitive's colours (amber is for money only).
 */
export function EmptyHistoryArt(props: React.SVGAttributes<SVGElement>): JSX.Element {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="112"
            height="88"
            viewBox="0 0 112 88"
            fill="none"
            aria-hidden="true"
            focusable="false"
            data-testid="clariva-empty-art"
            {...props}
        >
            <rect x="14" y="8" width="76" height="68" rx="16" stroke="currentColor" strokeWidth="2" opacity="0.55" />
            <rect x="28" y="24" width="34" height="6" rx="3" fill="currentColor" opacity="0.4" />
            <rect x="28" y="38" width="48" height="6" rx="3" fill="currentColor" opacity="0.28" />
            <rect x="28" y="52" width="26" height="6" rx="3" fill="currentColor" opacity="0.28" />
            <circle className="mx_ClarivaTxns_emptyCoin" cx="84" cy="62" r="18" />
            <path
                className="mx_ClarivaTxns_emptyCoinMark"
                d="M89.4 56.6A8 8 0 1 0 89.4 67.4"
                strokeWidth="3"
                strokeLinecap="round"
            />
        </svg>
    );
}
