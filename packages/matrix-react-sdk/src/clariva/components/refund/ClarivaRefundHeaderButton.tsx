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

import React, { type ReactElement } from "react";
import { Button } from "@vector-im/compound-web";
import { Icon as RestartIcon } from "@vector-im/compound-design-tokens/icons/restart.svg";
import { type Room } from "matrix-js-sdk/src/matrix";

import Modal from "../../../Modal";
import QuestionDialog from "../../../components/views/dialogs/QuestionDialog";
import { useRefundState } from "../../hooks/useRefundState";
import { chatStrings } from "../../strings/chat";

interface Props {
    room: Room;
}

/**
 * Client: "Request refund" in the room header (spec 03 U3). Visible iff a live hold with an open refund window exists,
 * I am not the consultant of this room and no refund was requested yet. Disabled while a request/approve/reject call
 * is in flight. Renders nothing for every other room (non-DMs, Clariva not configured, ...).
 */
export function ClarivaRefundHeaderButton({ room }: Props): ReactElement | null {
    const { canRequestRefund, isRequestInProgress, requestRefund } = useRefundState(room);
    if (!canRequestRefund) return null;

    const onClick = (): void => {
        Modal.createDialog(QuestionDialog, {
            title: chatStrings.refundConfirmTitle,
            description: chatStrings.refundConfirmBody,
            button: chatStrings.refundConfirmSubmit,
            cancelButton: chatStrings.refundCancel,
            onFinished: (confirmed?: boolean) => {
                // Success/failure is announced by the chat-local toast host; nothing to do with the result here.
                if (confirmed) void requestRefund();
            },
        });
    };

    return (
        <Button
            className="mx_ClarivaRefundHeaderButton"
            kind="secondary"
            size="sm"
            Icon={RestartIcon}
            disabled={isRequestInProgress}
            onClick={onClick}
        >
            {chatStrings.refundRequestButton}
        </Button>
    );
}
