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

import React from "react";

import {
    currentOrigin,
    type GoogleUnavailableReason,
    isDevOrigin,
    originsToAuthorise,
} from "../../session/googleIdentity";
import { authStrings } from "../../strings/auth";

/** Where the notice is shown: it decides which "what you can do instead" sentence follows the reason. */
export type GoogleNoticeContext = "signIn" | "signUp" | "deactivate";

interface NoticeProps {
    /** Why Google's button is missing. Omitted when it is simply not configured (nothing to retry then). */
    reason?: GoogleUnavailableReason;
    /** Shows a "Try again" button. The page remounts the Google button, which loads the script afresh. */
    onRetry?: () => void;
    /** The landing page's sign-in or sign-up mode, or the deactivate dialog. Defaults to "signIn". */
    context?: GoogleNoticeContext;
    testId?: string;
}

function reasonText(reason: GoogleUnavailableReason | undefined): string {
    switch (reason) {
        case "script_blocked":
            return authStrings.googleUnavailableBlocked;
        case "script_timeout":
            return authStrings.googleUnavailableTimeout;
        default:
            return authStrings.googleUnavailableRender;
    }
}

function bodyText(context: GoogleNoticeContext, reason: GoogleUnavailableReason | undefined): string {
    // Re-authentication cannot be done any other way, so the deactivate dialog says what to do instead of "sign in".
    // A reason means Google IS configured and failed (a retry may help); none means it is not set up on this site.
    // Neither sentence repeats the title above it.
    if (context === "deactivate") {
        return reason
            ? `${reasonText(reason)} ${authStrings.deactivateGoogleUnavailableRetry}`
            : authStrings.deactivateGoogleUnavailable;
    }
    const fallback =
        context === "signUp"
            ? authStrings.googleUnavailableFallbackSignUp
            : authStrings.googleUnavailableFallbackSignIn;
    return `${reasonText(reason)} ${fallback}`;
}

/**
 * Shown in place of Google's button when it cannot be used. It never blocks anything else: the email / password form
 * is untouched, and the sentence says so. Purely presentational. Only the text (title + body) is a live region: the
 * "Try again" button sits outside it, as its sibling, so it is not announced as part of the message.
 */
export const ClarivaGoogleNotice: React.FC<NoticeProps> = ({ reason, onRetry, context = "signIn", testId }) => (
    <div className="mx_ClarivaAuth_googleNotice" data-testid={testId}>
        <div className="mx_ClarivaAuth_googleNoticeText" role="status">
            <p className="mx_ClarivaAuth_googleNoticeTitle">{authStrings.googleUnavailableTitle}</p>
            <p className="mx_ClarivaAuth_googleNoticeBody">{bodyText(context, reason)}</p>
        </div>
        {onRetry && (
            <button
                type="button"
                className="mx_ClarivaAuth_linkButton mx_Dialog_nonDialogButton"
                onClick={onRetry}
                data-testid={testId ? `${testId}-retry` : undefined}
            >
                {authStrings.googleRetry}
            </button>
        )}
    </div>
);

/**
 * Developer-only help, collapsed by default: Google serves its button only to origins listed under "Authorized
 * JavaScript origins" of the OAuth client, and that refusal cannot be detected from the page. The landing page renders
 * this on a development host only (localhost, 127.0.0.1, [::1], *.localhost, *.test); as a second guard this renders
 * nothing elsewhere, so a real deployment never prints its origin.
 */
export const ClarivaGoogleDevHint: React.FC<{ testId?: string }> = ({ testId = "clariva-auth-google-dev-hint" }) => {
    const origin = currentOrigin();
    if (!isDevOrigin(origin)) return null;
    return (
        <details className="mx_ClarivaAuth_googleDevHint" data-testid={testId}>
            <summary>{authStrings.googleDevHintSummary}</summary>
            <p>{authStrings.googleDevHintBody}</p>
            {originsToAuthorise(origin).map((o) => (
                <code key={o} className="mx_ClarivaAuth_googleDevOrigin">
                    {o}
                </code>
            ))}
        </details>
    );
};
