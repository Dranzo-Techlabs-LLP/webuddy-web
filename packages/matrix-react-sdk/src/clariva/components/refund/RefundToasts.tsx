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

import React, { type ReactElement, useEffect, useState } from "react";
import classNames from "classnames";

import { RefundControllerEvent, type RefundController, type RefundToast } from "../../refund/RefundController";

/** Default Material3 snackbars stay about this long (spec 03 U7). */
export const REFUND_TOAST_DURATION_MS = 4000;

/**
 * Queue of chat-local toasts (spec 03 U7): shown one after another, only while the room view that owns the
 * controller is mounted. They are deliberately NOT pushed onto Element's global ToastStore: the global queue would
 * leak "Refund approved" onto the room list when the user navigates away quickly (lesson L11).
 */
export function useRefundToast(controller: RefundController | null): RefundToast | null {
    const [queue, setQueue] = useState<RefundToast[]>([]);
    const [current, setCurrent] = useState<RefundToast | null>(null);

    useEffect(() => {
        setQueue([]);
        setCurrent(null);
        if (!controller) return;
        const onToast = (toast: RefundToast): void => setQueue((q) => [...q, toast]);
        controller.on(RefundControllerEvent.Toast, onToast);
        return () => {
            controller.off(RefundControllerEvent.Toast, onToast);
        };
    }, [controller]);

    // Promote the next queued toast once the current one is gone.
    useEffect(() => {
        if (current || queue.length === 0) return;
        setCurrent(queue[0]);
        setQueue((q) => q.slice(1));
    }, [current, queue]);

    // Auto-dismiss the current toast.
    useEffect(() => {
        if (!current) return;
        const timer = setTimeout(() => setCurrent(null), REFUND_TOAST_DURATION_MS);
        return () => clearTimeout(timer);
    }, [current]);

    return current;
}

/** Renders the current toast as a small transient strip inside the room view (zero layout height: it overlays). */
export function RefundToasts({ controller }: { controller: RefundController | null }): ReactElement {
    const toast = useRefundToast(controller);
    return (
        <div className="mx_ClarivaRefundToasts" role="status" aria-live="polite">
            {toast && (
                <div
                    key={toast.id}
                    className={classNames("mx_ClarivaRefundToast", {
                        mx_ClarivaRefundToast_error: toast.kind === "error",
                    })}
                >
                    {toast.text}
                </div>
            )}
        </div>
    );
}
