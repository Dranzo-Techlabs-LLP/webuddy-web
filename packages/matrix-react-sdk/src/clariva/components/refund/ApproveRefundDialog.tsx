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

import React, { type ChangeEvent, type FormEvent, type ReactElement, useState } from "react";
import classNames from "classnames";
import { type Room } from "matrix-js-sdk/src/matrix";

import BaseDialog from "../../../components/views/dialogs/BaseDialog";
import DialogButtons from "../../../components/views/elements/DialogButtons";
import StyledRadioGroup from "../../../components/views/elements/StyledRadioGroup";
import { useRefundState } from "../../hooks/useRefundState";
import { chatStrings } from "../../strings/chat";
import {
    formatPlainAmount,
    isAllowedRefundAmountInput,
    refundAmountSupportText,
    validateRefundAmount,
} from "../../refund/amount";

type RefundKind = "full" | "partial";

interface Props {
    room: Room;
    onFinished(approved?: boolean): void;
}

/**
 * Consultant: "Approve Refund" (spec 03 U5). Full (default) or Partial with a typed amount.
 *
 * Confirm closes the dialog and fires the approval; the outcome (success or the server's own message) appears as a
 * chat-local toast. The held amount is read live from the status poll, so the dialog also works if it changes.
 */
export function ApproveRefundDialog({ room, onFinished }: Props): ReactElement {
    const { state, isRequestInProgress, approve } = useRefundState(room);
    const [kind, setKind] = useState<RefundKind>("full");
    const [text, setText] = useState("");

    const held = state.refundHeldAmount;
    const validation = validateRefundAmount(text, held);
    const partial = kind === "partial";
    // Full is always valid; Partial needs a valid amount. Disabled while another refund call is in flight.
    const canApprove = !isRequestInProgress && (!partial || validation.valid);
    const showError = partial && validation.showError;

    const onAmountChange = (e: ChangeEvent<HTMLInputElement>): void => {
        // Input filter: digits and at most one dot; anything else is ignored.
        if (isAllowedRefundAmountInput(e.target.value)) setText(e.target.value);
    };

    const onSubmit = (e?: FormEvent): void => {
        e?.preventDefault();
        if (!canApprove) return;
        // Full = no amount (omitted from the request); Partial = the rounded amount, even when it equals the held amount.
        void approve(partial ? (validation.amount as number) : undefined);
        onFinished(true);
    };

    const supportId = "mx_ClarivaApproveRefund_support";

    return (
        <BaseDialog
            className="mx_ClarivaApproveRefundDialog"
            title={chatStrings.refundApproveDialogTitle}
            contentId="mx_ClarivaApproveRefund_content"
            onFinished={onFinished}
            fixedWidth={false}
        >
            <form onSubmit={onSubmit}>
                <div className="mx_Dialog_content" id="mx_ClarivaApproveRefund_content">
                    <StyledRadioGroup<RefundKind>
                        name="mx_ClarivaApproveRefund_kind"
                        className="mx_ClarivaApproveRefund_option"
                        value={kind}
                        onChange={setKind}
                        definitions={[
                            {
                                value: "full",
                                label:
                                    held !== null
                                        ? chatStrings.refundFullOptionWithHeld(formatPlainAmount(held))
                                        : chatStrings.refundFullOption,
                            },
                            { value: "partial", label: chatStrings.refundPartialOption },
                        ]}
                    />

                    {partial ? (
                        <div className="mx_ClarivaApproveRefund_field">
                            <label className="mx_ClarivaApproveRefund_label" htmlFor="mx_ClarivaApproveRefund_amount">
                                {chatStrings.refundAmountLabel}
                            </label>
                            <input
                                id="mx_ClarivaApproveRefund_amount"
                                className={classNames("mx_ClarivaApproveRefund_input", {
                                    mx_ClarivaApproveRefund_input_error: showError,
                                })}
                                type="text"
                                inputMode="decimal"
                                autoComplete="off"
                                autoFocus
                                value={text}
                                onChange={onAmountChange}
                                aria-invalid={showError}
                                aria-describedby={supportId}
                            />
                            <div
                                id={supportId}
                                role={showError ? "alert" : undefined}
                                className={classNames("mx_ClarivaApproveRefund_support", {
                                    mx_ClarivaApproveRefund_support_error: showError,
                                })}
                            >
                                {refundAmountSupportText(showError, held)}
                            </div>
                        </div>
                    ) : (
                        <div className="mx_ClarivaApproveRefund_support">{chatStrings.refundFullHelper}</div>
                    )}
                </div>
                <DialogButtons
                    primaryButton={chatStrings.refundApprove}
                    primaryIsSubmit={true}
                    primaryDisabled={!canApprove}
                    cancelButton={chatStrings.refundCancel}
                    onCancel={() => onFinished(false)}
                />
            </form>
        </BaseDialog>
    );
}
