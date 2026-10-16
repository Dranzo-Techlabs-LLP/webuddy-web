/*
Copyright 2016 OpenMarket Ltd
Copyright 2019 - 2022 The Matrix.org Foundation C.I.C.

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

import { Optional } from "matrix-events-sdk";
import { mergeWith } from "lodash";

import { SnakedObject } from "./utils/SnakedObject";
import { IConfigOptions, ISsoRedirectOptions } from "./IConfigOptions";
import { isObject, objectClone } from "./utils/objects";
import { DeepReadonly, Defaultize } from "./@types/common";

// see element-web config.md for docs, or the IConfigOptions interface for dev docs
// CLARIVA: white-label defaults (docs/clariva/spec/06-branding-whitelabel.md section 7/8). Every Element-run service
// (help site, Scalar integration manager, Jitsi, desktop/mobile promos, GitHub feedback) was replaced by a Clariva value
// or removed, so a build without any config.json still contains no Element branding or Element endpoints.
export const DEFAULTS: DeepReadonly<IConfigOptions> = {
    brand: "Clariva",
    help_url: "https://clarivahub.com",
    help_encryption_url: "https://clarivahub.com",
    // CLARIVA: no integrations_ui_url / integrations_rest_url (no Scalar integration manager) and no `jitsi` default.
    uisi_autorageshake_app: "clariva-web-auto-uisi",
    show_labs_settings: false,

    element_call: {
        // CLARIVA: stock Element Call host kept as the technical fallback; Clariva calls are behind
        // `clariva.features.calls` and production config.json must point `url` at the Clariva-hosted build
        // (see docs/clariva/DEPLOY.md).
        url: "https://call.element.io",
        use_exclusively: false,
        participant_limit: 8,
        brand: "Clariva Call",
    },

    voice_broadcast: {
        chunk_length: 2 * 60, // two minutes
        max_length: 4 * 60 * 60, // four hours
    },

    feedback: {
        // CLARIVA: unused while UIFeature.feedback is off and bug_report_endpoint_url is unset
        existing_issues_url: "https://clarivahub.com",
        new_issue_url: "https://clarivahub.com",
    },

    desktop_builds: {
        // CLARIVA: there is no Clariva desktop app
        available: false,
        logo: "themes/clariva/img/logos/clariva-logo.svg",
        url: "https://clarivahub.com",
    },
    mobile_builds: {
        // CLARIVA: Android app only (Google Play listing com.dranzo.clariva)
        ios: null,
        android: "https://play.google.com/store/apps/details?id=com.dranzo.clariva",
        fdroid: null,
    },
};

export type ConfigOptions = Defaultize<IConfigOptions, typeof DEFAULTS>;

function mergeConfig(
    config: DeepReadonly<IConfigOptions>,
    changes: DeepReadonly<Partial<IConfigOptions>>,
): DeepReadonly<IConfigOptions> {
    // return { ...config, ...changes };
    return mergeWith(objectClone(config), changes, (objValue, srcValue) => {
        // Don't merge arrays, prefer values from newer object
        if (Array.isArray(objValue)) {
            return srcValue;
        }

        // Don't allow objects to get nulled out, this will break our types
        if (isObject(objValue) && !isObject(srcValue)) {
            return objValue;
        }
    });
}

type ObjectType<K extends keyof IConfigOptions> = IConfigOptions[K] extends object
    ? SnakedObject<NonNullable<IConfigOptions[K]>>
    : Optional<SnakedObject<NonNullable<IConfigOptions[K]>>>;

export default class SdkConfig {
    private static instance: DeepReadonly<IConfigOptions>;
    private static fallback: SnakedObject<DeepReadonly<IConfigOptions>>;

    private static setInstance(i: DeepReadonly<IConfigOptions>): void {
        SdkConfig.instance = i;
        SdkConfig.fallback = new SnakedObject(i);

        // For debugging purposes
        window.mxReactSdkConfig = i;
    }

    public static get(): IConfigOptions;
    public static get<K extends keyof IConfigOptions>(key: K, altCaseName?: string): IConfigOptions[K];
    public static get<K extends keyof IConfigOptions = never>(
        key?: K,
        altCaseName?: string,
    ): DeepReadonly<IConfigOptions> | DeepReadonly<IConfigOptions>[K] {
        if (key === undefined) {
            // safe to cast as a fallback - we want to break the runtime contract in this case
            return SdkConfig.instance || <IConfigOptions>{};
        }
        return SdkConfig.fallback.get(key, altCaseName);
    }

    public static getObject<K extends keyof IConfigOptions>(key: K, altCaseName?: string): ObjectType<K> {
        const val = SdkConfig.get(key, altCaseName);
        if (isObject(val)) {
            return new SnakedObject(val);
        }

        // return the same type for sensitive callers (some want `undefined` specifically)
        return (val === undefined ? undefined : null) as ObjectType<K>;
    }

    public static put(cfg: DeepReadonly<ConfigOptions>): void {
        SdkConfig.setInstance(mergeConfig(DEFAULTS, cfg));
    }

    /**
     * Resets the config.
     */
    public static reset(): void {
        SdkConfig.setInstance(mergeConfig(DEFAULTS, {})); // safe to cast - defaults will be applied
    }

    public static add(cfg: Partial<ConfigOptions>): void {
        SdkConfig.put(mergeConfig(SdkConfig.get(), cfg));
    }
}

export function parseSsoRedirectOptions(config: IConfigOptions): ISsoRedirectOptions {
    // Ignore deprecated options if the config is using new ones
    if (config.sso_redirect_options) return config.sso_redirect_options;

    // We can cheat here because the default is false anyways
    if (config.sso_immediate_redirect) return { immediate: true };

    // Default: do nothing
    return {};
}
