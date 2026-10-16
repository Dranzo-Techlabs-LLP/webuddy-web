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

import { useLayoutEffect } from "react";

import { isClarivaEnabled } from "../../config";
import { clarivaViewFor } from "./viewState";

/** Set `<html data-clariva-view="...">` for as long as the calling component is mounted (before first paint). */
function useViewAttribute(value: string | null): void {
    useLayoutEffect(() => {
        if (value === null) return;
        const root = document.documentElement;
        root.dataset.clarivaView = value;
        return () => {
            delete root.dataset.clarivaView;
        };
    }, [value]);
}

/**
 * Mirrors the visual viewport into `--clariva-vvh` / `--clariva-vv-top` on <html>, so the phone layout (see
 * _responsive.pcss) is exactly as tall as what is visible: the composer stays above the on-screen keyboard on iOS
 * Safari and on Chrome Android (which, by default, only overlays the keyboard). Skipped while the user pinch-zooms.
 */
function useVisualViewportVars(enabled: boolean): void {
    useLayoutEffect(() => {
        if (!enabled) return;
        const viewport = window.visualViewport;
        if (!viewport) return;
        const root = document.documentElement;

        const apply = (): void => {
            if (viewport.scale > 1.01) {
                root.style.removeProperty("--clariva-vvh");
                root.style.removeProperty("--clariva-vv-top");
                return;
            }
            root.style.setProperty("--clariva-vvh", `${Math.round(viewport.height)}px`);
            root.style.setProperty("--clariva-vv-top", `${Math.round(viewport.offsetTop)}px`);
        };
        apply();
        viewport.addEventListener("resize", apply);
        viewport.addEventListener("scroll", apply);
        return () => {
            viewport.removeEventListener("resize", apply);
            viewport.removeEventListener("scroll", apply);
            root.style.removeProperty("--clariva-vvh");
            root.style.removeProperty("--clariva-vv-top");
        };
    }, [enabled]);
}

interface Props {
    /** `page_type` of LoggedInView (home page / room view / user view). */
    pageType?: string;
}

/**
 * Renders nothing; keeps `<html data-clariva-view="list|detail">` (what a phone shows, see `clarivaViewFor`) for the
 * responsive CSS. The other half of the scope, `<html data-clariva>`, is set by `isClarivaEnabled()` itself (see
 * ../../rootMarker.ts), so the check below also guarantees the marker is there before first paint.
 */
export function ClarivaShell({ pageType }: Props): null {
    const enabled = isClarivaEnabled();
    useViewAttribute(enabled ? clarivaViewFor(pageType) : null);
    useVisualViewportVars(enabled);
    return null;
}

export default ClarivaShell;
