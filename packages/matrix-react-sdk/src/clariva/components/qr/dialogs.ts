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

import Modal from "../../../Modal";
import dis from "../../../dispatcher/dispatcher";
import { MyQrCodeDialog } from "./MyQrCodeDialog";
import { ScanQrCodeDialog } from "./ScanQrCodeDialog";

/** Settings -> "My QR code" (also reachable from Start chat). */
export function openMyQrCodeDialog(): void {
    Modal.createDialog(MyQrCodeDialog, {});
}

/**
 * Show a user's profile in the main view: the same screen Element opens for `#/user/<mxid>` (user view with Message
 * and Share). Android replaces the scanner with the profile; here the scanner has already closed.
 */
export function showUserProfile(userId: string): void {
    dis.dispatch({ action: "view_user_info", userId }); // handled by MatrixChat.viewUser
}

/**
 * Start chat -> "Scan QR code". Opens the camera scanner; a valid Clariva user QR code opens that user's profile.
 * Resolves the scanned user id, or undefined when the dialog was cancelled.
 */
export async function openScanQrCodeDialog(): Promise<string | undefined> {
    const { finished } = Modal.createDialog(ScanQrCodeDialog, {});
    const [userId] = await finished;
    if (typeof userId !== "string" || !userId) return undefined;
    showUserProfile(userId);
    return userId;
}
