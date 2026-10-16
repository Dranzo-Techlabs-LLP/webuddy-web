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

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Toast } from "@vector-im/compound-web";
import ShareIcon from "@vector-im/compound-design-tokens/assets/web/icons/share";

import BaseDialog from "../../../components/views/dialogs/BaseDialog";
import BaseAvatar from "../../../components/views/avatars/BaseAvatar";
import AccessibleButton from "../../../components/views/elements/AccessibleButton";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { OwnProfileStore } from "../../../stores/OwnProfileStore";
import { ToastContext, useActiveToast, type ToastRack } from "../../../contexts/ToastContext";
import { copyPlaintext } from "../../../utils/strings";
import { qrStrings } from "../../strings/qr";
import { getUserShareLink } from "../../qr/links";
import { qrSvgDataUri } from "../../qr/qrMatrix";
import { shareText } from "../../qr/share";

/** Pixel size of the QR image (Android: 220 dp). */
const QR_SIZE_PX = 220;
const TOAST_MS = 2500;

interface Props {
    onFinished(): void;
}

/** The QR image (or the "QR code is not available." fallback when there is no payload / it cannot be encoded). */
export function MyQrImage({ link }: { link: string | null }): JSX.Element {
    const src = useMemo(() => {
        if (!link) return null;
        try {
            return qrSvgDataUri(link);
        } catch {
            return null; // payload too long for a QR code
        }
    }, [link]);

    if (!src) {
        return (
            <p className="mx_ClarivaMyQr_unavailable" role="alert">
                {qrStrings.qrNotAvailable}
            </p>
        );
    }
    return (
        <img
            className="mx_ClarivaMyQr_code"
            src={src}
            alt={qrStrings.myQrCode}
            width={QR_SIZE_PX}
            height={QR_SIZE_PX}
            draggable={false}
            data-testid="clariva-my-qr-image"
        />
    );
}

function MyQrBody({ link, onShare }: { link: string | null; onShare(): void }): JSX.Element {
    const cli = MatrixClientPeg.get();
    const userId = cli?.getUserId() ?? "";
    const profileName = OwnProfileStore.instance.displayName;
    const hasDisplayName = !!profileName && profileName !== userId;
    const name = hasDisplayName ? profileName : userId;
    const avatarUrl = OwnProfileStore.instance.getHttpAvatarUrl(96);

    return (
        <div className="mx_ClarivaMyQr_body">
            <div className="mx_ClarivaMyQr_header">
                <BaseAvatar url={avatarUrl} name={name ?? userId} idName={userId} size="48px" />
                <div className="mx_ClarivaMyQr_names">
                    <span className="mx_ClarivaMyQr_name">{name}</span>
                    {hasDisplayName && <span className="mx_ClarivaMyQr_userId">{userId}</span>}
                </div>
            </div>
            <div className="mx_ClarivaMyQr_codeFrame">
                <MyQrImage link={link} />
            </div>
            <AccessibleButton
                kind="primary"
                className="mx_ClarivaMyQr_share"
                onClick={onShare}
                disabled={!link}
                data-testid="clariva-share-link"
            >
                <ShareIcon aria-hidden="true" className="mx_ClarivaMyQr_shareIcon" />
                {qrStrings.shareLink}
            </AccessibleButton>
        </div>
    );
}

/**
 * Settings -> "My QR code" (spec 04 §2.10). Shows a QR of `<user_link_base><encoded mxid>` and a "Share link" button
 * that uses the Web Share API where the browser has it and falls back to copying the link (with a toast).
 */
export function MyQrCodeDialog({ onFinished }: Props): JSX.Element {
    const [activeToast, toastRack] = useActiveToast();
    const toastTimer = useRef<number | undefined>();
    const userId = MatrixClientPeg.get()?.getUserId() ?? null;
    const link = useMemo(() => (userId ? getUserShareLink(userId) : null), [userId]);

    useEffect(() => () => window.clearTimeout(toastTimer.current), []);

    const showToast = useCallback(
        (text: string, rack: ToastRack) => {
            window.clearTimeout(toastTimer.current);
            const remove = rack.displayToast(<span role="status">{text}</span>);
            toastTimer.current = window.setTimeout(remove, TOAST_MS);
        },
        [toastTimer],
    );

    const onShare = useCallback(async (): Promise<void> => {
        if (!link) return;
        const outcome = await shareText(link, qrStrings.share, {
            share: typeof navigator !== "undefined" ? navigator.share?.bind(navigator) : undefined,
            copy: copyPlaintext,
        });
        if (outcome === "copied") showToast(qrStrings.linkCopied, toastRack);
        else if (outcome === "failed") showToast(qrStrings.linkCopyFailed, toastRack);
    }, [link, showToast, toastRack]);

    return (
        <BaseDialog
            className="mx_ClarivaMyQrDialog"
            title={qrStrings.myQrCode}
            onFinished={onFinished}
            fixedWidth={false}
            hasCancel={true}
        >
            <ToastContext.Provider value={toastRack}>
                <MyQrBody link={link} onShare={onShare} />
                <div className="mx_ClarivaMyQr_toast">{activeToast && <Toast>{activeToast}</Toast>}</div>
            </ToastContext.Provider>
        </BaseDialog>
    );
}
