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

import React, { useLayoutEffect, useRef } from "react";

/** The custom property the timeline reads to keep its last message clear of the floating composer. */
export const COMPOSER_HEIGHT_VAR = "--cg-composer-h";

interface Props {
    /** Called (at most once per frame) after the height changed, so the timeline can keep its scroll position. */
    onChange?: () => void;
}

/**
 * Mirrors the height of the floating composer into `--cg-composer-h` on the room body (`.mx_RoomView_body`), which is
 * what `_chatroom.pcss` uses to (1) let the timeline run UNDER the composer and (2) pad its end so the last message is
 * never hidden, whatever the composer is showing: one line, five lines, a reply preview, the "Chat restricted" banner.
 * Renders nothing. A composer outside the room body (a thread's) has no room body, so this does nothing there.
 */
export function ClarivaComposerMeasure({ onChange }: Props): JSX.Element {
    const markerRef = useRef<HTMLSpanElement>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useLayoutEffect(() => {
        const composer = markerRef.current?.closest<HTMLElement>(".mx_MessageComposer");
        const body = composer?.closest<HTMLElement>(".mx_RoomView_body");
        if (!composer || !body) return;

        let frame = 0;
        let last = -1;
        const apply = (): void => {
            frame = 0;
            const height = Math.ceil(composer.getBoundingClientRect().height);
            if (height === last || height <= 0) return;
            last = height;
            body.style.setProperty(COMPOSER_HEIGHT_VAR, `${height}px`);
            onChangeRef.current?.();
        };
        apply();

        if (typeof ResizeObserver === "undefined") return () => body.style.removeProperty(COMPOSER_HEIGHT_VAR);
        const observer = new ResizeObserver(() => {
            if (!frame) frame = requestAnimationFrame(apply);
        });
        observer.observe(composer);
        return () => {
            observer.disconnect();
            if (frame) cancelAnimationFrame(frame);
            body.style.removeProperty(COMPOSER_HEIGHT_VAR);
        };
    }, []);

    return <span ref={markerRef} hidden />;
}
