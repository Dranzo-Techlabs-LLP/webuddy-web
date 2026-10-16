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

/** Brand colours of the mark (also exposed as --clariva-navy / --clariva-teal in res/css/clariva/_brand.pcss). */
const NAVY = "#0B1C3D";
const TEAL = "#00BFA5";

/**
 * The Clariva mark, drawn inline from the real master asset (res/themes/clariva/img/logos/clariva-logo.svg): a navy back
 * bubble and a teal front bubble, each with its tail on the BOTTOM edge (back bubble tail at x 380..425, front bubble tail
 * at x 545..590), and a white eye with a navy pupil in the upper-left of the front bubble. The path data and the group
 * transform are copied verbatim from the asset; only the viewBox is cropped to the glyph (x 113..911, y 187..837 in the
 * asset’s 1024 box) so the mark fills its tile instead of floating in empty padding. Inline (no <img>) so the landing
 * page has no asset dependency and the mark inherits the page’s rendering and a11y (role=img, name "Clariva").
 */
export const ClarivaLogo: React.FC<{ className?: string }> = ({ className }) => (
    <svg
        className={className}
        viewBox="107 181 810 662"
        role="img"
        aria-label="Clariva"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
    >
        <g transform="translate(512 512) scale(1.15) translate(-512 -532.5)">
            {/* back bubble (navy) */}
            <path
                d="M 230 250 L 540 250 Q 605 250 605 315 L 605 470 Q 605 535 540 535 L 425 535 L 380 595 L 380 535 L 230 535 Q 165 535 165 470 L 165 315 Q 165 250 230 250 Z"
                fill={NAVY}
            />
            {/* front bubble (teal) */}
            <path
                d="M 484 420 L 794 420 Q 859 420 859 485 L 859 690 Q 859 755 794 755 L 590 755 L 545 815 L 545 755 L 484 755 Q 419 755 419 690 L 419 485 Q 419 420 484 420 Z"
                fill={TEAL}
            />
            {/* eye */}
            <circle cx="540" cy="510" r="32" fill="#FFFFFF" />
            <circle cx="540" cy="510" r="13" fill={NAVY} />
        </g>
    </svg>
);
