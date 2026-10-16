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

import SdkConfig from "../../../SdkConfig";

/** A "Privacy" / "Terms" style link under the landing form (config.json `branding.auth_footer_links`). */
export interface AuthFooterLink {
    text: string;
    url: string;
}

/** The configured footer links, minus anything that is not a plain http(s) link with a label. */
export function authFooterLinks(): AuthFooterLink[] {
    const configured = SdkConfig.get().branding?.auth_footer_links;
    if (!Array.isArray(configured)) return [];
    return configured.filter(
        (link): link is AuthFooterLink =>
            !!link &&
            typeof link.text === "string" &&
            link.text.trim() !== "" &&
            typeof link.url === "string" &&
            /^https?:\/\//i.test(link.url.trim()),
    );
}

/**
 * The text of "Version <x>", or null when there is no real version to show. A dev build has the webpack placeholder
 * "!!UNSET!!" (and some platforms answer "unknown"/blank): showing those looks broken, so the line is hidden.
 */
export function displayVersion(version: string | null | undefined): string | null {
    const trimmed = (version ?? "").trim();
    if (!trimmed || /!!|unset|unknown|undefined|null/i.test(trimmed)) return null;
    return trimmed;
}
