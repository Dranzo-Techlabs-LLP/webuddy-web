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
import { chatStrings } from "../../strings/chat";

interface Props {
    /** `proceed` is true only for "Continue"; `neverRemind` is the checkbox (only meaningful when proceeding). */
    onFinished(proceed: boolean, neverRemind: boolean): void;
}

/**
 * "Start a new session?" (spec 03 U2). Shown when a client sends a text message and no hold covers it. Continue sends
 * the message (and, if ticked, remembers the consultant); Cancel / Esc / click-outside close it and send nothing, so
 * the draft stays in the composer.
 */
export function NewSessionDialog({ onFinished }: Props): JSX.Element {
    const [neverRemind, setNeverRemind] = useState(false);
    return (
        <BaseDialog
            className="mx_ClarivaNewSessionDialog"
            title={chatStrings.sessionNewTitle}
            contentId="mx_ClarivaNewSessionDialog_content"
            onFinished={() => onFinished(false, false)}
            fixedWidth={false}
        >
            <div className="mx_Dialog_content" id="mx_ClarivaNewSessionDialog_content">
                <p className="mx_ClarivaNewSessionDialog_body">{chatStrings.sessionNewBody}</p>
                <StyledCheckbox
                    className="mx_ClarivaNewSessionDialog_never"
                    checked={neverRemind}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNeverRemind(e.target.checked)}
                    data-testid="clariva-never-remind"
                >
                    {chatStrings.sessionNeverRemind}
                </StyledCheckbox>
            </div>
            <DialogButtons
                primaryButton={chatStrings.sessionContinue}
                cancelButton={chatStrings.sessionCancel}
                onPrimaryButtonClick={() => onFinished(true, neverRemind)}
                onCancel={() => onFinished(false, false)}
                focus={true}
            />
        </BaseDialog>
    );
}
