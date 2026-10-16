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

import React from "react";
import classNames from "classnames";

import { formatCredits } from "../../money";
import { walletStrings as S } from "../../strings/wallet";
import { CoinIcon } from "../../ui";

/** Whether the user asked the system for less motion (a browser without `matchMedia`, like jsdom, says no). */
export function prefersReducedMotion(): boolean {
    try {
        return (
            typeof window !== "undefined" &&
            typeof window.matchMedia === "function" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches === true
        );
    } catch {
        return false;
    }
}

export interface RechargeSuccessProps {
    /** Credits that were just added, or `null` when the server did not say. */
    added: number | null;
    /** The balance after the recharge, or `null` when it is not known (yet). */
    newBalance: number | null;
    /**
     * Whether the seal may animate: the coin glints once and the check draws itself once. Defaults to "unless the user
     * prefers reduced motion"; pass `false` to render the finished picture, still. (The stylesheet also stops both under
     * `prefers-reduced-motion`, so a browser that changes its mind mid-session is covered too.)
     */
    animate?: boolean;
}

/**
 * The one allowed delight of the wallet (docs/clariva/DESIGN-SYSTEM.md, section 5, "rare"): after a recharge the coin glints
 * once, a Deep Teal check draws itself (stroke-dashoffset, 400 ms) and the title "Credits added" appears in the display
 * face. The picture is decorative (`aria-hidden`); the title and the lines under it carry the meaning, in a status region.
 * Styles: `.mx_ClarivaSuccess*` in res/css/clariva/_wallet.pcss.
 */
export function RechargeSuccess({ added, newBalance, animate }: RechargeSuccessProps): JSX.Element {
    const animated = animate ?? !prefersReducedMotion();
    return (
        <div className="mx_ClarivaSuccess" role="status" data-testid="clariva-success" data-animated={animated}>
            <div
                className={classNames("mx_ClarivaSuccess_seal", { mx_ClarivaSuccess_seal_animate: animated })}
                aria-hidden="true"
                data-testid="clariva-success-seal"
            >
                <span className="mx_ClarivaSuccess_coin">
                    <CoinIcon size={56} glint={animated} />
                </span>
                <svg className="mx_ClarivaSuccess_check" viewBox="0 0 34 34" focusable="false">
                    <circle className="mx_ClarivaSuccess_disc" cx="17" cy="17" r="15" />
                    {/* pathLength=1: the dash is "one whole path", so the draw is a plain 1 -> 0 offset */}
                    <path className="mx_ClarivaSuccess_tick" d="M10.5 17.5l4.5 4.5 8.5-9.5" pathLength={1} />
                </svg>
            </div>
            <h2 className="mx_ClarivaSuccess_title">{S.rechargeSuccessTitle}</h2>
            {added !== null && (
                <p className="mx_ClarivaSuccess_body">{S.rechargeSuccessBody(formatCredits(added, true))}</p>
            )}
            {newBalance !== null && (
                <p className="mx_ClarivaSuccess_balance">{S.newBalance(formatCredits(newBalance, true))}</p>
            )}
        </div>
    );
}

export default RechargeSuccess;
