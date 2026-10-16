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

import React, { useState } from "react";
import classNames from "classnames";
import { Button } from "@vector-im/compound-web";
import LockIcon from "@vector-im/compound-design-tokens/assets/web/icons/lock";

import BaseDialog from "../../../components/views/dialogs/BaseDialog";
import Spinner from "../../../components/views/elements/Spinner";
import { AuthField } from "../auth/fields";
import { useRecharge } from "../../hooks/useRecharge";
import { formatCredits } from "../../money";
import { walletStrings as S } from "../../strings/wallet";
import { RechargeSuccess } from "./RechargeSuccess";
import { type RechargeFlow } from "../../wallet/rechargeFlow";
import {
    QUICK_AMOUNTS,
    formatInr,
    isBusy,
    sanitizeAmountInput,
    validateRechargeAmount,
    type RechargeState,
} from "../../wallet/rechargeMachine";

interface Props {
    onFinished: () => void;
    /** Test seam: build the flow with fakes. */
    createFlow?: () => RechargeFlow;
}

function noop(): void {}

/** Which body the dialog shows for a state of the machine. */
export type RechargeView = "form" | "verifying" | "verifyFailed" | "success";

export function viewFor(state: RechargeState): RechargeView {
    switch (state.phase) {
        case "verifying":
            return "verifying";
        case "verifyFailed":
            return "verifyFailed";
        case "success":
            return "success";
        default:
            return "form";
    }
}

/**
 * "Recharge Wallet" (spec 02 §2.3): pick whole credits 1..100000 (quick-pick chips as on clarivahub.com), pay with
 * Razorpay Standard Checkout, see the result. The money logic lives in `RechargeFlow`; this is the view of its state.
 */
export default function RechargeDialog({ onFinished, createFlow }: Props): JSX.Element {
    const { flow, state } = useRecharge(createFlow);
    const [text, setText] = useState("");
    const validation = validateRechargeAmount(text);
    const busy = isBusy(state);
    const view = viewFor(state);

    const submit = (): void => {
        if (validation.ok && !busy) void flow.submit(validation.amount);
    };

    let content: JSX.Element;
    if (view === "success") {
        content = (
            <div className="mx_ClarivaRecharge_result" data-testid="clariva-recharge-success">
                <RechargeSuccess added={state.amount} newBalance={state.newBalance} />
                <div className="mx_ClarivaDialog_buttons">
                    <Button
                        kind="secondary"
                        className="mx_Dialog_nonDialogButton"
                        onClick={() => {
                            setText("");
                            flow.reset();
                        }}
                    >
                        {S.rechargeAgain}
                    </Button>
                    <Button kind="primary" className="mx_Dialog_nonDialogButton" onClick={onFinished}>
                        {S.done}
                    </Button>
                </div>
            </div>
        );
    } else if (view === "verifying") {
        content = (
            <div className="mx_ClarivaRecharge_result" role="status" data-testid="clariva-recharge-verifying">
                <Spinner w={32} h={32} onFinished={noop} />
                <p>{S.confirmingPayment}</p>
            </div>
        );
    } else if (view === "verifyFailed") {
        content = (
            <div className="mx_ClarivaRecharge_result" data-testid="clariva-recharge-verify-failed">
                <p className="mx_ClarivaRecharge_error" role="alert">
                    {state.error}
                </p>
                {state.reconciling && (
                    <div className="mx_ClarivaRecharge_info" role="status">
                        <Spinner w={16} h={16} message={S.checkingWallet} onFinished={noop} />
                    </div>
                )}
                <div className="mx_ClarivaDialog_buttons">
                    <Button kind="secondary" className="mx_Dialog_nonDialogButton" onClick={onFinished}>
                        {S.close}
                    </Button>
                    <Button kind="primary" className="mx_Dialog_nonDialogButton" onClick={() => void flow.runVerify()}>
                        {S.retryConfirmation}
                    </Button>
                </div>
            </div>
        );
    } else {
        // inline range error right under the field (and announced), shown once the user typed something
        const rangeError = text !== "" && !validation.ok ? validation.message : "";
        content = (
            <form
                className="mx_ClarivaRecharge_form"
                noValidate
                onSubmit={(ev: React.FormEvent) => {
                    ev.preventDefault();
                    submit();
                }}
            >
                <p id="mx_ClarivaRecharge_desc" className="mx_ClarivaRecharge_lead">
                    {S.rechargeDialogBody}
                </p>
                <AuthField
                    id="mx_ClarivaRecharge_amount"
                    label={S.amountLabel}
                    value={text}
                    onChange={(v) => setText(sanitizeAmountInput(v))}
                    placeholder={S.amountPlaceholder}
                    prefix="₹"
                    inputMode="numeric"
                    autoComplete="off"
                    autoFocus
                    disabled={busy}
                    support={rangeError ? { kind: "error", text: rangeError } : null}
                    alert
                />
                <div className="mx_ClarivaRecharge_chips" role="group" aria-label={S.quickAmountsLabel}>
                    {QUICK_AMOUNTS.map((amount) => (
                        <button
                            type="button"
                            key={amount}
                            className={classNames("mx_ClarivaRecharge_chip", "mx_Dialog_nonDialogButton", {
                                mx_ClarivaRecharge_chip_selected: text === String(amount),
                            })}
                            aria-pressed={text === String(amount)}
                            disabled={busy}
                            onClick={() => setText(String(amount))}
                        >
                            {formatInr(amount)}
                        </button>
                    ))}
                </div>
                {validation.ok && (
                    <p className="mx_ClarivaRecharge_summary">
                        {S.rechargeSummary(formatCredits(validation.amount, true), formatInr(validation.amount))}
                    </p>
                )}
                {state.phase === "cancelled" && (
                    <p className="mx_ClarivaRecharge_info" role="status" data-testid="clariva-recharge-cancelled">
                        {S.paymentCancelled}
                    </p>
                )}
                {state.phase === "failed" && state.error && (
                    <p className="mx_ClarivaRecharge_error" role="alert" data-testid="clariva-recharge-failed">
                        {state.error}
                    </p>
                )}
                {state.phase === "checkoutOpen" && (
                    <>
                        <p className="mx_ClarivaRecharge_info" role="status">
                            {S.completePaymentPrompt}
                        </p>
                        {state.error && (
                            <p className="mx_ClarivaRecharge_error" role="alert">
                                {state.error}
                            </p>
                        )}
                    </>
                )}
                <div className="mx_ClarivaDialog_buttons">
                    <Button kind="secondary" type="button" className="mx_Dialog_nonDialogButton" onClick={onFinished}>
                        {S.cancel}
                    </Button>
                    {busy ? (
                        <span className="mx_ClarivaRecharge_progress" role="status">
                            <Spinner w={24} h={24} onFinished={noop} />
                            <span>{S.processingRecharge}</span>
                        </span>
                    ) : (
                        <>
                            {state.phase === "failed" && state.canRetryCheckout && (
                                <Button
                                    kind="secondary"
                                    type="button"
                                    className="mx_Dialog_nonDialogButton"
                                    onClick={() => void flow.retryCheckout()}
                                >
                                    {S.retry}
                                </Button>
                            )}
                            <Button
                                kind="primary"
                                type="submit"
                                className="mx_Dialog_nonDialogButton"
                                disabled={!validation.ok}
                            >
                                {S.recharge}
                            </Button>
                        </>
                    )}
                </div>
                <p className="mx_ClarivaRecharge_secure">
                    <LockIcon aria-hidden="true" />
                    {S.securedByRazorpay}
                </p>
            </form>
        );
    }

    return (
        <BaseDialog
            className="mx_ClarivaRechargeDialog"
            title={S.rechargeDialogTitle}
            onFinished={onFinished}
            hasCancel={true}
            fixedWidth={false}
            contentId="mx_ClarivaRecharge_desc"
        >
            {content}
        </BaseDialog>
    );
}
