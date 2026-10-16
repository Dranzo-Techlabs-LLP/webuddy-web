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

import React, { useEffect, useLayoutEffect, useRef } from "react";
import { Icon as MicIcon } from "@vector-im/compound-design-tokens/icons/mic-on-solid.svg";
import { Icon as SendIcon } from "@vector-im/compound-design-tokens/icons/send-solid.svg";

import AccessibleButton, { type ButtonEvent } from "../../../components/views/elements/AccessibleButton";

export type ComposerActionMode = "mic" | "send";

/**
 * How long after an Enter key press the composer clearing still counts as "caused by the keyboard". Sending can wait for
 * the billing round trip (hold-first) before the text is cleared, so this is generous; a mouse click on Send within it
 * merely skips the cross-fade, which is harmless.
 */
export const KEYBOARD_SEND_WINDOW_MS = 2000;

/**
 * Is the flip from `previous` to `mode` the composer being CLEARED by a keyboard send? Then the circle changes at once:
 * a person who sends with Enter dozens of times a day must never wait on, or even see, a 160 ms cross-fade (frequency
 * decides motion, DESIGN-SYSTEM.md section 5). Typing into an empty composer, and a click on Send, still cross-fade.
 */
export function isKeyboardSendFlip(
    previous: ComposerActionMode,
    mode: ComposerActionMode,
    lastEnterAt: number,
    now: number,
): boolean {
    return previous === "send" && mode === "mic" && lastEnterAt > 0 && now - lastEnterAt <= KEYBOARD_SEND_WINDOW_MS;
}

interface Props {
    /** `send` while there is something to send (text or a recording), else `mic`. */
    mode: ComposerActionMode;
    /** Accessible name of the send action (Element's "Send message" / "Send voice message"). */
    sendTitle: string;
    /** Accessible name of the mic action ("Voice message"). */
    micTitle: string;
    onSend: (ev: ButtonEvent) => void;
    onMic: (ev: ButtonEvent) => void;
    /** Where `performance.now()` is read from (a test seam). */
    now?: () => number;
}

/**
 * The composer's one round action. A Deep Teal circle that shows the microphone while the composer is empty and the send
 * arrow once there is something to send; the two glyphs CROSS-FADE (opacity only, 160 ms, `_chatroom.pcss`). Pressing
 * Enter in the composer sends and clears it: that flip carries `data-instant`, which removes the fade. The stock
 * `sendmessagebtn` test id and "Send message" name are kept for the send state.
 */
export function ClarivaComposerAction({
    mode,
    sendTitle,
    micTitle,
    onSend,
    onMic,
    now = () => performance.now(),
}: Props): JSX.Element {
    const rootRef = useRef<HTMLDivElement>(null);
    const lastEnterAt = useRef(0);
    const modeRef = useRef(mode);
    const previousMode = useRef(mode);

    // `instant` is decided while rendering the flip itself, from the facts recorded before it
    const instant = isKeyboardSendFlip(previousMode.current, mode, lastEnterAt.current, now());
    useLayoutEffect(() => {
        previousMode.current = mode;
        modeRef.current = mode;
    });

    // Enter in the composer (capture phase: it runs before the composer's own handler clears the text). Only an Enter that
    // can send counts, i.e. one pressed while there is something to send.
    useEffect(() => {
        const composer = rootRef.current?.closest(".mx_MessageComposer");
        if (!composer) return;
        const onKeyDown = (ev: Event): void => {
            const key = ev as KeyboardEvent;
            if (key.key === "Enter" && !key.shiftKey && modeRef.current === "send") lastEnterAt.current = now();
        };
        composer.addEventListener("keydown", onKeyDown, true);
        return () => composer.removeEventListener("keydown", onKeyDown, true);
    }, [now]);

    const sending = mode === "send";
    return (
        <div ref={rootRef} className="mx_ClarivaComposerAction_wrap">
            <AccessibleButton
                className="mx_MessageComposer_sendMessage mx_ClarivaComposerAction"
                onClick={sending ? onSend : onMic}
                title={sending ? sendTitle : micTitle}
                data-testid={sending ? "sendmessagebtn" : "clariva-composer-mic"}
                data-mode={mode}
                data-instant={instant ? "true" : undefined}
            >
                <MicIcon className="mx_ClarivaComposerAction_icon mx_ClarivaComposerAction_mic" aria-hidden="true" />
                <SendIcon className="mx_ClarivaComposerAction_icon mx_ClarivaComposerAction_send" aria-hidden="true" />
            </AccessibleButton>
        </div>
    );
}
