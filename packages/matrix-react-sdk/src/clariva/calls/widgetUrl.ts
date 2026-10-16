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

import { elementCallPageUrl } from "./config";

export interface ClarivaWidgetUrlInput {
    /** Absolute Element Call base URL with trailing slash (see `resolveElementCallBaseUrl`). */
    baseUrl: string;
    userId: string;
    deviceId: string;
    roomId: string;
    /** The homeserver base URL (`client.baseUrl`). */
    homeserverBaseUrl: string;
    /** BCP-47 language tag. */
    language: string;
    /** Root font size divided by the browser default. */
    fontScale: number;
    /** Custom fonts (the user's `useSystemFont` setting), one `font` param each. */
    fonts?: string[];
}

/**
 * Template variables the widget-api URL templating fills in from `widget.data` / the client at render time
 * (`$name` is replaced by `encodeURIComponent(value)`):
 *
 *  - `$intent`                         `ElementWidgetData.intent` (set by `ElementCall.getWidgetData`)
 *  - `$perParticipantE2EE`             true iff the room has an `m.room.encryption` event
 *  - `$org.matrix.msc2873.client_theme` the current Element theme
 */
export const INTENT_VARIABLE = "$intent";
export const PER_PARTICIPANT_E2EE_VARIABLE = "$perParticipantE2EE";
export const THEME_VARIABLE = "$org.matrix.msc2873.client_theme";

/**
 * The widget URL for Element Call 0.16.x (spec 04 §6.4, with the corrections found by the spike):
 *
 *  - the PATH is `<base>index.html`, not `/room`: EC loads `/config.json` from the site root in "standalone"
 *    (`/room`) mode, which on the web host is Element Web's own config. As a widget it loads the `config.json` next
 *    to the page, i.e. `res/element-call/config.json`.
 *  - everything is in the fragment (`#?...`): EC reads the fragment first, and the host appends `widgetId` /
 *    `parentUrl` as query params itself (`StopGapWidget.runUrlTemplate`).
 *  - `intent` decides lobby / ring / auto-leave / camera default; `skipLobby`, `returnToLobby`, `embed`, `hideHeader`
 *    are deliberately NOT sent (the stock 3.108 URL carries them for older EC builds).
 *  - `header=none&controlledAudioDevices=false` are explicit because the intent presets pick the *mobile* variants
 *    (app bar, native audio routing) when the user agent looks like Android/iOS, which is right for the Android
 *    WebView and wrong for a phone browser hosting Element Web.
 *  - no tokens, no analytics ids.
 */
export function buildClarivaCallWidgetUrl(input: ClarivaWidgetUrlInput): URL {
    const params = new URLSearchParams();
    params.set("intent", INTENT_VARIABLE);
    params.set("userId", input.userId);
    params.set("deviceId", input.deviceId);
    params.set("roomId", input.roomId);
    params.set("baseUrl", input.homeserverBaseUrl);
    params.set("lang", input.language);
    params.set("fontScale", String(input.fontScale));
    params.set("theme", THEME_VARIABLE);
    params.set("perParticipantE2EE", PER_PARTICIPANT_E2EE_VARIABLE);
    params.set("preload", "false");
    params.set("header", "none");
    params.set("controlledAudioDevices", "false");
    for (const font of input.fonts ?? []) params.append("font", font);

    const url = elementCallPageUrl(input.baseUrl);
    // `$` must stay literal so the widget-api templating can find the variables; it has no meaning in a URL.
    url.hash = `#?${params.toString().replace(/%24/g, "$")}`;
    return url;
}
