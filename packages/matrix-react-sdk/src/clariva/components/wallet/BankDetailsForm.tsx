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

import React, { useEffect, useRef, useState } from "react";
import { Button } from "@vector-im/compound-web";
import CheckCircleIcon from "@vector-im/compound-design-tokens/assets/web/icons/check-circle-solid";
import ErrorIcon from "@vector-im/compound-design-tokens/assets/web/icons/error";
import LockIcon from "@vector-im/compound-design-tokens/assets/web/icons/lock-solid";
import { logger } from "matrix-js-sdk/src/logger";

import { MatrixClientPeg } from "../../../MatrixClientPeg";
import InlineSpinner from "../../../components/views/elements/InlineSpinner";
import { ClarivaWalletApi } from "../../api/wallet";
import { type MyBankDetailsBody, type SavedBankAccount } from "../../api/types";
import { AuthField } from "../auth/fields";
import { ifscSupport } from "../auth/ConsultantSetupFields";
import { walletStrings as S } from "../../strings/wallet";
import {
    accountNumberError,
    applyIfscAutofill,
    BankAccountRules,
    bankSaveErrorText,
    type BankField,
    type BankForm,
    canSaveBankDetails,
    EMPTY_BANK_FORM,
    type IfscAutofill,
    sanitizeBankInput,
    savedAccountDetails,
    savedAccountTitle,
    toMyBankDetailsBody,
} from "../../wallet/bankDetails";
import { ifscBlocksSave, type IfscLookup, ifscLookup, useIfscLookup } from "../../wallet/ifsc";

/**
 * The session's Matrix access token: the API verifies it with the homeserver, so a caller can only ever reach their
 * own payout account. Unlike the Clariva JWT (dropped once the session is open), the app always holds it.
 */
function sessionBearer(): string {
    const token = MatrixClientPeg.safeGet().getAccessToken();
    if (!token) throw new Error("No Matrix access token for this session");
    return token;
}

const defaultLoad = async (): Promise<SavedBankAccount | null> =>
    (await ClarivaWalletApi.getMyBankDetails(sessionBearer())).bankDetail ?? null;
const defaultSave = (body: MyBankDetailsBody): Promise<SavedBankAccount> =>
    ClarivaWalletApi.saveMyBankDetails(sessionBearer(), body);

interface Props {
    /** Test seam (default: `GET /v1/experts/me/bank-details` with the session's access token). */
    load?: () => Promise<SavedBankAccount | null>;
    /** Test seam (default: `POST /v1/experts/me/bank-details` with the session's access token). */
    save?: (body: MyBankDetailsBody) => Promise<SavedBankAccount>;
    /** Test seam (default: the app-wide IFSC directory lookup). */
    lookup?: IfscLookup;
}

type SavedState = { kind: "loading" } | { kind: "loaded"; account: SavedBankAccount | null } | { kind: "failed" };

const FIELDS: readonly {
    field: BankField;
    label: string;
    placeholder?: string;
    numeric?: boolean;
    identifier?: boolean;
}[] = [
    { field: "accountHolderName", label: S.accountHolderName },
    { field: "bankName", label: S.bankName, placeholder: S.bankNamePlaceholder },
    { field: "accountNumber", label: S.accountNumber, numeric: true, identifier: true },
    { field: "ifscCode", label: S.ifscCode, placeholder: S.ifscPlaceholder, identifier: true },
    { field: "branchName", label: S.branchNameOptional },
];

/**
 * Consultant "Bank Details" (Android `BankDetailsView` / `BankDetailsPresenter`, 2026-10-29): the current payout
 * account (last 4 digits only) and a form that replaces it, with the same rules as consultant sign-up (branch
 * optional) and the live IFSC lookup. Both calls are authorised by the session's Matrix access token. A rejected save
 * shows the API's own reason; a success updates the card and clears the form (Android leaves the screen).
 */
export default function BankDetailsForm(props: Props): JSX.Element {
    const [saved, setSaved] = useState<SavedState>({ kind: "loading" });
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [form, setForm] = useState<BankForm>(EMPTY_BANK_FORM);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [justSaved, setJustSaved] = useState(false);
    // What the last lookup filled in, so a new IFSC can replace it but never a value the user typed.
    const autofilled = useRef<IfscAutofill | null>(null);
    const inFlight = useRef(false);
    const mounted = useRef(true);
    const loadRef = useRef(props.load ?? defaultLoad);
    loadRef.current = props.load ?? defaultLoad;

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        setSaved({ kind: "loading" });
        loadRef
            .current()
            .then((account) => {
                if (!cancelled) setSaved({ kind: "loaded", account });
            })
            .catch((e) => {
                logger.warn("Clariva wallet: could not load the saved payout account", e);
                if (!cancelled) setSaved({ kind: "failed" });
            });
        return () => {
            cancelled = true;
        };
    }, [loadAttempt]);

    const ifscStatus = useIfscLookup(
        form.ifscCode,
        (branch) => {
            const found = { bank: branch.bank, branch: branch.branch };
            const previous = autofilled.current;
            setForm((f) => applyIfscAutofill(f, found, previous));
            autofilled.current = found;
        },
        props.lookup ?? ifscLookup,
    );

    const canSave = canSaveBankDetails(form, ifscBlocksSave(ifscStatus), saving);
    const hasAccount = saved.kind === "loaded" && saved.account !== null;

    const setField = (field: BankField, value: string): void => {
        setForm((f) => ({ ...f, [field]: sanitizeBankInput(field, value) }));
        setError(null);
        setJustSaved(false);
    };

    const onSubmit = async (): Promise<void> => {
        if (!canSave || inFlight.current) return;
        inFlight.current = true;
        setSaving(true);
        setError(null);
        setJustSaved(false);
        try {
            const account = await (props.save ?? defaultSave)(toMyBankDetailsBody(form));
            if (!mounted.current) return;
            setSaved({ kind: "loaded", account });
            setForm(EMPTY_BANK_FORM);
            autofilled.current = null;
            setJustSaved(true);
        } catch (e) {
            logger.warn("Clariva wallet: could not save bank details", e);
            if (mounted.current) setError(bankSaveErrorText(e));
        } finally {
            inFlight.current = false;
            if (mounted.current) setSaving(false);
        }
    };

    const supportFor = (field: BankField): React.ComponentProps<typeof AuthField>["support"] => {
        if (field === "accountNumber") {
            const message = accountNumberError(form.accountNumber);
            return message ? { kind: "error", text: message } : null;
        }
        if (field === "ifscCode") return ifscSupport(form.ifscCode, ifscStatus);
        return null;
    };

    return (
        <div className="mx_ClarivaBank" data-testid="clariva-bank-details">
            <SavedAccountCard saved={saved} onRetry={() => setLoadAttempt((n) => n + 1)} />

            <form
                className="mx_ClarivaBank_form"
                noValidate
                aria-labelledby="mx_ClarivaBank_formTitle"
                onSubmit={(ev: React.FormEvent) => {
                    ev.preventDefault();
                    void onSubmit();
                }}
            >
                <div className="mx_ClarivaBank_formHeader">
                    <h3 className="mx_ClarivaBank_formTitle" id="mx_ClarivaBank_formTitle">
                        {hasAccount ? S.replacePayoutAccount : S.addPayoutAccount}
                    </h3>
                    <p className="mx_ClarivaBank_formSubtitle">{S.payoutAccountSubtitle}</p>
                </div>
                {FIELDS.map(({ field, label, placeholder, numeric, identifier }) => (
                    <AuthField
                        key={field}
                        id={`mx_ClarivaBank_${field}`}
                        label={label}
                        value={form[field]}
                        onChange={(value) => setField(field, value)}
                        placeholder={placeholder}
                        autoComplete="off"
                        inputMode={numeric ? "numeric" : undefined}
                        identifier={identifier}
                        maxLength={
                            field === "accountNumber" || field === "ifscCode"
                                ? undefined
                                : BankAccountRules.MAX_TEXT_LENGTH
                        }
                        disabled={saving}
                        support={supportFor(field)}
                        testId={`clariva-bank-${field}`}
                    />
                ))}
                {error !== null && (
                    <p className="mx_ClarivaBank_error" role="alert" data-testid="clariva-bank-error">
                        <ErrorIcon aria-hidden="true" />
                        {error}
                    </p>
                )}
                {justSaved && (
                    <p className="mx_ClarivaBank_success" role="status" data-testid="clariva-bank-saved">
                        <CheckCircleIcon aria-hidden="true" />
                        {S.savedChanges}
                    </p>
                )}
                <div className="mx_ClarivaBank_buttons">
                    <Button
                        kind="primary"
                        type="submit"
                        className="mx_Dialog_nonDialogButton"
                        disabled={!canSave}
                        data-testid="clariva-bank-save"
                    >
                        {saving ? S.saving : S.saveDetails}
                    </Button>
                </div>
                <p className="mx_ClarivaBank_note">{S.bankReplaceNote}</p>
            </form>
        </div>
    );
}

/** "Current payout account": loading, none yet, the masked account, or a failed load with Retry. */
function SavedAccountCard({ saved, onRetry }: { saved: SavedState; onRetry: () => void }): JSX.Element {
    let body: JSX.Element;
    if (saved.kind === "loading") {
        body = (
            <p className="mx_ClarivaBank_savedLine" role="status">
                <InlineSpinner />
                {S.payoutAccountLoading}
            </p>
        );
    } else if (saved.kind === "failed") {
        body = (
            <div className="mx_ClarivaBank_savedFailed">
                <p className="mx_ClarivaBank_error" role="alert">
                    <ErrorIcon aria-hidden="true" />
                    {S.payoutAccountLoadFailed}
                </p>
                <button
                    type="button"
                    className="mx_ClarivaBank_retry mx_Dialog_nonDialogButton"
                    onClick={onRetry}
                    data-testid="clariva-bank-retry"
                >
                    {S.retry}
                </button>
            </div>
        );
    } else if (saved.account === null) {
        body = <p className="mx_ClarivaBank_savedLine">{S.noPayoutAccount}</p>;
    } else {
        body = (
            <>
                <p className="mx_ClarivaBank_savedTitle">
                    <LockIcon aria-hidden="true" />
                    {savedAccountTitle(saved.account)}
                </p>
                <p className="mx_ClarivaBank_savedDetails">{savedAccountDetails(saved.account)}</p>
            </>
        );
    }
    return (
        <section
            className="mx_ClarivaBank_saved"
            aria-labelledby="mx_ClarivaBank_savedLabel"
            data-testid="clariva-bank-saved-account"
        >
            <h3 className="mx_ClarivaBank_savedLabel" id="mx_ClarivaBank_savedLabel">
                {S.currentPayoutAccount}
            </h3>
            {body}
        </section>
    );
}
