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

import React, { useRef, useState } from "react";
import { Button } from "@vector-im/compound-web";
import CheckCircleIcon from "@vector-im/compound-design-tokens/assets/web/icons/check-circle-solid";
import ErrorIcon from "@vector-im/compound-design-tokens/assets/web/icons/error";
import { logger } from "matrix-js-sdk/src/logger";

import { ClarivaHttpError } from "../../api/http";
import { ClarivaWalletApi } from "../../api/wallet";
import { type BankDetailsBody } from "../../api/types";
import { WalletStore } from "../../stores/WalletStore";
import { AuthField } from "../auth/fields";
import { walletStrings as S } from "../../strings/wallet";
import {
    BANK_FIELDS,
    EMPTY_BANK_FORM,
    canSaveBankForm,
    sameBankForm,
    toBankDetailsBody,
    validateBankForm,
    type BankField,
    type BankForm,
} from "../../wallet/bankDetails";

interface Props {
    /** The expert id sent to the server (default: the signed-in Matrix user id). */
    expertId?: string;
    /** Test seam (default: `POST /v1/experts/bank-details`). */
    save?: (body: BankDetailsBody) => Promise<unknown>;
}

/** The server's own words when it refused (e.g. 404 "Expert with ID ... not found"), never a bare "Error". */
export function describeBankError(e: unknown): string {
    if (e instanceof ClarivaHttpError) return e.isNetwork ? e.message : (e.serverMessage ?? e.message);
    return e instanceof Error ? e.message : String(e);
}

/**
 * Consultant "Bank Details" (spec 02 §2.7): five fields, `Save Details` enabled once all are filled in and well formed.
 * The server inserts a NEW row on every save and may answer 404 when no `experts` row exists for the Matrix id
 * (spec 02 §7.1.3): the message is shown as is, a failure is never reported as success, and after a success the
 * button stays disabled until something changes, so a double save cannot create duplicate rows.
 */
export default function BankDetailsForm(props: Props): JSX.Element {
    const [form, setForm] = useState<BankForm>(EMPTY_BANK_FORM);
    const [touched, setTouched] = useState<Partial<Record<BankField, boolean>>>({});
    const [saving, setSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState<BankForm | null>(null);
    const [error, setError] = useState<string | null>(null);
    const inFlight = useRef(false);

    const errors = validateBankForm(form);
    const unchangedSinceSave = lastSaved !== null && sameBankForm(form, lastSaved);
    const canSave = canSaveBankForm(form, saving) && !unchangedSinceSave;

    const setField = (field: BankField, value: string): void => {
        setForm((f) => ({ ...f, [field]: value }));
        setError(null);
    };

    const onSubmit = async (): Promise<void> => {
        if (!canSave || inFlight.current) return;
        const expertId = props.expertId ?? WalletStore.instance.userId;
        if (!expertId) return;
        inFlight.current = true;
        setSaving(true);
        setError(null);
        try {
            const body = toBankDetailsBody(expertId, form);
            await (props.save ? props.save(body) : ClarivaWalletApi.addBankDetails(body));
            setLastSaved(form);
        } catch (e) {
            logger.warn("Clariva wallet: could not save bank details", e);
            setError(describeBankError(e));
        } finally {
            inFlight.current = false;
            setSaving(false);
        }
    };

    return (
        <form
            className="mx_ClarivaBank"
            data-testid="clariva-bank-details"
            noValidate
            onSubmit={(ev: React.FormEvent) => {
                ev.preventDefault();
                void onSubmit();
            }}
        >
            {BANK_FIELDS.map(({ field, label, autoComplete }) => {
                // inline validation on blur: an error only after the field was visited
                const message = touched[field] ? errors[field] : undefined;
                return (
                    <AuthField
                        key={field}
                        id={`mx_ClarivaBank_${field}`}
                        label={label}
                        value={form[field]}
                        onChange={(value) => setField(field, value)}
                        onBlur={() => setTouched((t) => ({ ...t, [field]: true }))}
                        autoComplete={autoComplete}
                        inputMode={field === "accountNumber" ? "numeric" : undefined}
                        identifier={field === "ifscCode" || field === "accountNumber"}
                        disabled={saving}
                        support={message ? { kind: "error", text: message } : null}
                        help={fieldHelp(field)}
                        alert
                    />
                );
            })}
            {error !== null && (
                <p className="mx_ClarivaBank_error" role="alert" data-testid="clariva-bank-error">
                    <ErrorIcon aria-hidden="true" />
                    {S.error}: {error}
                </p>
            )}
            {unchangedSinceSave && error === null && (
                <p className="mx_ClarivaBank_success" role="status" data-testid="clariva-bank-saved">
                    <CheckCircleIcon aria-hidden="true" />
                    {S.savedChanges}
                </p>
            )}
            <div className="mx_ClarivaBank_buttons">
                <Button kind="primary" type="submit" className="mx_Dialog_nonDialogButton" disabled={!canSave}>
                    {saving ? S.saving : S.saveDetails}
                </Button>
            </div>
        </form>
    );
}

/** Helper text under a field (replaced by the error while there is one). */
function fieldHelp(field: BankField): string | undefined {
    if (field === "ifscCode") return S.ifscHelp;
    if (field === "accountNumber") return S.accountNumberHelp;
    return undefined;
}
