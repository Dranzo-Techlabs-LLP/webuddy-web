/*
Copyright 2026 The Clariva Authors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

// CLARIVA: the stock Element mobile guide looked up the homeserver in config.json and built an
// https://mobile.element.io?hs_url=... "configure your app" deep link. Clariva has one fixed homeserver and its own
// Android app (Google Play, com.dranzo.clariva), so the guide is now just "install the app" + "continue in the browser".

function onContinueInBrowserClick(): void {
    // Cookie should expire in 4 hours (same cookie name as stock, checked in src/vector/index.ts)
    document.cookie = "element_mobile_redirect_to_guide=false;path=/;max-age=14400";
    window.location.href = "../";
}

const continueButton = document.getElementById("continue_in_browser_button");
if (continueButton) continueButton.onclick = onContinueInBrowserClick;

export {}; // make this file a module (isolatedModules)
