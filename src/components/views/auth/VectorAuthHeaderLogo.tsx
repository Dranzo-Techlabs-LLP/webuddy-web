/*
Copyright 2019-2024 New Vector Ltd.
Copyright 2015, 2016 OpenMarket Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import * as React from "react";
import SdkConfig from "matrix-react-sdk/src/SdkConfig";

export default class VectorAuthHeaderLogo extends React.PureComponent {
    public render(): React.ReactElement {
        const brandingConfig = SdkConfig.getObject("branding");
        // CLARIVA: Clariva mark instead of the stock Element logo; alt text follows the configured brand
        const logoUrl = brandingConfig?.get("auth_header_logo_url") ?? "themes/clariva/img/logos/clariva-logo.svg";

        return (
            <aside className="mx_AuthHeaderLogo">
                <img src={logoUrl} alt={SdkConfig.get().brand || "Clariva"} />
            </aside>
        );
    }
}
