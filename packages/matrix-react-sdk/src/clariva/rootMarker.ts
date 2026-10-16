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
 * Styling hook: `<html data-clariva>` is present exactly when the deployment configured a Clariva API, so global
 * look-and-feel overrides (dialogs, settings chrome, toasts, ...) can be scoped with `:root[data-clariva]` and the
 * fork keeps looking like stock Element Web when Clariva is not configured. Idempotent and never throws.
 */
export function markClarivaRoot(): void {
    try {
        if (typeof document === "undefined") return;
        const root = document.documentElement;
        if (root && !root.hasAttribute("data-clariva")) root.setAttribute("data-clariva", "");
    } catch {
        // a styling hook must never break the app
    }
}
