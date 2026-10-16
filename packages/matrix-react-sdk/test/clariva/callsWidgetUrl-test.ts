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

import { runTemplate } from "matrix-widget-api";

import SdkConfig from "../../src/SdkConfig";
import SettingsStore from "../../src/settings/SettingsStore";
import {
    applyClarivaCallsDefaults,
    elementCallPageUrl,
    isClarivaCallsEnabled,
    resetClarivaCallsConfigForTests,
    resolveElementCallBaseUrl,
} from "../../src/clariva/calls/config";
import { buildClarivaCallWidgetUrl } from "../../src/clariva/calls/widgetUrl";
import { withClarivaIntent } from "../../src/clariva/calls/elementCallWidget";
import { configureClariva } from "./helpers";

describe("resolveElementCallBaseUrl", () => {
    const origin = "https://app.clarivahub.com";

    it("falls back to the bundled build for an unset value and for Element's hosted default", () => {
        expect(resolveElementCallBaseUrl(undefined, origin)).toBe("https://app.clarivahub.com/element-call/");
        expect(resolveElementCallBaseUrl("", origin)).toBe("https://app.clarivahub.com/element-call/");
        expect(resolveElementCallBaseUrl("https://call.element.io", origin)).toBe(
            "https://app.clarivahub.com/element-call/",
        );
        expect(resolveElementCallBaseUrl("https://call.element.io/", origin)).toBe(
            "https://app.clarivahub.com/element-call/",
        );
    });

    it("resolves relative values against the web origin", () => {
        expect(resolveElementCallBaseUrl("/element-call/", origin)).toBe("https://app.clarivahub.com/element-call/");
        expect(resolveElementCallBaseUrl("/element-call", origin)).toBe("https://app.clarivahub.com/element-call/");
        expect(resolveElementCallBaseUrl("call/", `${origin}/`)).toBe("https://app.clarivahub.com/call/");
    });

    it("keeps an absolute (own-origin) deployment and normalises the slash, query and hash", () => {
        expect(resolveElementCallBaseUrl("https://call.clarivahub.com", origin)).toBe("https://call.clarivahub.com/");
        expect(resolveElementCallBaseUrl("https://call.clarivahub.com/x?y=1#z", origin)).toBe(
            "https://call.clarivahub.com/x/",
        );
    });

    it("the widget page is index.html next to config.json (never /room)", () => {
        expect(elementCallPageUrl("https://app.clarivahub.com/element-call/").pathname).toBe(
            "/element-call/index.html",
        );
        expect(elementCallPageUrl("https://call.clarivahub.com/").pathname).toBe("/index.html");
    });
});

describe("buildClarivaCallWidgetUrl (Element Call 0.16.x contract)", () => {
    const input = {
        baseUrl: "https://app.clarivahub.com/element-call/",
        userId: "@me:clarivahub.com",
        deviceId: "DEV",
        roomId: "!room:clarivahub.com",
        homeserverBaseUrl: "https://matrix.clarivahub.com",
        language: "en-GB",
        fontScale: 1.25,
    };

    const params = (url: URL): URLSearchParams => new URLSearchParams(url.hash.slice(url.hash.indexOf("?")));

    it("is <base>index.html with everything in the fragment", () => {
        const url = buildClarivaCallWidgetUrl(input);
        expect(url.origin + url.pathname).toBe("https://app.clarivahub.com/element-call/index.html");
        expect(url.search).toBe("");
        expect(url.hash.startsWith("#?")).toBe(true);
    });

    it("carries the mandatory widget parameters and the explicit desktop presets", () => {
        const p = params(buildClarivaCallWidgetUrl(input));
        expect(p.get("userId")).toBe("@me:clarivahub.com");
        expect(p.get("deviceId")).toBe("DEV");
        expect(p.get("roomId")).toBe("!room:clarivahub.com");
        expect(p.get("baseUrl")).toBe("https://matrix.clarivahub.com");
        expect(p.get("lang")).toBe("en-GB");
        expect(p.get("fontScale")).toBe("1.25");
        expect(p.get("preload")).toBe("false");
        expect(p.get("header")).toBe("none");
        expect(p.get("controlledAudioDevices")).toBe("false");
    });

    it("does not send the parameters of the old contract or anything private", () => {
        const p = params(buildClarivaCallWidgetUrl(input));
        for (const name of [
            "embed",
            "hideHeader",
            "skipLobby",
            "returnToLobby",
            "analyticsID",
            "access_token",
            "password",
        ]) {
            expect(p.has(name)).toBe(false);
        }
    });

    it("keeps the template variables literal and the widget-api fills them from the widget data", () => {
        const url = buildClarivaCallWidgetUrl(input);
        expect(url.hash).toContain("intent=$intent");
        expect(url.hash).toContain("perParticipantE2EE=$perParticipantE2EE");
        expect(url.hash).toContain("theme=$org.matrix.msc2873.client_theme");

        const filled = runTemplate(
            url.toString(),
            {
                id: "w",
                creatorUserId: "@me:clarivahub.com",
                type: "m.custom",
                url: url.toString(),
                name: "Element Call",
                data: { intent: "start_call_dm_voice", perParticipantE2EE: true },
            } as any,
            { currentUserId: "@me:clarivahub.com", clientTheme: "dark", widgetRoomId: "!room:clarivahub.com" },
        );
        const p = params(new URL(filled));
        expect(p.get("intent")).toBe("start_call_dm_voice");
        expect(p.get("perParticipantE2EE")).toBe("true");
        expect(p.get("theme")).toBe("dark");
    });

    it("forwards custom fonts, one parameter each", () => {
        const p = params(buildClarivaCallWidgetUrl({ ...input, fonts: ["Inter", "Noto Sans"] }));
        expect(p.getAll("font")).toEqual(["Inter", "Noto Sans"]);
    });
});

describe("withClarivaIntent", () => {
    it("an explicit intent wins, then the stored one, then the room default", () => {
        expect(withClarivaIntent({ intent: "join_existing_dm" }, null, "start_call_dm_voice").intent).toBe(
            "start_call_dm_voice",
        );
        expect(withClarivaIntent({ intent: "start_call_dm_voice" }, null).intent).toBe("start_call_dm_voice");
        // no room: not a DM, nothing running -> the group default
        expect(withClarivaIntent({}, null).intent).toBe("start_call");
    });

    it("keeps skipLobby consistent with the intent (DM intents skip the host lobby)", () => {
        expect(withClarivaIntent({ skipLobby: false }, null, "start_call_dm").skipLobby).toBe(true);
        expect(withClarivaIntent({ skipLobby: false }, null, "join_existing_dm_voice").skipLobby).toBe(true);
        expect(withClarivaIntent({ skipLobby: false }, null, "start_call").skipLobby).toBe(false);
        expect(withClarivaIntent({ skipLobby: true }, null, "join_existing").skipLobby).toBe(true);
    });

    it("does not touch the other widget data", () => {
        const data = withClarivaIntent({ perParticipantE2EE: true, preload: false }, null, "start_call_dm");
        expect(data).toMatchObject({ perParticipantE2EE: true, preload: false, intent: "start_call_dm" });
    });
});

describe("applyClarivaCallsDefaults", () => {
    beforeEach(() => {
        resetClarivaCallsConfigForTests();
        SdkConfig.reset();
    });

    afterEach(() => {
        SdkConfig.reset();
        resetClarivaCallsConfigForTests();
    });

    it("is a no-op while the calls feature is off (default)", () => {
        configureClariva();
        expect(isClarivaCallsEnabled()).toBe(false);
        expect(applyClarivaCallsDefaults()).toBe(false);
        expect(SdkConfig.get("features")?.feature_group_calls).toBeUndefined();
        expect(SdkConfig.get("element_call").use_exclusively).toBe(false);
    });

    it("needs the Clariva API too", () => {
        SdkConfig.add({ clariva: { features: { calls: true } } } as any);
        expect(isClarivaCallsEnabled()).toBe(false);
    });

    it("makes clariva.features.calls the single switch", () => {
        configureClariva({ features: { calls: true } });
        expect(isClarivaCallsEnabled()).toBe(true);
        expect(applyClarivaCallsDefaults()).toBe(true);
        expect(SdkConfig.get("features")?.feature_group_calls).toBe(true);
        // ... and the labs flag Element's call code actually reads follows it
        expect(SettingsStore.getValue("feature_group_calls")).toBe(true);
        expect(SdkConfig.get("element_call")).toMatchObject({
            url: `${window.location.origin}/element-call/`,
            use_exclusively: true,
            brand: "Clariva Call",
        });
        // idempotent
        expect(applyClarivaCallsDefaults()).toBe(true);
        expect(SdkConfig.get("element_call").url).toBe(`${window.location.origin}/element-call/`);
    });

    it("honours a configured EC origin and makes relative values absolute", () => {
        configureClariva({ features: { calls: true } });
        SdkConfig.add({ element_call: { url: "https://call.clarivahub.com" } } as any);
        applyClarivaCallsDefaults();
        expect(SdkConfig.get("element_call").url).toBe("https://call.clarivahub.com/");

        resetClarivaCallsConfigForTests();
        SdkConfig.add({ element_call: { url: "/call/" } } as any);
        applyClarivaCallsDefaults();
        expect(SdkConfig.get("element_call").url).toBe(`${window.location.origin}/call/`);
    });
});
