/*
Copyright 2026 The Clariva Authors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import fs from "fs";
import path from "path";
import SdkConfig, { DEFAULTS } from "matrix-react-sdk/src/SdkConfig";
import { UIComponent } from "matrix-react-sdk/src/settings/UIFeature";

import { ComponentVisibilityCustomisations } from "../../src/customisations/ClarivaComponentVisibility";

/**
 * White-label guard rails (docs/clariva/spec/06-branding-whitelabel.md): no Element branding in the config files, the
 * SdkConfig defaults or the English string tables, the referenced brand assets exist, and the ComponentVisibility
 * customisation hides exactly what the brief asks for. Pure file / object checks, no React.
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), "utf8");
const readJson = (p: string): any => JSON.parse(read(p));

/** Every string value of a JSON document, with its key path. */
function stringsOf(value: unknown, prefix = ""): Array<[string, string]> {
    if (typeof value === "string") return [[prefix, value]];
    if (Array.isArray(value)) return value.flatMap((v, i) => stringsOf(v, `${prefix}[${i}]`));
    if (value && typeof value === "object") {
        return Object.entries(value).flatMap(([k, v]) => stringsOf(v, prefix ? `${prefix}.${k}` : k));
    }
    return [];
}

const ELEMENT_BRANDING = /\bElement\b|element\.io|vector\.im|riot\.im|element-hq|im\.vector\.app/;

describe("Clariva runtime configs", () => {
    describe.each(["config.clariva.json", "config.clariva.local.json"])("%s", (file) => {
        const config = readJson(file);

        it("is branded Clariva and carries no Element branding or Element endpoints", () => {
            expect(config.brand).toBe("Clariva");
            expect(stringsOf(config).filter(([, v]) => ELEMENT_BRANDING.test(v))).toEqual([]);
        });

        it("hides the stock Element features Clariva does not offer", () => {
            const defaults = config.setting_defaults;
            for (const key of [
                "UIFeature.registration",
                "UIFeature.passwordReset",
                "UIFeature.deactivate",
                "UIFeature.feedback",
                "UIFeature.identityServer",
                "UIFeature.thirdPartyId",
                "UIFeature.widgets",
                "UIFeature.locationSharing",
                "UIFeature.shareSocial",
            ]) {
                expect(defaults[key]).toBe(false);
            }
            expect(defaults.language).toBe("en");
            expect(config.show_labs_settings).toBe(false);
            expect(config.integrations_ui_url).toBeNull();
            expect(config.embedded_pages.login_for_welcome).toBe(true);
            for (const omitted of ["bug_report_endpoint_url", "posthog", "sentry", "map_style_url", "jitsi"]) {
                expect(config).not.toHaveProperty(omitted);
            }
        });

        it("only references brand assets that exist in res/", () => {
            const assets = [config.branding.auth_header_logo_url, config.embedded_pages.home_url];
            for (const asset of assets) {
                expect(fs.existsSync(path.join(ROOT, "res", asset))).toBe(true);
            }
        });
    });
});

describe("Clariva defaults and string tables", () => {
    it("SdkConfig DEFAULTS point at Clariva, not Element", () => {
        expect(DEFAULTS.brand).toBe("Clariva");
        expect(DEFAULTS.element_call.brand).toBe("Clariva Call");
        expect(DEFAULTS.integrations_ui_url).toBeUndefined();
        expect(DEFAULTS.jitsi).toBeUndefined();
        expect(DEFAULTS.desktop_builds.available).toBe(false);
        expect(DEFAULTS.mobile_builds).toEqual({
            ios: null,
            android: "https://play.google.com/store/apps/details?id=com.dranzo.clariva",
            fdroid: null,
        });
        // the stock Element Call host stays as the technical fallback (calls are behind clariva.features.calls)
        const { element_call: elementCall, ...rest } = DEFAULTS;
        expect(stringsOf(rest).filter(([, v]) => ELEMENT_BRANDING.test(v))).toEqual([]);
        expect(elementCall.url).toBe("https://call.element.io");
    });

    it.each(["src/i18n/strings/en_EN.json", "packages/matrix-react-sdk/src/i18n/strings/en_EN.json"])(
        "%s has no literal Element branding",
        (file) => {
            const offenders = stringsOf(readJson(file)).filter(([, v]) => /\bElement\b/.test(v));
            expect(offenders).toEqual([]);
        },
    );

    it("ships the brand assets the code refers to", () => {
        for (const asset of [
            "themes/clariva/img/logos/clariva-logo.svg",
            "themes/clariva/img/logos/clariva-app-logo.png",
            "themes/clariva/img/logos/opengraph.png",
            "themes/clariva/img/download/google.svg",
            "themes/clariva/img/compound/fade-arc-light.png",
            "vector-icons/favicon.ico",
            "home.html",
            "welcome.html",
            "manifest.json",
        ]) {
            expect(fs.existsSync(path.join(ROOT, "res", asset))).toBe(true);
        }
        const manifest = readJson("res/manifest.json");
        expect(manifest.name).toBe("Clariva");
        expect(manifest.theme_color).toBe("#00BFA5");
        expect(manifest.background_color).toBe("#F4F6FB");
    });

    /** Width and height from the IHDR chunk of a PNG file. */
    const pngSize = (file: string): [number, number] => {
        const png = fs.readFileSync(path.join(ROOT, "res", file));
        expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
        return [png.readUInt32BE(16), png.readUInt32BE(20)];
    };

    it("ships every icon the manifest and index.html list, at the declared size", () => {
        for (const icon of readJson("res/manifest.json").icons as Array<{ src: string; sizes: string }>) {
            expect(pngSize(icon.src.replace(/^\//, ""))).toEqual(icon.sizes.split("x").map(Number));
        }
        for (const size of [57, 60, 72, 76, 114, 120, 144, 152, 180]) {
            expect(pngSize(`vector-icons/apple-touch-icon-${size}.png`)).toEqual([size, size]);
        }
        expect(pngSize("vector-icons/mstile-310x150.png")).toEqual([310, 150]);
        expect(pngSize("themes/clariva/img/logos/opengraph.png")).toEqual([1200, 630]);
        const ico = fs.readFileSync(path.join(ROOT, "res/vector-icons/favicon.ico"));
        expect(ico.readUInt16LE(2)).toBe(1); // ICO type
        expect(ico.readUInt16LE(4)).toBe(3); // 16, 32 and 48 px
    });
});

describe("ClarivaComponentVisibility customisation", () => {
    const shouldShow = (component: UIComponent): boolean =>
        ComponentVisibilityCustomisations.shouldShowComponent!(component);

    beforeEach(() => {
        SdkConfig.reset();
    });

    afterEach(() => {
        SdkConfig.reset();
    });

    it("is wired in through customisations.json and replaces an existing SDK module", () => {
        const overrides = readJson("customisations.json") as Record<string, string>;
        const target = overrides["src/customisations/ComponentVisibility.ts"];
        expect(target).toBe("src/customisations/ClarivaComponentVisibility.ts");
        expect(fs.existsSync(path.join(ROOT, target))).toBe(true);
        expect(
            fs.existsSync(path.join(ROOT, "packages/matrix-react-sdk", "src/customisations/ComponentVisibility.ts")),
        ).toBe(true);
    });

    it("behaves like stock when the Clariva API is not configured", () => {
        SdkConfig.reset();
        for (const component of Object.values(UIComponent)) {
            expect(shouldShow(component)).toBe(true);
        }
    });

    it("hides explore rooms, space creation and integrations when Clariva is configured", () => {
        SdkConfig.add({ clariva: { api_base_url: "https://wallet.example.org" } });
        expect(shouldShow(UIComponent.ExploreRooms)).toBe(false);
        expect(shouldShow(UIComponent.CreateSpaces)).toBe(false);
        expect(shouldShow(UIComponent.AddIntegrations)).toBe(false);
    });

    it("keeps what the Clariva flows rely on (start chat, invites, filters, room options)", () => {
        SdkConfig.add({ clariva: { api_base_url: "https://wallet.example.org" } });
        expect(shouldShow(UIComponent.CreateRooms)).toBe(true);
        expect(shouldShow(UIComponent.InviteUsers)).toBe(true);
        expect(shouldShow(UIComponent.FilterContainer)).toBe(true);
        expect(shouldShow(UIComponent.RoomOptionsMenu)).toBe(true);
    });
});
