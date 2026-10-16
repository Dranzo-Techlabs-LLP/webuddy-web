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
 * User-visible English strings for the Clariva "auth" area, copied verbatim from the Android app (see
 * docs/clariva/spec/01-auth-session.md, Appendix A). Owned by the auth workstream; keep literals here (not in
 * en_EN.json) so Android parity is reviewable in one place. Typographic characters (… — ’) are intentional.
 *
 * Entries marked [N] are web-only additions from spec 01 (they do not exist on Android).
 */
export const authStrings = {
    // ── landing page (ClarivaAuthView) ────────────────────────────────────────────────────────────
    welcomeTitle: "Welcome to Clariva",
    taglineLine1: "Private conversations. Real value.",
    taglineLine2: "Encrypted chats with trusted consultants.",
    version: (version: string): string => `Version ${version}`,
    /** [WEB] accessible name of the Privacy / Terms links under the form. */
    legalNavLabel: "Legal",

    signIn: "Sign in",
    createAccount: "Create account",
    signInWithGoogle: "Sign in with Google",
    signUpWithGoogle: "Sign up with Google",
    or: "or",
    haveAccount: "Already have an account? Sign in",
    noAccount: "New to Clariva? Create an account",
    forgotPassword: "Forgot password?",

    nameLabel: "Name",
    namePlaceholder: "Your full name",
    nameError: "Please enter your name",
    usernameLabel: "Username",
    usernamePlaceholder: "e.g. jane.doe",
    usernameHelp: "Your unique handle. This cannot be changed later.",
    usernamePreview: (handle: string, serverName: string): string => `You will be @${handle}:${serverName}`,
    usernameChecking: "Checking availability…",
    usernameAvailable: (handle: string, serverName: string): string =>
        `Available — you will be @${handle}:${serverName}`,
    usernameTooShort: "At least 3 characters",
    usernameTooLong: "At most 30 characters",
    usernameInvalid: "Use letters, numbers, dots, underscores or hyphens; start with a letter or number",
    usernameTaken: "That username is already taken",
    emailLabel: "Email",
    emailPlaceholder: "you@example.com",
    identifierLabel: "Email or username",
    identifierPlaceholder: "you@example.com or jane.doe",
    emailChecking: "Checking availability…",
    emailAvailable: "Email is available",
    emailTaken: "That email is already registered. Sign in instead.",
    passwordLabel: "Password",
    passwordHint: (min: number): string => `At least ${min} characters`,
    showPassword: "Show password",
    hidePassword: "Hide password",
    consultantTitle: "I am a consultant",
    consultantSubtitle: "Consultants are paid for chats.",

    // ── "Sign-in failed" dialog ───────────────────────────────────────────────────────────────────
    errorTitle: "Sign-in failed",
    errorGeneric: "Something went wrong. Please try again.",
    ok: "OK",
    cancel: "Cancel",
    /** [N] appended to "Incorrect email or password." when the account might be a Google-only account. */
    googleAccountHint: "Signed up with Google? Use Sign in with Google.",
    /** [N] the same hint when Google's button is not on this page (unconfigured or failed): nothing to point at. */
    googleAccountHintUnavailable:
        "Signed up with Google? Google sign-in isn't available on this page. Use the Clariva app instead.",
    /** [N] shown when sign-up created the account but the session could not be opened. */
    accountCreatedSignIn: "Your account was created. Please sign in to continue.",

    // ── Google ────────────────────────────────────────────────────────────────────────────────────
    googleRoleTitle: "Are you a consultant?",
    // [N] Android appends "This can be changed later in Settings"; no such setting exists there or on the web.
    googleRoleSubtitle: "Consultants are paid for the chats they take.",
    googleRoleSubtitleWithEmail: (email: string): string =>
        `Setting up ${email}. Consultants are paid for the chats they take.`,
    /** [N] Sign in with Google used an address with no Clariva account: continuing creates one. */
    googleNoAccountNotice: (email?: string): string =>
        `No Clariva account exists for ${email || "this Google account"}. Continue to create one, or Cancel and pick another Google account.`,
    googleRoleNo: "No",
    googleRoleNoHint: "Chat with consultants and pay per conversation.",
    googleRoleYes: "Yes",
    googleRoleYesHint: "Get paid for the chats you take.",
    googleRoleConfirm: "Continue",

    // ── Google unavailable ([N]: the script was blocked / never arrived / drew nothing) ───────────
    googleUnavailableTitle: "Google sign-in isn't available",
    googleUnavailableBlocked:
        "We couldn't reach Google. Check your connection, or turn off any ad or privacy blocker for this site.",
    googleUnavailableTimeout:
        "Google took too long to respond. Check your connection, or turn off any ad or privacy blocker for this site.",
    googleUnavailableRender: "Google's sign-in button didn't load.",
    // Signed up on Android WITH Google? Then there is no password to use here, so do not promise one to everybody.
    googleUnavailableFallbackSignIn:
        "You can still sign in with your email or username and password. Signed up with Google? Try again in a moment, or use the Clariva app.",
    googleUnavailableFallbackSignUp: "You can still create an account with your email and password.",
    googleRetry: "Try again",
    /** [N] shown (muted) inside the empty button slot while Google's script and button are still loading. */
    googleLoading: "Connecting to Google…",
    /** [N] shown (collapsed) on a developer's machine only: the usual cause is a missing authorised origin. */
    googleDevHintSummary: "Trouble with Google sign-in on this address?",
    googleDevHintBody:
        "Google only shows its sign-in to addresses authorised for the app's Google client. In Google Cloud Console > APIs & Services > Credentials > the Web application client, add these under Authorized JavaScript origins, wait a few minutes and reload:",

    // ── forgot password ───────────────────────────────────────────────────────────────────────────
    forgotTitle: "Reset password",
    forgotEmailSubtitle: "Enter your account email and we'll send you a 6-digit reset code.",
    forgotSendCode: "Send code",
    forgotCodeSubtitle: (email: string): string =>
        `If an account exists for ${email}, a 6-digit code is on its way. Enter it below with your new password.`,
    forgotCodeLabel: "6-digit code",
    forgotNewPasswordLabel: "New password",
    forgotSubmit: "Reset password",
    forgotResend: "Resend code",
    /** [N] Google accounts have no password: the server sends no code for them. */
    forgotGoogleHint:
        "Signed up with Google? Google accounts have no password, so no code is sent. Cancel and use Sign in with Google.",
    /** [N] the same hint when Google's button is not available on the landing page: nothing to point at. */
    forgotGoogleHintUnavailable:
        "Signed up with Google? Google accounts have no password, so no code is sent. Google sign-in isn't available on this page, so cancel and use the Clariva app instead.",
    forgotCancel: "Cancel",
    forgotSuccess: "Password reset. Sign in with your new password.",

    // ── signed out ────────────────────────────────────────────────────────────────────────────────
    signedOutTitle: "You’re signed out",
    signedOutSubtitle:
        "You might have been signed out for one of the reasons listed below. Please sign in again to continue using Clariva.",
    // Android lists "You’ve changed your password on another session" first; that reason cannot happen for Clariva
    // (users never change a Matrix password), so it is dropped (spec 01 §2.5).
    signedOutReasonDeleted: "You have deleted the session from another session",
    signedOutReasonAdmin: "Your server’s administrator has invalidated your access",
    signInAgain: "Sign in again",

    // ── sign out ──────────────────────────────────────────────────────────────────────────────────
    signOutTitle: "Sign out?",
    signOutSubtitle: "Your chats are safely backed up. Sign in again on any device and they'll be waiting for you.",
    signOut: "Sign out",
    signOutAnyway: "Sign out anyway",
    signOutKeysUploadingTitle: "Your keys are still being backed up",
    signOutKeysUploadingSubtitle: "Please wait for this to complete before signing out.",

    // ── deactivate account ────────────────────────────────────────────────────────────────────────
    deactivateTitle: "Deactivate account",
    // "Deactivating your account is **irreversible**, it will:" (the middle part is bold)
    deactivateDescriptionBefore: "Deactivating your account is ",
    deactivateIrreversible: "irreversible",
    deactivateDescriptionAfter: ", it will:",
    // "**Permanently disable** your account (you can't log back in, and your ID can't be reused)."
    deactivateItem1Bold: "Permanently disable",
    deactivateItem1Rest: " your account (you can't log back in, and your ID can't be reused).",
    deactivateItem2: "Remove you from all chat rooms.",
    deactivateItem3: "Delete your account information from our identity server.",
    deactivateItem4:
        "Your messages will still be visible to registered users but won’t be available to new or unregistered users if you choose to delete them.",
    deactivateDeleteMessages: "Delete all my messages",
    deactivateDeleteMessagesNotice: "Warning: Future users may see incomplete conversations.",
    confirmPasswordLabel: "Confirm password",
    passwordPlaceholder: "Password",
    deactivateGoogleNotice:
        "You signed up with Google, so there is no password to confirm. Re-authorise with Google to prove this is your account.",
    deactivateGoogleAuthorized: "Authorised with Google. You can now deactivate.",
    /** [N] Google is not set up on this site at all (nothing to retry): the Deactivate button stays disabled. */
    deactivateGoogleUnavailable:
        "This account can only be deactivated by re-authorising with Google, which isn't set up on this site. Use the Clariva app.",
    /** [N] follows the reason Google's button failed (it is configured, so a retry may help). */
    deactivateGoogleUnavailableRetry: "You can try again, or deactivate your account from the Clariva app.",
    deactivate: "Deactivate",
    deactivateConfirmation: "Please confirm that you want to deactivate your account. This action cannot be undone.",
    pleaseWait: "Please wait…",
    /** [N] the server's message is shown instead of Android's generic "Sorry, an error occurred". */
    deactivateErrorFallback: "Sorry, an error occurred",
    /** [N] the re-auth method lookup failed (Android has no retry; the screen would be stuck). */
    deactivateCheckFailed: "We couldn’t check how to confirm your identity.",
    deactivateCheckRetry: "Try again",
    /** [N] spec 01 R-15: deactivation does not settle the wallet balance. */
    deactivateCreditsWarning: (credits: string): string =>
        `You still have ${credits} credits. They will be lost when your account is deactivated.`,
    /** [N] one-shot notice on the landing page after a successful deactivation. */
    deactivated: "Your account has been deactivated.",

    // ── history / key storage ([N], spec 01 §3.8 table row "SecretStorage error") ────────────────
    historyUnavailableTitle: "Some earlier messages may be unavailable",
    historyUnavailableDescription:
        "We couldn’t unlock your message history on this device. New messages are not affected.",
} as const;

/** Server name shown in "@name:server" previews when neither config nor the homeserver says otherwise. */
export const DEFAULT_MATRIX_SERVER_NAME = "clarivahub.com";
