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

import React, { type CSSProperties, useEffect, useRef, useState } from "react";
import classNames from "classnames";

import Modal, { ModalManagerEvent } from "../../../Modal";
import { homeStrings as S } from "../../strings/home";
import { ClarivaAurora } from "../../ui";
import { ConsultantsRail } from "./ConsultantsRail";
import { QuickActions } from "./QuickActions";
import { WalletCard } from "./WalletCard";
import { useGreeting } from "./useGreeting";

/**
 * Whether the dashboard has been shown in this page's life. The entrance stagger is for the FIRST time only: coming back
 * to Home from a chat (which remounts the dashboard) must be instant, because going back to Home is something people do all
 * day (DESIGN-SYSTEM.md section 5, "frequency decides").
 */
let hasEntered = false;

/** Test helper: forget that the dashboard was shown. */
export function resetHomeEntranceForTests(): void {
    hasEntered = false;
}

/**
 * True while any dialog is open. A dialog is thick glass over a blurred scrim, so while one is up the page behind it must not
 * move (DESIGN-SYSTEM.md section 3, rule 6: a backdrop-filter re-blurs on every frame a layer under it changes): the
 * greeting glow holds still until the dialog closes.
 */
export function useDialogOpen(): boolean {
    const [open, setOpen] = useState<boolean>(() => Modal.hasDialogs());
    useEffect(() => {
        const sync = (): void => setOpen(Modal.hasDialogs());
        Modal.on(ModalManagerEvent.Opened, sync);
        Modal.on(ModalManagerEvent.Closed, sync);
        sync();
        return () => {
            Modal.off(ModalManagerEvent.Opened, sync);
            Modal.off(ModalManagerEvent.Closed, sync);
        };
    }, []);
    return open;
}

/** The four blocks that stagger in (greeting, wallet, rail, quick actions): 40 ms apart, see `--cg-stagger` in CSS. */
const stagger = (index: number): CSSProperties => ({ "--cg-stagger": index }) as CSSProperties;

/**
 * The desktop Home pane (what shows while no chat is open), replacing the logo and two buttons: a Fraunces greeting over a
 * slow aurora glow, the balance card, the recent chats, and three quick actions. Mounted by `HomePage` when Clariva is
 * configured; stock Element keeps its own pane.
 *
 * The LIVE aurora is allowed here only as the glow behind the greeting, and no glass card may overlap it (DESIGN-SYSTEM.md
 * section 3, rule 6): it fills the greeting block and nothing else, and the wallet card, the rail and the tiles are separate
 * blocks below it on the still wallpaper.
 */
export function HomeDashboard(): JSX.Element {
    const { text } = useGreeting();
    const dialogOpen = useDialogOpen();
    const animate = useRef(!hasEntered);
    useEffect(() => {
        hasEntered = true;
    }, []);
    const enter = animate.current ? "mx_ClarivaHome_enter" : undefined;

    return (
        <main className="mx_ClarivaHome" aria-label={S.dashboardLabel} tabIndex={-1} data-testid="clariva-home">
            <div className="mx_ClarivaHome_inner">
                <header className={classNames("mx_ClarivaHome_hero", enter)} style={stagger(0)}>
                    <ClarivaAurora live className={dialogOpen ? "cg-paused" : undefined} />
                    <h1 className="mx_ClarivaHome_greeting" data-testid="clariva-home-greeting">
                        {text}
                    </h1>
                    <p className="mx_ClarivaHome_tagline">{S.tagline}</p>
                </header>
                <div className={classNames("mx_ClarivaHome_block", enter)} style={stagger(1)}>
                    <WalletCard />
                </div>
                <div className={classNames("mx_ClarivaHome_block", enter)} style={stagger(2)}>
                    <ConsultantsRail />
                </div>
                <div className={classNames("mx_ClarivaHome_block", enter)} style={stagger(3)}>
                    <QuickActions />
                </div>
            </div>
        </main>
    );
}

export default HomeDashboard;
