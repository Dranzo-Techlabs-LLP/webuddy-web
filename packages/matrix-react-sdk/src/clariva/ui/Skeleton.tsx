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

/** The radius scale of the design system (`--cg-r-*`). */
export type SkeletonRadiusToken = "xs" | "sm" | "md" | "lg" | "xl" | "pill";

export interface SkeletonProps {
    /** A number is pixels; a string is any CSS length ("60%", "12rem"). Omit to fill the parent's width. */
    width?: number | string;
    height?: number | string;
    /** A scale token ("pill" for avatars and chips) or any CSS radius. Default: the scale's "sm". */
    radius?: SkeletonRadiusToken | number | string;
    className?: string;
}

const TOKENS: readonly string[] = ["xs", "sm", "md", "lg", "xl", "pill"];

const toLength = (value: number | string | undefined): string | undefined =>
    typeof value === "number" ? `${value}px` : value;

function toRadius(radius: SkeletonProps["radius"]): string | undefined {
    if (radius === undefined) return undefined;
    if (typeof radius === "string" && TOKENS.includes(radius)) return `var(--cg-r-${radius})`;
    return toLength(radius);
}

/**
 * A placeholder block for content that is still loading: a quiet fill that pulses in opacity only (1.2 s,
 * `.cg-pulse`). It is hidden from assistive technology; mark the loading region itself with `aria-busy` and give it a
 * text status, as the real content is not there yet.
 */
export function Skeleton({ width, height, radius, className }: SkeletonProps): JSX.Element {
    return (
        <div
            className={classNames("cg-skeleton", "cg-pulse", className)}
            style={{ width: toLength(width), height: toLength(height), borderRadius: toRadius(radius) }}
            aria-hidden="true"
            data-testid="clariva-skeleton"
        />
    );
}

export default Skeleton;
