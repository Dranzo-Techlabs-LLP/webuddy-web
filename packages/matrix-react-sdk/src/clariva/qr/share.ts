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

export type ShareOutcome =
    /** The system share sheet accepted the link. */
    | "shared"
    /** The user dismissed the share sheet: nothing to report. */
    | "cancelled"
    /** No Web Share API (or it failed): the link is in the clipboard, show "Link copied". */
    | "copied"
    /** Neither sharing nor copying worked. */
    | "failed";

export interface ShareDeps {
    /** `navigator.share` where the browser has it (mobile browsers, Safari, Chrome/Edge on Windows). */
    share?: (data: { title?: string; text?: string }) => Promise<void>;
    /** Clipboard fallback; resolves false on failure. */
    copy(text: string): Promise<boolean>;
}

/**
 * "Share link" (Android: system share sheet with the link as text and the chooser title "Share"): Web Share API when
 * available, otherwise copy the link to the clipboard.
 */
export async function shareText(text: string, title: string, deps: ShareDeps): Promise<ShareOutcome> {
    if (deps.share) {
        try {
            await deps.share({ title, text });
            return "shared";
        } catch (e) {
            if ((e as { name?: string } | null)?.name === "AbortError") return "cancelled";
            // any other failure (NotAllowedError outside a user gesture, no share targets...): fall back to the clipboard
        }
    }
    try {
        return (await deps.copy(text)) ? "copied" : "failed";
    } catch {
        return "failed";
    }
}
