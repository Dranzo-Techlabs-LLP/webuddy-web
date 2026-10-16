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
import classNames from "classnames";
import { Button } from "@vector-im/compound-web";
import CheckCircleIcon from "@vector-im/compound-design-tokens/assets/web/icons/check-circle-solid";
import ErrorIcon from "@vector-im/compound-design-tokens/assets/web/icons/error";
import { logger } from "matrix-js-sdk/src/logger";

import Spinner from "../../../components/views/elements/Spinner";
import { useWalletSnapshot } from "../../hooks/useWallet";
import { WalletStore } from "../../stores/WalletStore";
import { walletStrings as S } from "../../strings/wallet";
import {
    MAX_CREDITS_DIGITS,
    MAX_CREDITS_LIMIT,
    canSave,
    displayedValue,
    isDirty,
    isTooLarge,
    parseDraft,
    sanitizeMaxCreditsInput,
} from "../../wallet/maxCredits";

interface Props {
    /** Test seams: the saved price (default: the polled wallet store) and the save call (default: the store). */
    saved?: number | null;
    save?: (maxCredits: number) => Promise<void>;
}

type Result = "saved" | "error" | null;

function noop(): void {}

/**
 * Consultant "Max Credits" (the price of one 24-hour chat, spec 02 §2.6 / §3.8).
 *
 * The user's edit is a draft kept in THIS component's state and nothing else ever writes to it, so the balance poll
 * (which refreshes the saved value every 15 s) can never reset what is being typed (Android bug, spec 02 §7.2.4).
 * Save/Cancel appear only while the draft is non-empty and differs from the saved value.
 */
export default function MaxCreditsEditor(props: Props): JSX.Element {
    const snapshot = useWalletSnapshot();
    const saved = props.saved !== undefined ? props.saved : snapshot.maxCredits;
    const doSave = props.save ?? ((n: number) => WalletStore.instance.updateMaxCredits(n));

    const [draft, setDraft] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState<Result>(null);
    const inFlight = useRef(false); // synchronous double-click guard (state updates are async)

    const dirty = isDirty(draft, saved);
    const tooLarge = isTooLarge(draft);

    const onChange = (ev: React.ChangeEvent<HTMLInputElement>): void => {
        setDraft(sanitizeMaxCreditsInput(ev.target.value));
        setResult(null); // a result line clears as soon as the user edits again
    };

    const onCancel = (): void => {
        if (saving) return;
        setDraft(null);
        setResult(null);
    };

    const onSave = async (): Promise<void> => {
        const value = parseDraft(draft);
        if (value === null || inFlight.current || !canSave(draft, saved, saving)) return;
        inFlight.current = true;
        setSaving(true);
        setResult(null);
        try {
            await doSave(value);
            setDraft(null); // the saved value (now updated in the store) is the baseline again
            setResult("saved");
        } catch (e) {
            logger.warn("Clariva wallet: could not save max credits", e);
            setResult("error"); // the draft stays so the user can retry
        } finally {
            inFlight.current = false;
            setSaving(false);
        }
    };

    return (
        <div className="mx_ClarivaMaxCredits" data-testid="clariva-max-credits">
            <div className="mx_ClarivaAuth_field">
                <label className="mx_ClarivaAuth_label" htmlFor="mx_ClarivaMaxCredits_input">
                    {S.maxCredits}
                </label>
                {saved === null && draft === null ? (
                    // initial load only; the field stays mounted during a save so a focused field is never disposed
                    <div className="mx_ClarivaMaxCredits_loading">
                        <Spinner w={24} h={24} onFinished={noop} />
                    </div>
                ) : (
                    <div
                        className={classNames(
                            "mx_ClarivaAuth_inputRow",
                            "mx_ClarivaMaxCredits_inputRow",
                            "mx_no_textinput",
                            {
                                mx_ClarivaAuth_inputRow_error: tooLarge,
                            },
                        )}
                    >
                        <input
                            id="mx_ClarivaMaxCredits_input"
                            className="mx_ClarivaAuth_input"
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            maxLength={MAX_CREDITS_DIGITS}
                            value={displayedValue(draft, saved)}
                            onChange={onChange}
                            aria-describedby={
                                tooLarge
                                    ? "mx_ClarivaMaxCredits_help mx_ClarivaMaxCredits_tooLarge"
                                    : "mx_ClarivaMaxCredits_help"
                            }
                            aria-invalid={tooLarge || undefined}
                        />
                    </div>
                )}
                <p id="mx_ClarivaMaxCredits_help" className="mx_ClarivaMaxCredits_help">
                    {S.maxCreditsHelp}
                </p>
            </div>
            {tooLarge && (
                <p id="mx_ClarivaMaxCredits_tooLarge" className="mx_ClarivaMaxCredits_error" role="alert">
                    <ErrorIcon aria-hidden="true" />
                    {S.maxCreditsTooLarge(MAX_CREDITS_LIMIT.toLocaleString())}
                </p>
            )}
            {dirty && (
                <div className="mx_ClarivaMaxCredits_buttons">
                    <Button kind="secondary" className="mx_Dialog_nonDialogButton" onClick={onCancel} disabled={saving}>
                        {S.cancel}
                    </Button>
                    <Button
                        kind="primary"
                        className="mx_Dialog_nonDialogButton"
                        onClick={() => void onSave()}
                        disabled={saving || parseDraft(draft) === null}
                    >
                        {saving ? S.saving : S.save}
                    </Button>
                </div>
            )}
            {result === "saved" && (
                <p className="mx_ClarivaMaxCredits_success" role="status">
                    <CheckCircleIcon aria-hidden="true" />
                    {S.maxCreditsSaved}
                </p>
            )}
            {result === "error" && (
                <p className="mx_ClarivaMaxCredits_error" role="alert">
                    <ErrorIcon aria-hidden="true" />
                    {S.maxCreditsSaveFailed}
                </p>
            )}
        </div>
    );
}
