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

export type ChatsIllustrationVariant = "chats" | "search";

interface Props {
    /** "chats": two overlapping bubbles (nothing here yet). "search": a bubble and a magnifier (nothing matches). */
    variant?: ChatsIllustrationVariant;
}

/**
 * The empty-state picture of the Chats list: two overlapping drops of glass in the brand navy and teal (the same bubble
 * the Clariva mark is built from). Pure inline SVG, so it costs no request and follows the theme: every colour is a design
 * token set in CSS (`.mx_ClarivaChatsIllustration_*` in res/css/clariva/_chats.pcss). Decorative: the title next to it
 * says everything, so it is hidden from assistive technology.
 */
export function ChatsIllustration({ variant = "chats" }: Props): JSX.Element {
    return (
        <svg
            className="mx_ClarivaChatsIllustration"
            data-variant={variant}
            width="168"
            height="124"
            viewBox="0 0 168 124"
            fill="none"
            aria-hidden="true"
            focusable="false"
            data-testid="clariva-chats-illustration"
        >
            {/* back bubble: navy, tail at the bottom left */}
            <path
                className="mx_ClarivaChatsIllustration_back"
                d="M36 14h58a24 24 0 0 1 24 24v16a24 24 0 0 1-24 24H58l-18 16a2 2 0 0 1-3.3-1.6L36 78a24 24 0 0 1-24-24V38a24 24 0 0 1 24-24Z"
            />
            <path className="mx_ClarivaChatsIllustration_line" d="M34 38h48M34 54h30" />
            {variant === "chats" ? (
                <>
                    {/* front bubble: teal, tail at the bottom right */}
                    <path
                        className="mx_ClarivaChatsIllustration_front"
                        d="M82 48h50a24 24 0 0 1 24 24v12a24 24 0 0 1-24 24h-6l4 12a2 2 0 0 1-3.2 2.2L108 108H82a24 24 0 0 1-24-24V72a24 24 0 0 1 24-24Z"
                    />
                    <circle className="mx_ClarivaChatsIllustration_dot" cx="88" cy="78" r="5" />
                    <circle className="mx_ClarivaChatsIllustration_dot" cx="107" cy="78" r="5" />
                    <circle className="mx_ClarivaChatsIllustration_dot" cx="126" cy="78" r="5" />
                </>
            ) : (
                <>
                    {/* magnifier: a teal lens with a navy handle */}
                    <circle className="mx_ClarivaChatsIllustration_lens" cx="108" cy="72" r="26" />
                    <path className="mx_ClarivaChatsIllustration_handle" d="m127 91 18 18" />
                </>
            )}
        </svg>
    );
}

export default ChatsIllustration;
