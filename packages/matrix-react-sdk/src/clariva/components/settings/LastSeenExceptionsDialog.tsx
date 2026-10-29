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

import BaseDialog from "../../../components/views/dialogs/BaseDialog";
import DialogButtons from "../../../components/views/elements/DialogButtons";
import StyledCheckbox from "../../../components/views/elements/StyledCheckbox";
import RoomAvatar from "../../../components/views/avatars/RoomAvatar";
import { type PresenceContact } from "../../presence/contacts";
import { profileStrings as S } from "../../strings/profile";

interface Props {
    /** The people offered: everyone I have a 1:1 chat with that both of us have joined, sorted by name. */
    contacts: PresenceContact[];
    /** Who is ticked when the picker opens (what is saved today). */
    excluded: ReadonlySet<string>;
    /** `excluded` is the new selection on Done, `undefined` on Cancel / Esc / click outside. */
    onFinished(excluded?: Set<string>): void;
}

/**
 * "Hide my last seen from" (Android `LastSeenPrivacyView.ExceptionsPicker`): the contacts of "My contacts except...",
 * each with a checkbox. A fresh selection each time it opens, starting from what is saved; Done saves it (and selects
 * "My contacts except..."), Cancel changes nothing.
 */
export function LastSeenExceptionsDialog({ contacts, excluded, onFinished }: Props): JSX.Element {
    const [selection, setSelection] = useState<Set<string>>(() => new Set(excluded));
    const toggle = (userId: string, checked: boolean): void => {
        setSelection((current) => {
            const next = new Set(current);
            if (checked) next.add(userId);
            else next.delete(userId);
            return next;
        });
    };

    return (
        <BaseDialog
            className="mx_ClarivaLastSeenExceptDialog"
            title={S.exceptTitle}
            contentId="mx_ClarivaLastSeenExceptDialog_content"
            onFinished={() => onFinished()}
            fixedWidth={false}
        >
            <div className="mx_Dialog_content" id="mx_ClarivaLastSeenExceptDialog_content">
                {contacts.length === 0 ? (
                    <p className="mx_ClarivaLastSeen_hint" data-testid="clariva-except-empty">
                        {S.exceptEmpty}
                    </p>
                ) : (
                    <>
                        <p className="mx_ClarivaLastSeen_hint">{S.exceptHint}</p>
                        <ul className="mx_ClarivaLastSeenExcept_list" data-testid="clariva-except-list">
                            {contacts.map((contact) => (
                                <li key={contact.userId} className="mx_ClarivaLastSeenExcept_row">
                                    <StyledCheckbox
                                        className="mx_ClarivaLastSeenExcept_check"
                                        checked={selection.has(contact.userId)}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                            toggle(contact.userId, e.target.checked)
                                        }
                                    >
                                        <span className="mx_ClarivaLastSeenExcept_person">
                                            <RoomAvatar room={contact.room} size="32px" />
                                            <span className="mx_ClarivaLastSeenExcept_names">
                                                <span className="mx_ClarivaLastSeenExcept_name">
                                                    {contact.name ?? contact.userId}
                                                </span>
                                                {contact.name && (
                                                    <span className="mx_ClarivaLastSeenExcept_id">
                                                        {contact.userId}
                                                    </span>
                                                )}
                                            </span>
                                        </span>
                                    </StyledCheckbox>
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </div>
            <DialogButtons
                primaryButton={S.exceptDone}
                cancelButton={S.exceptCancel}
                onPrimaryButtonClick={() => onFinished(selection)}
                onCancel={() => onFinished()}
            />
        </BaseDialog>
    );
}
