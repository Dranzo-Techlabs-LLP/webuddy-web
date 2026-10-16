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

import { useEffect, useState } from "react";

import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { OwnProfileStore } from "../../../stores/OwnProfileStore";
import { UPDATE_EVENT } from "../../../stores/AsyncStore";
import { useEventEmitterState } from "../../../hooks/useEventEmitter";
import { homeStrings as S } from "../../strings/home";

export type DayPart = "morning" | "afternoon" | "evening";

/** 05:00-11:59 morning, 12:00-16:59 afternoon, everything else (17:00 to 04:59) evening. */
export function dayPartForHour(hour: number): DayPart {
    if (hour >= 5 && hour < 12) return "morning";
    if (hour >= 12 && hour < 17) return "afternoon";
    return "evening";
}

/** "Good morning" / "Good afternoon" / "Good evening" for a local hour (0-23). */
export function greetingForHour(hour: number): string {
    switch (dayPartForHour(hour)) {
        case "morning":
            return S.greetingMorning;
        case "afternoon":
            return S.greetingAfternoon;
        case "evening":
            return S.greetingEvening;
    }
}

/** Milliseconds from `now` to the next 05:00 / 12:00 / 17:00 (when the greeting changes), at least one second. */
export function msUntilNextDayPart(now: Date): number {
    const next = new Date(now);
    for (const hour of [5, 12, 17]) {
        next.setHours(hour, 0, 0, 0);
        if (next.getTime() > now.getTime()) return Math.max(1000, next.getTime() - now.getTime());
    }
    next.setDate(next.getDate() + 1);
    next.setHours(5, 0, 0, 0);
    return Math.max(1000, next.getTime() - now.getTime());
}

const HONORIFIC = /^(dr|mr|mrs|ms|miss|mx|prof|sir)\.?$/i;

/**
 * The name to greet: the first word of the profile display name ("Asha Rao" -> "Asha"), keeping a leading title with
 * it ("Dr. Rao" -> "Dr. Rao"). Nothing when there is no usable name: an empty profile, or a display name that is just
 * the Matrix ID (which is what the profile store falls back to), because "Good evening, @asha:clarivahub.com" is not a
 * greeting.
 */
export function firstNameOf(displayName: string | null | undefined, userId?: string | null): string | null {
    const name = displayName?.trim();
    if (!name || name === userId || name.startsWith("@")) return null;
    const words = name.split(/\s+/);
    if (HONORIFIC.test(words[0]) && words.length > 1) return `${words[0]} ${words[1]}`;
    return words[0];
}

export interface Greeting {
    /** "Good evening" */
    greeting: string;
    /** "Asha", or null when the profile has no name */
    name: string | null;
    /** "Good evening, Asha" / "Good evening" */
    text: string;
}

const systemClock = (): Date => new Date();

const getOwnName = (): string | null =>
    firstNameOf(OwnProfileStore.instance.displayName, MatrixClientPeg.get()?.getUserId());

/**
 * The Home greeting: the time-of-day phrase (it updates at 05:00, 12:00 and 17:00 while the page stays open) and the first
 * name from the profile (it updates when the profile does). `clock` is injectable for tests.
 */
export function useGreeting(clock: () => Date = systemClock): Greeting {
    const name = useEventEmitterState(OwnProfileStore.instance, UPDATE_EVENT, getOwnName);
    const [hour, setHour] = useState<number>(() => clock().getHours());

    useEffect(() => {
        let timer: number | undefined;
        const schedule = (): void => {
            timer = window.setTimeout(() => {
                setHour(clock().getHours());
                schedule();
            }, msUntilNextDayPart(clock()));
        };
        schedule();
        return () => window.clearTimeout(timer);
    }, [clock]);

    const greeting = greetingForHour(hour);
    return { greeting, name, text: S.greeting(greeting, name) };
}
