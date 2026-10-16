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

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import Modal from "../../Modal";
import QuestionDialog from "../../components/views/dialogs/QuestionDialog";
import { type Member } from "../../utils/direct-messages";
import { isClarivaEnabled } from "../config";
import { qrStrings } from "../strings/qr";

/** Whether the "Send invite?" confirmation applies to these (not yet existing) DM targets. */
export function needsStartDmConfirmation(myUserId: string | null, targets: readonly Member[]): boolean {
    if (!isClarivaEnabled()) return false;
    if (targets.length !== 1) return false;
    const [target] = targets;
    if (!target.userId.startsWith("@")) return false; // third-party (email) invite: not a Matrix user id
    return target.userId !== myUserId; // a chat with yourself is a personal notes room, nobody is invited
}

/**
 * Android shows a bottom sheet "Send invite? / Would you like to start a chat with <name>? [Send invite | Cancel]"
 * before it creates a DM that does not exist yet (spec 04 §2.8, §3.16: `Confirming` state). Element Web only creates
 * the room with the first message (local room), so this confirmation is the equivalent of Android's explicit step.
 *
 * Call it ONLY when no DM with the target exists. Resolves true when the chat may be started.
 */
export async function confirmStartDm(client: MatrixClient, targets: readonly Member[]): Promise<boolean> {
    if (!needsStartDmConfirmation(client.getUserId(), targets)) return true;
    const name = targets[0].name || targets[0].userId;
    const { finished } = Modal.createDialog(QuestionDialog, {
        title: qrStrings.sendInviteTitle,
        description: qrStrings.sendInviteBody(name),
        button: qrStrings.sendInvite,
        cancelButton: qrStrings.cancel,
    });
    const [ok] = await finished;
    return !!ok;
}
