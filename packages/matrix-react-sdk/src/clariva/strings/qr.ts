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
 * User-visible English strings for the Clariva "qr" area (My QR code, Scan QR code, Start chat / user search,
 * profile share), copied verbatim from the Android app (docs/clariva/spec/04-calls-qr-search.md §2.8-§2.12).
 * Owned by the qr workstream; keep literals here (not in en_EN.json) so Android parity is reviewable in one place.
 *
 * Strings marked "web only" do not exist on Android (they cover browser-specific situations such as an insecure
 * origin or a missing camera); everything else is verbatim.
 */
export const qrStrings = {
    // ── My QR code (Android MyQrCodeView, spec §2.10) ───────────────────────────────────────────────────────────
    myQrCode: "My QR code",
    shareLink: "Share link",
    /** Chooser title on Android; here the title passed to `navigator.share`. */
    share: "Share",
    qrNotAvailable: "QR code is not available.",
    /** Web only: confirmation after the link was copied (clipboard fallback of "Share link"). */
    linkCopied: "Link copied",
    /** Web only: neither Web Share nor the clipboard worked. */
    linkCopyFailed: "Could not copy the link.",

    // ── Scan QR code (Android ScanUserQrCodeView, spec §2.9) ────────────────────────────────────────────────────
    scanQrCode: "Scan QR code",
    cameraAccessRequired: "Camera access is required to scan a QR code.",
    grantCameraAccess: "Grant camera access",
    tryAgain: "Try again",
    notAValidUserQr: "Not a valid user QR code.",
    /** Web only: no camera device / insecure origin / no decoder / camera busy. */
    cameraUnavailableInsecure: "Scanning needs a secure (HTTPS) connection and a browser that can use the camera.",
    cameraNotFound: "No camera was found on this device.",
    cameraFailed: "The camera could not be started.",
    /** Web only: file-picker fallback (spec §6.12 "upload image"). */
    scanFromImage: "Scan from an image",
    /** Web only: a11y name of the live preview. */
    cameraPreview: "Camera preview",
    /** Web only: live status line under the viewfinder while the camera is looking for a code. */
    scanHint: "Point your camera at a Clariva QR code.",

    // ── Start chat (Android StartChatView, spec §2.8) ───────────────────────────────────────────────────────────
    startChat: "Start chat",
    searchForSomeone: "Search for someone",
    noResults: "No results",
    startingChat: "Starting chat…",
    startChatError: "An error occurred when trying to start a chat",
    retry: "Retry",
    cancel: "Cancel",
    /** Unresolved explicit Matrix id row (profile lookup failed). */
    unresolvedUser: "This Matrix ID can't be found, so the invite might not be received.",

    // ── "Send invite?" confirmation (Android CreateDmConfirmationBottomSheet) ───────────────────────────────────
    sendInviteTitle: "Send invite?",
    sendInviteBody: (name: string): string => `Would you like to start a chat with ${name}?`,
    sendInvite: "Send invite",

    // ── Profile actions (spec §2.11) ────────────────────────────────────────────────────────────────────────────
    profileMessage: "Message",
    profileCall: "Call",
    profileShare: "Share",

    // ── Invite text ("Hey, talk to me on %1$s: %2$s") ───────────────────────────────────────────────────────────
    inviteText: (appName: string, link: string): string => `Hey, talk to me on ${appName}: ${link}`,
} as const;
