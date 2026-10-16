/*
Copyright 2019-2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import * as React from "react";
import SdkConfig from "matrix-react-sdk/src/SdkConfig";

import VectorAuthFooter from "./VectorAuthFooter";

export default class VectorAuthPage extends React.PureComponent {
    // CLARIVA: `null` = no configured image, use the Clariva gradient (res/css/clariva/_brand.pcss)
    private static welcomeBackgroundUrl?: string | null;

    // cache the url as a static to prevent it changing without refreshing
    private static getWelcomeBackgroundUrl(): string | null {
        if (VectorAuthPage.welcomeBackgroundUrl !== undefined) return VectorAuthPage.welcomeBackgroundUrl;

        const brandingConfig = SdkConfig.getObject("branding");
        VectorAuthPage.welcomeBackgroundUrl = null;

        const configuredUrl = brandingConfig?.get("welcome_background_url");
        if (configuredUrl) {
            if (Array.isArray(configuredUrl)) {
                const index = Math.floor(Math.random() * configuredUrl.length);
                VectorAuthPage.welcomeBackgroundUrl = configuredUrl[index];
            } else {
                VectorAuthPage.welcomeBackgroundUrl = configuredUrl;
            }
        }

        return VectorAuthPage.welcomeBackgroundUrl;
    }

    public render(): React.ReactElement {
        const backgroundUrl = VectorAuthPage.getWelcomeBackgroundUrl();
        // CLARIVA: with no configured image the page background (and its frosted-glass copy) comes from the
        // `mx_AuthPage_clariva` CSS gradient, so there is no inline `background` at all
        const pageStyle: { background?: string } = backgroundUrl
            ? { background: `center/cover fixed url(${backgroundUrl})` }
            : {};

        const modalStyle: React.CSSProperties = {
            position: "relative",
            background: "initial",
        };

        const blurStyle: React.CSSProperties = {
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            filter: "blur(40px)",
            ...(pageStyle.background ? { background: pageStyle.background } : {}),
        };

        const modalContentStyle: React.CSSProperties = {
            display: "flex",
            zIndex: 1,
            background: "rgba(255, 255, 255, 0.59)",
            borderRadius: "8px",
        };

        return (
            <div className={backgroundUrl ? "mx_AuthPage" : "mx_AuthPage mx_AuthPage_clariva"} style={pageStyle}>
                <div className="mx_AuthPage_modal" style={modalStyle}>
                    <div className="mx_AuthPage_modalBlur" style={blurStyle} />
                    <div className="mx_AuthPage_modalContent" style={modalContentStyle}>
                        {this.props.children}
                    </div>
                </div>
                <VectorAuthFooter />
            </div>
        );
    }
}
