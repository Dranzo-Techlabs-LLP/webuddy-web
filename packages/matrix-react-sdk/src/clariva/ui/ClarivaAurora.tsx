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

import React, { useEffect, useState } from "react";
import classNames from "classnames";

export interface ClarivaAuroraProps {
    /**
     * Let the aurora drift. Only where DESIGN-SYSTEM.md allows it (nothing with a backdrop-filter may overlap an animated
     * layer): the sign-in page behind ONE glass card, and the Home dashboard as a decorative glow behind the greeting that
     * no glass card overlaps. A chat room uses the static wallpaper of the app canvas and does not render this at all.
     * Default false: a still layer.
     */
    live?: boolean;
    className?: string;
}

const isHidden = (): boolean => typeof document !== "undefined" && document.hidden === true;

/**
 * The aurora wallpaper as a layer (res/css/clariva/_glass.pcss `.cg-aurora`): it fills its positioned parent and sits
 * behind the parent's in-flow content (z-index -1), so the parent must be a stacking context (`isolation: isolate`).
 * A live layer pauses its drift (`cg-paused`) while the tab is hidden (visibilitychange) AND while the window has lost
 * focus (window blur / focus: another app is in front, or focus is inside an iframe), so a layer nobody is looking at
 * costs nothing. prefers-reduced-motion is handled in CSS only (no JS media query, no flash of motion): the drift simply
 * does not run.
 */
export function ClarivaAurora({ live = false, className }: ClarivaAuroraProps): JSX.Element {
    const [paused, setPaused] = useState<boolean>(isHidden);

    useEffect(() => {
        if (!live) return;
        // `document.hasFocus()` is not read: it is false in a freshly mounted page that no element has focus in yet. Track
        // the events instead; a window that never saw a blur is assumed focused.
        let windowBlurred = false;
        const sync = (): void => setPaused(windowBlurred || isHidden());
        const onBlur = (): void => {
            windowBlurred = true;
            sync();
        };
        const onFocus = (): void => {
            windowBlurred = false;
            sync();
        };
        sync();
        document.addEventListener("visibilitychange", sync);
        window.addEventListener("blur", onBlur);
        window.addEventListener("focus", onFocus);
        return () => {
            document.removeEventListener("visibilitychange", sync);
            window.removeEventListener("blur", onBlur);
            window.removeEventListener("focus", onFocus);
        };
    }, [live]);

    return (
        <div
            className={classNames("cg-aurora", className, {
                "cg-aurora--live": live,
                "cg-paused": live && paused,
            })}
            aria-hidden="true"
            data-testid="clariva-aurora"
        />
    );
}

export default ClarivaAurora;
