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

import { useEffect, useState } from "react";

import { CLARIVA_PHONE_QUERY } from "./viewState";

interface SharedQuery {
    list: MediaQueryList;
    listeners: Set<(matches: boolean) => void>;
    onChange: () => void;
}

/** One `MediaQueryList` (and one browser listener) per query, shared by every hook user (a chat list has many rows). */
const shared = new Map<string, SharedQuery>();

function lookUp(query: string): MediaQueryList | null {
    try {
        return typeof window !== "undefined" && typeof window.matchMedia === "function"
            ? window.matchMedia(query)
            : null;
    } catch {
        return null;
    }
}

function matches(query: string): boolean {
    return shared.get(query)?.list.matches ?? lookUp(query)?.matches ?? false;
}

function subscribe(query: string, listener: (matches: boolean) => void): () => void {
    let entry = shared.get(query);
    if (!entry) {
        const list = lookUp(query);
        if (!list) return () => {};
        const listeners = new Set<(matches: boolean) => void>();
        const onChange = (): void => listeners.forEach((l) => l(list.matches));
        // Safari < 14 only knows the deprecated addListener.
        if (typeof list.addEventListener === "function") list.addEventListener("change", onChange);
        else list.addListener(onChange);
        entry = { list, listeners, onChange };
        shared.set(query, entry);
    }
    const current = entry;
    current.listeners.add(listener);
    return () => {
        current.listeners.delete(listener);
        if (current.listeners.size > 0) return;
        if (typeof current.list.removeEventListener === "function") {
            current.list.removeEventListener("change", current.onChange);
        } else {
            current.list.removeListener(current.onChange);
        }
        shared.delete(query);
    };
}

/**
 * Live result of a CSS media query (React 17: state + a shared `matchMedia` listener). Only for the few places where
 * the markup itself has to differ (everything else is plain CSS in `_responsive.pcss`). `false` without matchMedia.
 */
export function useMediaQuery(query: string): boolean {
    const [value, setValue] = useState(() => matches(query));
    useEffect(() => {
        setValue(matches(query));
        return subscribe(query, setValue);
    }, [query]);
    return value;
}

/** True on a phone-sized viewport (<= 768px): single-pane master/detail layout. */
export function useIsPhone(): boolean {
    return useMediaQuery(CLARIVA_PHONE_QUERY);
}
