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
import ErrorIcon from "@vector-im/compound-design-tokens/assets/web/icons/error";
import { logger } from "matrix-js-sdk/src/logger";

import Modal from "../../../Modal";
import BaseDialog from "../../../components/views/dialogs/BaseDialog";
import AccessibleButton from "../../../components/views/elements/AccessibleButton";
import DialogButtons from "../../../components/views/elements/DialogButtons";
import Field from "../../../components/views/elements/Field";
import SettingsSubsection from "../../../components/views/settings/shared/SettingsSubsection";
import { isClarivaEnabled } from "../../config";
import { useWalletSnapshot } from "../../hooks/useWallet";
import { DEFAULT_CONSULTANT_DESIGNATION, MAX_DESIGNATION_LENGTH } from "../../profile/settings";
import { WalletStore } from "../../stores/WalletStore";
import { profileStrings as S } from "../../strings/profile";
import { ClarivaRoleBadge } from "../room/RoleBadge";

/** Can `value` be saved as a designation? Blank is fine (it restores the default "Consultant"). */
export function isValidDesignation(value: string): boolean {
    return value.trim().length <= MAX_DESIGNATION_LENGTH;
}

interface DialogProps {
    /** The saved designation, `null` when none is set. */
    value: string | null;
    /** The text to save on Save (may be blank), `undefined` on Cancel / Esc / click outside. */
    onFinished(value?: string): void;
}

/** The designation editor (Android `PreferencesRootView.DesignationItem`'s `TextFieldDialog`). */
export function DesignationDialog({ value, onFinished }: DialogProps): JSX.Element {
    const [draft, setDraft] = useState(value ?? "");
    const valid = isValidDesignation(draft);
    const submit = (ev?: React.FormEvent): void => {
        ev?.preventDefault();
        if (valid) onFinished(draft);
    };
    return (
        <BaseDialog
            className="mx_ClarivaDesignationDialog"
            title={S.designationTitle}
            contentId="mx_ClarivaDesignationDialog_content"
            onFinished={() => onFinished()}
            fixedWidth={false}
        >
            <form onSubmit={submit}>
                <div className="mx_Dialog_content" id="mx_ClarivaDesignationDialog_content">
                    <p className="mx_ClarivaDesignation_hint">{S.designationHint}</p>
                    <Field
                        id="mx_ClarivaDesignationDialog_input"
                        label={S.designationTitle}
                        placeholder={S.designationPlaceholder}
                        value={draft}
                        autoFocus={true}
                        autoComplete="off"
                        onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setDraft(ev.target.value)}
                        aria-invalid={!valid || undefined}
                        aria-describedby={valid ? undefined : "mx_ClarivaDesignationDialog_error"}
                    />
                    {!valid && (
                        <p id="mx_ClarivaDesignationDialog_error" className="mx_ClarivaDesignation_error" role="alert">
                            <ErrorIcon aria-hidden="true" />
                            {S.designationTooLong}
                        </p>
                    )}
                </div>
                <DialogButtons
                    primaryButton={S.designationSave}
                    cancelButton={S.designationCancel}
                    primaryIsSubmit={true}
                    primaryDisabled={!valid}
                    onCancel={() => onFinished()}
                />
            </form>
        </BaseDialog>
    );
}

interface Props {
    /** Test seam: the save call (default: the WalletStore, which writes it into my wallet `settings`). */
    save?: (designation: string) => Promise<void>;
}

/**
 * Settings -> Account -> "Designation", for consultants only (Android `PreferencesRootView.DesignationItem`): the title
 * shown as the badge beside their name in chats, "Consultant" when none is set. Edited in a small dialog (at most 40
 * characters; blank restores the default). Renders nothing for a client, while the role is unknown, or without Clariva.
 */
export function ClarivaDesignationSettings({ save }: Props): JSX.Element | null {
    const wallet = useWalletSnapshot();
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);
    const mounted = useRef(true);
    useEffect(
        () => () => {
            mounted.current = false;
        },
        [],
    );

    if (!isClarivaEnabled() || wallet.isConsultant !== true) return null;
    const designation = wallet.designation ?? null;

    const edit = async (): Promise<void> => {
        const { finished } = Modal.createDialog(DesignationDialog, { value: designation });
        const [next] = await finished;
        if (next === undefined || !mounted.current) return;
        setSaving(true);
        setFailed(false);
        try {
            await (save ?? ((d: string) => WalletStore.instance.updateDesignation(d)))(next);
        } catch (e) {
            logger.warn("Clariva: could not save the designation", e);
            if (mounted.current) setFailed(true);
        } finally {
            if (mounted.current) setSaving(false);
        }
    };

    return (
        <SettingsSubsection heading={S.designationTitle} data-testid="clariva-designation">
            <div className="mx_ClarivaDesignation_row">
                <ClarivaRoleBadge text={designation ?? DEFAULT_CONSULTANT_DESIGNATION} />
                <AccessibleButton
                    kind="primary_outline"
                    className="mx_ClarivaDesignation_edit"
                    disabled={saving}
                    onClick={() => void edit()}
                    data-testid="clariva-designation-edit"
                >
                    {S.designationEdit}
                </AccessibleButton>
            </div>
            <p className="mx_ClarivaDesignation_hint">{S.designationHint}</p>
            {failed && (
                <p className="mx_ClarivaDesignation_error" role="alert" data-testid="clariva-designation-error">
                    <ErrorIcon aria-hidden="true" />
                    {S.designationSaveFailed}
                </p>
            )}
        </SettingsSubsection>
    );
}
