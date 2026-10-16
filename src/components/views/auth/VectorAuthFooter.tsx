/*
Copyright 2019-2024 New Vector Ltd.
Copyright 2015, 2016 OpenMarket Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import React, { ReactElement } from "react";
import SdkConfig from "matrix-react-sdk/src/SdkConfig";

import { _t } from "../../../languageHandler";

const VectorAuthFooter = (): ReactElement => {
    const brandingConfig = SdkConfig.getObject("branding");
    // CLARIVA: legal links instead of the stock Element blog / Twitter / GitHub links
    const links = brandingConfig?.get("auth_footer_links") ?? [
        { text: "Privacy", url: "https://clarivahub.com/privacy.html" },
        { text: "Terms", url: "https://clarivahub.com/terms.html" },
    ];

    const authFooterLinks: JSX.Element[] = [];
    for (const linkEntry of links) {
        authFooterLinks.push(
            <a href={linkEntry.url} key={linkEntry.text} target="_blank" rel="noreferrer noopener">
                {linkEntry.text}
            </a>,
        );
    }

    return (
        <footer className="mx_AuthFooter" role="contentinfo">
            {authFooterLinks}
            {/* CLARIVA: kept on purpose - attribution for the Matrix protocol (see docs/clariva/DEPLOY.md, licence note) */}
            <a href="https://matrix.org" target="_blank" rel="noreferrer noopener">
                {_t("powered_by_matrix")}
            </a>
        </footer>
    );
};

export default VectorAuthFooter;
