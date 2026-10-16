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

/** How often the title alternates between the plain and the "incoming call" form. */
export const TITLE_FLASH_INTERVAL_MS = 1000;

/** Does the user ask for less motion (OS setting)? A blinking title counts: it is a flashing UI element. */
export function prefersReducedMotion(): boolean {
    try {
        return typeof window !== "undefined" && typeof window.matchMedia === "function"
            ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
            : false;
    } catch {
        return false;
    }
}

/**
 * Flashes the page title ("(Incoming call) <title>" <-> "<title>") while a call is ringing, so a ring is noticeable
 * from another tab or window even when the ringtone is blocked and browser notifications are off.
 *
 * Element rewrites `document.title` itself (unread counts, room name), also while this runs. The flasher therefore
 * never remembers "the title from when the ring started": it tracks the last title that WE did not write (checked on
 * every tick and again in `stop()`), and `stop()` writes exactly that one back.
 *
 * With `prefers-reduced-motion` the title does not alternate: it keeps the "(Incoming call) " prefix for as long as the
 * ring lasts (the tick then only puts the prefix back if Element rewrote the title without it).
 */
export class TitleFlasher {
    private base = "";
    /** `document.title` as read back right after our last write (the getter normalises whitespace). */
    private lastWritten: string | null = null;
    private showing = false;
    private timer: ReturnType<typeof setInterval> | undefined;

    /**
     * @param prefix - what to put in front of the title while flashing, e.g. `"(Incoming call) "`
     * @param intervalMs - how fast to alternate
     * @param reducedMotion - is the user asking for less motion? Read on every tick, so a change is picked up at once
     */
    public constructor(
        private readonly prefix: () => string,
        private readonly intervalMs: number = TITLE_FLASH_INTERVAL_MS,
        private readonly reducedMotion: () => boolean = prefersReducedMotion,
    ) {}

    public get active(): boolean {
        return this.timer !== undefined;
    }

    public start(): void {
        if (this.active || typeof document === "undefined") return;
        this.base = document.title;
        this.lastWritten = null;
        this.showing = true;
        this.write(this.prefix() + this.base);
        this.timer = setInterval(() => this.tick(), this.intervalMs);
    }

    /** Stop flashing and put the last title Element set back, unprefixed. A no-op when not flashing. */
    public stop(): void {
        if (!this.active) return;
        clearInterval(this.timer);
        this.timer = undefined;
        this.adoptForeignTitle();
        this.write(this.base);
        this.lastWritten = null;
        this.showing = false;
    }

    private tick(): void {
        this.adoptForeignTitle();
        this.showing = this.reducedMotion() ? true : !this.showing;
        this.write(this.showing ? this.prefix() + this.base : this.base);
    }

    /** If someone else changed the title since our last write, that is the new real title. */
    private adoptForeignTitle(): void {
        const current = document.title;
        if (this.lastWritten !== null && current !== this.lastWritten) this.base = current;
    }

    private write(title: string): void {
        if (document.title !== title) document.title = title;
        this.lastWritten = document.title;
    }
}
