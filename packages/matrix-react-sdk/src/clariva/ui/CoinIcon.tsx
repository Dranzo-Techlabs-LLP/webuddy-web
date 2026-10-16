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
import classNames from "classnames";

export interface CoinIconProps {
    /** Pixel size of the square glyph. The design uses 20. */
    size?: number;
    /** Play the one-shot specular sweep across the coin (a credits-updated moment, not an idle shimmer). */
    glint?: boolean;
    /** Accessible name. Omit for a purely decorative coin (the default: the amount next to it carries the meaning). */
    title?: string;
    className?: string;
}

let nextClipId = 0;

/**
 * The credits coin: an amber face (`--cg-amber`), a rim and a "C" in currentColor (navy by default, so it keeps its
 * contrast on amber; set `color` to change it). Amber is reserved for money, so this glyph is the only place it shows
 * up in the UI chrome. Styles: `.cg-coin` in res/css/clariva/_glass.pcss, `.cg-coin__glint` in _motion.pcss.
 */
export function CoinIcon({ size = 20, glint = false, title, className }: CoinIconProps): JSX.Element {
    // one id per instance (React 17 has no useId): the clip keeps the sweep inside the circle
    const [clipId] = useState<string>(() => `cg-coin-clip-${nextClipId++}`);

    return (
        <svg
            className={classNames("cg-coin", className)}
            width={size}
            height={size}
            viewBox="0 0 20 20"
            fill="none"
            focusable="false"
            aria-hidden={title ? undefined : true}
            role={title ? "img" : undefined}
            data-testid="clariva-coin"
        >
            {title && <title>{title}</title>}
            <circle className="cg-coin__face" cx="10" cy="10" r="9.25" stroke="currentColor" strokeWidth="1.5" />
            <path
                d="M12.69 7.31A3.8 3.8 0 1 0 12.69 12.69"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
            />
            {glint && (
                <>
                    <clipPath id={clipId}>
                        <circle cx="10" cy="10" r="8.5" />
                    </clipPath>
                    <g clipPath={`url(#${clipId})`}>
                        <g transform="rotate(25 10 10)">
                            <rect
                                className="cg-coin__glint"
                                x="7"
                                y="-4"
                                width="4"
                                height="28"
                                fill="#ffffff"
                                fillOpacity="0.6"
                            />
                        </g>
                    </g>
                </>
            )}
        </svg>
    );
}

export default CoinIcon;
