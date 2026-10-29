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
import AccessibleButton from "../../../components/views/elements/AccessibleButton";
import StyledRadioGroup from "../../../components/views/elements/StyledRadioGroup";
import { SettingsSection } from "../../../components/views/settings/shared/SettingsSection";
import SettingsSubsection from "../../../components/views/settings/shared/SettingsSubsection";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { isClarivaEnabled } from "../../config";
import { useWalletSnapshot } from "../../hooks/useWallet";
import {
    DEFAULT_PRESENCE_PRIVACY,
    LastSeenAudience,
    OnlineAudience,
    type PresencePrivacy,
} from "../../profile/settings";
import { presenceContacts } from "../../presence/contacts";
import {
    excludedContactIds,
    withExceptions,
    withLastSeenAudience,
    withOnlineAudience,
} from "../../presence/lastSeenPrivacy";
import { WalletStore } from "../../stores/WalletStore";
import { profileStrings as S } from "../../strings/profile";
import { LastSeenExceptionsDialog } from "./LastSeenExceptionsDialog";

const LAST_SEEN_LABELS: Record<LastSeenAudience, string> = {
    [LastSeenAudience.Everyone]: S.audienceEveryone,
    [LastSeenAudience.MyContacts]: S.audienceMyContacts,
    [LastSeenAudience.MyContactsExcept]: S.audienceMyContactsExcept,
    [LastSeenAudience.Nobody]: S.audienceNobody,
};

const ONLINE_LABELS: Record<OnlineAudience, string> = {
    [OnlineAudience.Everyone]: S.audienceEveryone,
    [OnlineAudience.SameAsLastSeen]: S.onlineSameAsLastSeen,
};

interface Props {
    /** Test seam: the save call (default: the WalletStore, which writes it into my wallet `settings`). */
    save?: (privacy: PresencePrivacy) => Promise<void>;
}

/**
 * Settings -> Security & Privacy -> "Last seen and online" (Android `LastSeenPrivacyView` / `LastSeenPrivacyPresenter`):
 * who can see my last seen (Everyone / My contacts / My contacts except... / Nobody) and who can see when I'm online
 * (Everyone / Same as last seen). Saved in my Wallet-API `settings` so chat partners' apps honour it, and reciprocal
 * like WhatsApp (the note under the options). A change shows at once while it saves and reverts if saving fails; the
 * options stay enabled meanwhile (keyboard focus stays put) and changes made during a save are saved after it.
 * Renders nothing unless Clariva is configured.
 */
export function ClarivaLastSeenSettings({ save }: Props): JSX.Element | null {
    if (!isClarivaEnabled()) return null;
    return <LastSeenSettingsSection save={save} />;
}

function LastSeenSettingsSection({ save }: Props): JSX.Element {
    const client = useMatrixClientContext();
    const wallet = useWalletSnapshot();
    // shown while a change is being saved, then dropped, so a failed save reverts the page
    const [pending, setPending] = useState<PresencePrivacy | null>(null);
    const [failed, setFailed] = useState(false);
    // "My contacts except..." reached with the arrow keys: selected on screen only, until the picker is opened
    const [draftExcept, setDraftExcept] = useState(false);
    const mounted = useRef(true);
    // one save at a time (each is a read-merge-write of my settings); the newest choice made meanwhile goes next
    const saving = useRef(false);
    const queued = useRef<PresencePrivacy | null>(null);
    // the newest choice not yet saved (the store only changes once a save lands)
    const latest = useRef<PresencePrivacy | null>(null);
    // true between an arrow key going down and the next key/pointer: the radio change it causes is navigation
    const arrowNav = useRef(false);
    useEffect(
        () => () => {
            mounted.current = false;
        },
        [],
    );

    const myId = client.getSafeUserId();
    const saved = pending ?? wallet.presencePrivacy ?? DEFAULT_PRESENCE_PRIVACY;
    const privacy = draftExcept ? { ...saved, lastSeen: LastSeenAudience.MyContactsExcept } : saved;

    useEffect(() => {
        // normally loaded with the wallet at startup; this covers a startup fetch that failed
        if (wallet.userId && !wallet.presencePrivacy) void WalletStore.instance.refreshBalance().catch(() => {});
    }, [wallet.userId, wallet.presencePrivacy]);

    const doSave = async (next: PresencePrivacy): Promise<void> => {
        setPending(next);
        latest.current = next;
        setFailed(false);
        setDraftExcept(false);
        if (saving.current) {
            queued.current = next;
            return;
        }
        saving.current = true;
        const write = save ?? ((p: PresencePrivacy): Promise<void> => WalletStore.instance.updatePresencePrivacy(p));
        let current: PresencePrivacy | null = next;
        while (current) {
            let ok = true;
            try {
                await write(current);
            } catch (e) {
                ok = false;
                logger.warn("Clariva: could not save the last seen choice", e);
            }
            current = queued.current;
            queued.current = null;
            // only the newest choice's outcome is reported
            if (!current && !ok && mounted.current) setFailed(true);
        }
        saving.current = false;
        latest.current = null;
        if (mounted.current) setPending(null);
    };

    const pickExceptions = async (): Promise<void> => {
        const contacts = presenceContacts(client);
        const ids = contacts.map((c) => c.userId);
        const { finished } = Modal.createDialog(LastSeenExceptionsDialog, {
            contacts,
            excluded: excludedContactIds(saved, myId, ids),
        });
        const [excluded] = await finished;
        if (!mounted.current) return;
        if (!excluded) {
            setDraftExcept(false);
            return;
        }
        // the choice may have moved on while the picker was open: start from the newest one, saved or still saving
        const current =
            latest.current ?? WalletStore.instance.getSnapshot().presencePrivacy ?? DEFAULT_PRESENCE_PRIVACY;
        await doSave(withExceptions(current, myId, ids, excluded));
    };

    const onLastSeen = (audience: LastSeenAudience): void => {
        if (audience === LastSeenAudience.MyContactsExcept) {
            // Android acts on a tap only: arrowing past this option must not open the picker on the way
            if (arrowNav.current) setDraftExcept(true);
            else void pickExceptions();
            return;
        }
        setDraftExcept(false);
        const next = withLastSeenAudience(saved, audience);
        if (next) void doSave(next);
    };

    const onLastSeenKeyDown = (e: React.KeyboardEvent): void => {
        arrowNav.current = e.key.startsWith("Arrow");
        // Enter on the selected "My contacts except..." opens the picker (a radio does nothing on Enter by itself)
        const target = e.target as HTMLInputElement;
        if (e.key === "Enter" && target.value === LastSeenAudience.MyContactsExcept && target.checked) {
            e.preventDefault();
            void pickExceptions();
        }
    };

    const onOnline = (audience: OnlineAudience): void => {
        const next = withOnlineAudience(saved, audience);
        if (next) void doSave(next);
    };

    const isExcept = privacy.lastSeen === LastSeenAudience.MyContactsExcept;

    return (
        <SettingsSection heading={S.lastSeenTitle} data-testid="clariva-last-seen">
            <SettingsSubsection heading={S.lastSeenWho} stretchContent>
                <div
                    className="mx_ClarivaLastSeen_options"
                    role="radiogroup"
                    aria-label={S.lastSeenWho}
                    onKeyDown={onLastSeenKeyDown}
                    onKeyUp={() => (arrowNav.current = false)}
                    onPointerDown={() => (arrowNav.current = false)}
                >
                    <StyledRadioGroup<LastSeenAudience>
                        name="clariva_last_seen"
                        value={privacy.lastSeen}
                        onChange={onLastSeen}
                        definitions={Object.values(LastSeenAudience).map((audience) => ({
                            value: audience,
                            label: LAST_SEEN_LABELS[audience],
                            description:
                                audience === LastSeenAudience.MyContactsExcept && isExcept ? (
                                    <span className="mx_ClarivaLastSeen_except">
                                        <span data-testid="clariva-except-summary">
                                            {S.excludedSummary(draftExcept ? 0 : privacy.lastSeenExcept.size)}
                                        </span>
                                        <AccessibleButton
                                            kind="link_inline"
                                            onClick={() => void pickExceptions()}
                                            data-testid="clariva-except-edit"
                                        >
                                            {S.editExceptions}
                                        </AccessibleButton>
                                    </span>
                                ) : undefined,
                        }))}
                    />
                </div>
            </SettingsSubsection>
            <SettingsSubsection heading={S.onlineWho} stretchContent>
                <div className="mx_ClarivaLastSeen_options" role="radiogroup" aria-label={S.onlineWho}>
                    <StyledRadioGroup<OnlineAudience>
                        name="clariva_online"
                        value={privacy.online}
                        onChange={onOnline}
                        definitions={Object.values(OnlineAudience).map((audience) => ({
                            value: audience,
                            label: ONLINE_LABELS[audience],
                        }))}
                    />
                </div>
                <p className="mx_ClarivaLastSeen_hint">{S.reciprocityNote}</p>
                {failed && (
                    <p className="mx_ClarivaLastSeen_error" role="alert" data-testid="clariva-last-seen-error">
                        <ErrorIcon aria-hidden="true" />
                        {S.saveFailed}
                    </p>
                )}
            </SettingsSubsection>
        </SettingsSection>
    );
}
