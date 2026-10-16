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

import React, { useCallback, useRef } from "react";
import { Icon as VideoCallIcon } from "@vector-im/compound-design-tokens/icons/video-call.svg";
import { Icon as VoiceCallIcon } from "@vector-im/compound-design-tokens/icons/voice-call.svg";

import BaseDialog from "../../../components/views/dialogs/BaseDialog";
import { getKeyBindingsManager } from "../../../KeyBindingsManager";
import { KeyBindingAction } from "../../../accessibility/KeyboardShortcuts";
import { callsStrings } from "../../strings/calls";

export type CallChoice = "voice" | "video";

interface Props {
    /** The choice, or nothing when dismissed (Cancel, Esc, click outside). */
    onFinished(choice?: CallChoice): void;
}

/**
 * Android's "Start a call" chooser (spec 04 §2.2): title "Start a call", body "Choose how you want to call.", full
 * width "Voice call" / "Video call" options and "Cancel". Picking one closes the dialog and reports the choice.
 * (mx_Dialog_nonDialogButton: otherwise upstream restyles every <button> inside a dialog as an outlined pill.)
 *
 * Look (res/css/clariva/_calls.pcss): the two options are 64px inset glass tiles (icon disc + label), hover and the
 * keyboard focus state lift them with a teal edge; Cancel is the quiet secondary pill. They are plain buttons, so Tab,
 * Enter and Space work exactly as before (Esc is BaseDialog's); Up / Down additionally walk the three buttons (wrapping),
 * which is what a list of choices is expected to do.
 */
export function ClarivaCallChooserDialog({ onFinished }: Props): JSX.Element {
    const list = useRef<HTMLDivElement>(null);
    const onKeyDown = useCallback((ev: React.KeyboardEvent): void => {
        const action = getKeyBindingsManager().getAccessibilityAction(ev);
        if (action !== KeyBindingAction.ArrowDown && action !== KeyBindingAction.ArrowUp) return;
        const buttons = Array.from(list.current?.querySelectorAll("button") ?? []);
        const at = buttons.findIndex((button) => button === document.activeElement);
        if (at < 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        const step = action === KeyBindingAction.ArrowDown ? 1 : -1;
        buttons[(at + step + buttons.length) % buttons.length].focus();
    }, []);

    return (
        <BaseDialog
            className="mx_ClarivaCallChooser"
            title={callsStrings.startCall}
            contentId="mx_ClarivaCallChooser_content"
            onFinished={() => onFinished()}
            fixedWidth={false}
        >
            <div className="mx_Dialog_content" id="mx_ClarivaCallChooser_content">
                <p className="mx_ClarivaCallChooser_body">{callsStrings.chooseHowToCall}</p>
                <div className="mx_ClarivaCallChooser_options" ref={list} onKeyDown={onKeyDown}>
                    <button
                        type="button"
                        className="mx_ClarivaCallChooser_option mx_ClarivaCallChooser_voice mx_Dialog_nonDialogButton"
                        data-testid="clariva-call-voice"
                        onClick={() => onFinished("voice")}
                    >
                        <span className="mx_ClarivaCallChooser_icon" aria-hidden="true">
                            <VoiceCallIcon width="24px" height="24px" />
                        </span>
                        <span className="mx_ClarivaCallChooser_label">{callsStrings.voiceCall}</span>
                    </button>
                    <button
                        type="button"
                        className="mx_ClarivaCallChooser_option mx_ClarivaCallChooser_video mx_Dialog_nonDialogButton"
                        data-testid="clariva-call-video"
                        onClick={() => onFinished("video")}
                    >
                        <span className="mx_ClarivaCallChooser_icon" aria-hidden="true">
                            <VideoCallIcon width="24px" height="24px" />
                        </span>
                        <span className="mx_ClarivaCallChooser_label">{callsStrings.videoCall}</span>
                    </button>
                    <button
                        type="button"
                        className="mx_ClarivaCallChooser_cancel mx_Dialog_nonDialogButton"
                        data-testid="clariva-call-cancel"
                        onClick={() => onFinished()}
                    >
                        {callsStrings.cancel}
                    </button>
                </div>
            </div>
        </BaseDialog>
    );
}
