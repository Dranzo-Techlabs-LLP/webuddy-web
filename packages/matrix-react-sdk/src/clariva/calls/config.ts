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

import { logger } from "matrix-js-sdk/src/logger";

import SdkConfig from "../../SdkConfig";
import { getClarivaConfig, isClarivaEnabled } from "../config";

/** Where the bundled Element Call 0.16.3 build is served from when `element_call.url` is not configured. */
export const BUNDLED_ELEMENT_CALL_PATH = "/element-call/";

/** The stock default of `SdkConfig`; Clariva never uses Element's hosted EC (other version, other privacy owner). */
const STOCK_ELEMENT_CALL_HOST = "https://call.element.io";

/** The single switch for everything in `src/clariva/calls`: Clariva configured AND `clariva.features.calls`. */
export function isClarivaCallsEnabled(): boolean {
    return isClarivaEnabled() && getClarivaConfig().features.calls;
}

/**
 * The absolute base URL (with a trailing slash) of the Element Call build, resolved against the web app's origin.
 *
 *  - not configured, or the stock `https://call.element.io` default  -> `<origin>/element-call/` (the bundled build)
 *  - relative (`/element-call/`, `element-call`)                       -> resolved against the origin
 *  - absolute (`https://call.clarivahub.com/`)                         -> as is (recommended in production, see notes)
 *
 * Pure so it can be tested; the stock driver does `new URL(element_call.url)` and would throw on a relative value.
 */
export function resolveElementCallBaseUrl(configured: string | null | undefined, origin: string): string {
    const raw = (configured ?? "").trim();
    let url: URL;
    if (!raw || raw.replace(/\/+$/, "") === STOCK_ELEMENT_CALL_HOST) {
        url = new URL(BUNDLED_ELEMENT_CALL_PATH, origin);
    } else {
        url = new URL(raw, `${origin.replace(/\/+$/, "")}/`);
    }
    if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
    url.search = "";
    url.hash = "";
    return url.toString();
}

/** The URL of the page that is embedded as the widget: `<base>index.html` (see the spike notes: NOT `/room`). */
export function elementCallPageUrl(baseUrl: string): URL {
    return new URL("index.html", baseUrl);
}

let applied = false;

/**
 * Make `clariva.features.calls` the only switch: Element Web's call code also reads `feature_group_calls` (labs flag)
 * and `element_call.{url,use_exclusively}`. Deployments would otherwise have to keep three settings in sync, and a
 * missed one fails silently (`ElementCall.get` returns null, no toasts, no Join). Idempotent; a no-op unless the
 * Clariva calls feature is on. Call it before the first `ElementCall` lookup (we call it from `Notifier.start`).
 */
export function applyClarivaCallsDefaults(): boolean {
    if (!isClarivaCallsEnabled()) return false;
    const current = SdkConfig.get("element_call");
    const url = resolveElementCallBaseUrl(current?.url, window.location.origin);
    if (applied && current?.url === url) return true;
    SdkConfig.add({
        features: { feature_group_calls: true },
        element_call: {
            url,
            // DMs use Clariva's own call controls; groups stay on Element Call and must never offer the legacy
            // `m.call.invite` calls (Android shows "Unsupported call" for them).
            use_exclusively: true,
            brand: current?.brand ?? "Clariva Call",
            participant_limit: current?.participant_limit ?? 8,
        },
    });
    applied = true;
    logger.info(`Clariva calls: Element Call at ${url}`);
    return true;
}

/** Test helper. */
export function resetClarivaCallsConfigForTests(): void {
    applied = false;
}
