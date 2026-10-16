/*
Copyright 2022 The Matrix.org Foundation C.I.C.
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

import * as React from "react";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import SdkConfig from "matrix-react-sdk/src/SdkConfig";

import VectorAuthPage from "../../../../../src/components/views/auth/VectorAuthPage";
import { setupLanguageMock } from "../../../../setup/setupLanguage";

describe("<VectorAuthPage />", () => {
    beforeEach(() => {
        setupLanguageMock();
        SdkConfig.reset();
        // the background url is cached in a static so it cannot change without a reload; forget it between tests
        (VectorAuthPage as any).welcomeBackgroundUrl = undefined;
    });

    afterEach(() => {
        SdkConfig.reset();
        (VectorAuthPage as any).welcomeBackgroundUrl = undefined;
    });

    it("should match snapshot", () => {
        const { asFragment } = render(<VectorAuthPage />);
        expect(asFragment()).toMatchSnapshot();
    });

    // CLARIVA: without a configured image the page background is the Clariva gradient (CSS class, no inline style)
    it("uses the Clariva gradient class when no background image is configured", () => {
        const { container } = render(<VectorAuthPage />);
        const page = container.querySelector<HTMLElement>(".mx_AuthPage")!;
        expect(page.classList.contains("mx_AuthPage_clariva")).toBe(true);
        expect(page.getAttribute("style")).toBeNull();
    });

    it("keeps supporting a configured background image", () => {
        SdkConfig.add({ branding: { welcome_background_url: "themes/custom/bg.jpg" } });
        // jsdom's CSSOM drops the `center/cover fixed url()` shorthand, so inspect the serialised markup instead
        const html = renderToStaticMarkup(<VectorAuthPage />);
        expect(html).toContain('class="mx_AuthPage"');
        expect(html).not.toContain("mx_AuthPage_clariva");
        expect(html.match(/url\(themes\/custom\/bg\.jpg\)/g)).toHaveLength(2); // the page and its frosted-glass copy
    });
});
