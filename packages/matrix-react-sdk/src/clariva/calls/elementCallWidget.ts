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

import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { type IWidgetData } from "matrix-widget-api";

import SdkConfig from "../../SdkConfig";
import SettingsStore from "../../settings/SettingsStore";
import { FontWatcher } from "../../settings/watchers/FontWatcher";
import { getCurrentLanguage } from "../../languageHandler";
import { safeCallDmPeerId } from "../chat/useChatGate";
import { applyClarivaCallsDefaults, isClarivaCallsEnabled, resolveElementCallBaseUrl } from "./config";
import { type ElementCallIntent, intentFor, intentSkipsLobby } from "./intent";
import { roomHasLiveCall, getRoomLiveMemberships } from "./memberships";
import { buildClarivaCallWidgetUrl } from "./widgetUrl";

/**
 * Glue between Element Web's `ElementCall` model (`models/Call.ts`) and the Clariva call code. Everything here is only
 * reached when `clariva.features.calls` is on.
 */

/** The custom fonts of the user's `useSystemFont` setting, as Element's stock builder forwards them to EC. */
function systemFonts(): string[] {
    if (!SettingsStore.getValue("useSystemFont")) return [];
    return SettingsStore.getValue<string>("systemFont")
        .split(",")
        .map((font) => {
            font = font.trim();
            if (font.startsWith('"') && font.endsWith('"')) font = font.slice(1, -1);
            return font;
        })
        .filter((font) => font.length > 0);
}

/** Replacement for `ElementCall.generateWidgetUrl` (EC 0.16.x contract, see `buildClarivaCallWidgetUrl`). */
export function generateClarivaWidgetUrl(client: MatrixClient, roomId: string): URL {
    applyClarivaCallsDefaults();
    return buildClarivaCallWidgetUrl({
        baseUrl: resolveElementCallBaseUrl(SdkConfig.get("element_call")?.url, window.location.origin),
        userId: client.getSafeUserId(),
        deviceId: client.getDeviceId() ?? "",
        roomId,
        homeserverBaseUrl: client.baseUrl,
        language: getCurrentLanguage().replace("_", "-"),
        fontScale: FontWatcher.getRootFontSize() / FontWatcher.getBrowserDefaultFontSize(),
        fonts: systemFonts(),
    });
}

/**
 * The intent to use when nobody asked for a specific one (`ElementCall.get` auto-creating a widget for a call that
 * someone else started, the stock Join/`ViewRoom` paths): video, and `*_dm*` in a 1:1 chat.
 */
export function defaultIntentForRoom(room: Room | null | undefined): ElementCallIntent {
    return intentFor({
        direct: !!room && !!safeCallDmPeerId(room),
        hasActiveCall: !!room && roomHasLiveCall(room),
        voice: false,
    });
}

/**
 * Put the Element Call `intent` (which the widget URL template reads as `$intent`) into the widget data and keep
 * `skipLobby` consistent with it. An explicitly requested intent wins, then one already stored (a later
 * `ElementCall.get` must not clobber the user's "voice" choice), then the room's default.
 */
export function withClarivaIntent(
    data: IWidgetData,
    room: Room | null | undefined,
    requested?: ElementCallIntent,
): IWidgetData {
    const stored = typeof data.intent === "string" ? (data.intent as ElementCallIntent) : undefined;
    const intent = requested ?? stored ?? defaultIntentForRoom(room);
    return { ...data, intent, ...(intentSkipsLobby(intent) ? { skipLobby: true } : {}) };
}

/**
 * Are Clariva's 1:1 call flows in charge of this room (calls enabled and the room is a 1:1 chat)? Decided by the CALL
 * peer (`getClarivaCallDmPeerId`), the same one as the header controls and the ring, so `Notifier`'s suppression of
 * Element's legacy call toast and the Clariva ring always agree.
 */
export function isClarivaDmCall(room: Room | null | undefined): boolean {
    return isClarivaCallsEnabled() && !!room && !!safeCallDmPeerId(room);
}

/** `sender|device` keys of the live memberships, to filter js-sdk's never-expiring session memberships. */
export function liveDeviceKeys(room: Room): Set<string> {
    return new Set(getRoomLiveMemberships(room).map((m) => `${m.sender}|${m.deviceId}`));
}
