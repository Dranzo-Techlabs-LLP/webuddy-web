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
import { Icon as InfoIcon } from "@vector-im/compound-design-tokens/icons/info-solid.svg";
import { type Room } from "matrix-js-sdk/src/matrix";

import Modal from "../../../Modal";
import QuestionDialog from "../../../components/views/dialogs/QuestionDialog";
import { useRefundState } from "../../hooks/useRefundState";
import { chatStrings } from "../../strings/chat";
import { ApproveRefundDialog } from "./ApproveRefundDialog";
import { RefundToasts } from "./RefundToasts";

interface Props {
    room: Room;
}

/**
 * Rendered by `RoomView` directly under the room header of the MAIN timeline (the thread view is a different
 * component, so it never shows it). Two jobs, both for the refund workflow of this 1:1 chat:
 *
 *  - consultant: the "Refund request" banner with Approve / Reject (spec 03 U4-U6);
 *  - everyone: the chat-local toast host (U7), which also reports the outcome of the CLIENT's header button.
 *
 * Render with `key={room.roomId}` so toasts and dialogs never carry over to another room.
 */
export function ClarivaRefundBanner({ room }: Props): ReactElement | null {
    const { controller, showRefundBanner, isRequestInProgress, reject } = useRefundState(room);
    if (!controller) return null; // dormant: not a Clariva 1:1 chat

    const onApprove = (): void => {
        Modal.createDialog(ApproveRefundDialog, { room });
    };

    const onReject = (): void => {
        Modal.createDialog(QuestionDialog, {
            title: chatStrings.refundRejectTitle,
            description: chatStrings.refundRejectBody,
            button: chatStrings.refundReject,
            cancelButton: chatStrings.refundCancel,
            onFinished: (confirmed?: boolean) => {
                if (confirmed) void reject();
            },
        });
    };

    return (
        <>
            {showRefundBanner && (
                <div className="mx_ClarivaRefundBanner" role="region" aria-label={chatStrings.refundBannerTitle}>
                    <InfoIcon className="mx_ClarivaRefundBanner_icon" width="20px" height="20px" aria-hidden="true" />
                    <div className="mx_ClarivaRefundBanner_content">
                        <div className="mx_ClarivaRefundBanner_title">{chatStrings.refundBannerTitle}</div>
                        <div className="mx_ClarivaRefundBanner_body">{chatStrings.refundBannerBody}</div>
                        <div className="mx_ClarivaRefundBanner_actions">
                            <Button kind="primary" size="sm" disabled={isRequestInProgress} onClick={onApprove}>
                                {chatStrings.refundApprove}
                            </Button>
                            <Button kind="secondary" size="sm" disabled={isRequestInProgress} onClick={onReject}>
                                {chatStrings.refundReject}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
            <RefundToasts controller={controller} />
        </>
    );
}
