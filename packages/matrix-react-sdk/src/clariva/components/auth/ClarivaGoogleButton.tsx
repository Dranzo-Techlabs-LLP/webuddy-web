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

import React, { useEffect, useRef, useState } from "react";
import { logger } from "matrix-js-sdk/src/logger";

import {
    GoogleUnavailableError,
    type GoogleButtonText,
    type GoogleUnavailableReason,
    renderGoogleButton,
} from "../../session/googleIdentity";
import { authStrings } from "../../strings/auth";

interface Props {
    /** "signin_with" renders Google's "Sign in with Google", "signup_with" renders "Sign up with Google". */
    text: GoogleButtonText;
    /**
     * Called with the Google ID token and the `text` this render of the button carried ("Sign in with Google" or "Sign
     * up with Google"), so the caller does not have to infer the mode from its own state. GIS has ONE global callback,
     * so after a mode toggle the token always reaches the newest render: it cannot tell which button was pressed.
     * Not called while `disabled`.
     */
    onCredential: (idToken: string, renderedText: GoogleButtonText) => void;
    /** While true (a sign-in is in flight) clicks are swallowed and the keyboard cannot reach the button. */
    disabled?: boolean;
    /**
     * Called when Google's button cannot be shown: the script was blocked or never arrived, or Google drew nothing.
     * The container stays empty; the caller decides what to say and may remount the button to retry.
     */
    onUnavailable?: (reason: GoogleUnavailableReason) => void;
    /**
     * Move keyboard focus to the button's wrapper once, when it mounts. For a button the user just asked for ("Try
     * again" unmounted the notice that held focus); never for the first load of a page.
     */
    autoFocus?: boolean;
    testId?: string;
}

/**
 * Google's official button, rendered by Google Identity Services into a container. The button is an iframe that
 * cannot be styled or disabled, so while `disabled` a transparent shield covers it (mouse) and the container is
 * `inert` (keyboard, assistive tech). Until Google has drawn (or failed to), a muted "Connecting to Google…" fills the
 * otherwise empty slot.
 */
export const ClarivaGoogleButton: React.FC<Props> = ({
    text,
    onCredential,
    disabled,
    onUnavailable,
    autoFocus,
    testId,
}) => {
    const wrapRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    // true from the moment a render starts until Google has drawn (or the attempt failed); aborted runs never touch it
    const [pending, setPending] = useState(true);
    // GIS keeps one global callback: route it to the latest handler without re-rendering the button on every render.
    const handlerRef = useRef(onCredential);
    handlerRef.current = onCredential;
    const disabledRef = useRef(disabled);
    disabledRef.current = disabled;
    const unavailableRef = useRef(onUnavailable);
    unavailableRef.current = onUnavailable;

    // once, on mount (the caller sets it only for a button it mounted because the user asked for one)
    useEffect(() => {
        if (autoFocus) wrapRef.current?.focus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Google draws the button at a FIXED width, so it must match the container once the layout has settled (a phone card
    // is narrower than the 400px cap, and it changes on rotation / resize). null = not measured yet; 0 = cannot measure
    // (no ResizeObserver: Google then falls back to the container width at render time).
    const [width, setWidth] = useState<number | null>(typeof ResizeObserver === "undefined" ? 0 : null);
    useEffect(() => {
        const el = containerRef.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        let timer: number | undefined;
        const measure = (): void => {
            const next = Math.floor(el.clientWidth / 4) * 4;
            setWidth((prev) => (prev !== null && Math.abs(prev - next) < 4 ? prev : next));
        };
        measure();
        // a resize drag fires continuously: re-measure once it settles
        const observer = new ResizeObserver(() => {
            window.clearTimeout(timer);
            timer = window.setTimeout(measure, 150);
        });
        observer.observe(el);
        return () => {
            window.clearTimeout(timer);
            observer.disconnect();
        };
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || width === null) return;
        const controller = new AbortController();
        const { signal } = controller;
        let dispose: (() => void) | undefined;
        setPending(true);
        renderGoogleButton(container, {
            text,
            // `text` is this render's: the handler learns which button (sign-in or sign-up) delivered the token
            onCredential: (token) => {
                if (!disabledRef.current) handlerRef.current(token, text);
            },
            signal,
            width: width || undefined,
        })
            .then((rendered) => {
                if (signal.aborted) {
                    rendered.dispose();
                    return;
                }
                dispose = rendered.dispose;
                void rendered.ready.then((outcome) => {
                    if (signal.aborted) return;
                    setPending(false);
                    if (!outcome.ok) unavailableRef.current?.(outcome.reason);
                });
            })
            .catch((e: unknown) => {
                logger.warn("Clariva: Google sign-in is unavailable", e);
                if (!signal.aborted) {
                    setPending(false);
                    unavailableRef.current?.(e instanceof GoogleUnavailableError ? e.reason : "render_failed");
                }
            });
        return () => {
            controller.abort();
            dispose?.();
        };
    }, [text, width]);

    // `inert` is not a React 17 prop: set the attribute by hand
    useEffect(() => {
        containerRef.current?.toggleAttribute("inert", !!disabled);
    }, [disabled]);

    // Names the wrapper for a screen reader when focus is moved here after "Try again" (Google's own iframe is still empty then).
    const label =
        text === "signup_with"
            ? authStrings.signUpWithGoogle
            : text === "signin_with"
              ? authStrings.signInWithGoogle
              : undefined;

    return (
        <div
            ref={wrapRef}
            className="mx_ClarivaAuth_googleWrap"
            tabIndex={-1}
            role={label ? "group" : undefined}
            aria-label={label}
            aria-busy={pending}
            data-testid={testId}
        >
            <div ref={containerRef} className="mx_ClarivaAuth_googleButton" />
            {pending && (
                <span className="mx_ClarivaAuth_googleLoading" aria-hidden>
                    {authStrings.googleLoading}
                </span>
            )}
            {disabled && <div className="mx_ClarivaAuth_googleShield" aria-hidden />}
        </div>
    );
};
