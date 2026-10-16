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

import {
    REFUND_BODY_APPROVED_FULL,
    REFUND_BODY_AUTO_APPROVED,
    REFUND_BODY_REJECTED,
    REFUND_BODY_REQUESTED,
    buildRefundMessage,
    refundBodyApprovedPartial,
    toRefundRequestId,
} from "../../src/clariva/refund/messages";
import { shouldShowRefundPill } from "../../src/clariva/refund/pill";
import { chatStrings } from "../../src/clariva/strings/chat";
import { CLIENT, CONSULTANT } from "./helpers";

describe("refund Matrix announcements (spec 03 §5.1)", () => {
    it("bodies are the exact Android texts (U+2014 EM DASH, no emoji prefix)", () => {
        expect(REFUND_BODY_REQUESTED).toBe("Refund requested for the held credits");
        expect(REFUND_BODY_APPROVED_FULL).toBe("Your refund was approved — credits returned to your wallet");
        expect(REFUND_BODY_REJECTED).toBe("Your refund was rejected by the consultant");
        expect(REFUND_BODY_AUTO_APPROVED).toBe(
            "Refund auto-approved after 24h with no response — credits returned to the client",
        );
        // the dash really is an em dash, not a hyphen or an en dash
        expect(REFUND_BODY_APPROVED_FULL.charCodeAt(REFUND_BODY_APPROVED_FULL.indexOf("—"))).toBe(0x2014);
        expect(REFUND_BODY_APPROVED_FULL).not.toMatch(/ - /);
    });

    it("the partial wording states the amount: integer if whole, otherwise the plain decimal", () => {
        expect(refundBodyApprovedPartial(20)).toBe("Your refund was approved — 20 credits returned to your wallet");
        expect(refundBodyApprovedPartial(12.5)).toBe("Your refund was approved — 12.5 credits returned to your wallet");
        expect(refundBodyApprovedPartial(0.1 + 0.2)).toBe(
            "Your refund was approved — 0.3 credits returned to your wallet",
        );
    });

    it("content is a plain m.text (NEVER m.notice) with empty m.mentions and the machine-readable marker", () => {
        expect(buildRefundMessage("approved", REFUND_BODY_APPROVED_FULL, 9)).toEqual({
            "msgtype": "m.text",
            "body": "Your refund was approved — credits returned to your wallet",
            "m.mentions": {},
            "com.clariva.refund": { event: "approved", refund_request_id: 9 },
        });
        expect(buildRefundMessage("rejected", REFUND_BODY_REJECTED, 9).msgtype).not.toBe("m.notice");
    });

    it("refund_request_id is a number and is omitted when unknown", () => {
        expect(buildRefundMessage("requested", REFUND_BODY_REQUESTED, "12")["com.clariva.refund"]).toEqual({
            event: "requested",
            refund_request_id: 12,
        });
        expect(buildRefundMessage("requested", REFUND_BODY_REQUESTED)["com.clariva.refund"]).toEqual({
            event: "requested",
        });
        expect(buildRefundMessage("requested", REFUND_BODY_REQUESTED, null)["com.clariva.refund"]).toEqual({
            event: "requested",
        });
        expect(toRefundRequestId("not-a-number")).toBeUndefined();
        expect(toRefundRequestId("")).toBeUndefined();
        expect(toRefundRequestId(0)).toBe(0);
    });
});

describe("refund UI strings (spec 03 Appendix A)", () => {
    it("are verbatim", () => {
        expect(chatStrings.refundRequestButton).toBe("Request refund");
        expect(chatStrings.refundConfirmTitle).toBe("Request Refund");
        expect(chatStrings.refundConfirmBody).toBe("Are you sure you want to request a refund?");
        expect(chatStrings.refundConfirmSubmit).toBe("Request");
        expect(chatStrings.refundBannerTitle).toBe("Refund request");
        expect(chatStrings.refundBannerBody).toBe(
            "The client has asked for a refund. Approve to return the held amount (in full or in part) immediately, or reject to keep the funds (transferred at the end of the hold window).",
        );
        expect(chatStrings.refundApproveDialogTitle).toBe("Approve Refund");
        expect(chatStrings.refundFullOptionWithHeld("50")).toBe("Full refund (₹50)");
        expect(chatStrings.refundFullOption).toBe("Full refund");
        expect(chatStrings.refundPartialOption).toBe("Partial refund");
        expect(chatStrings.refundFullHelper).toBe("The full held amount will be returned to the client immediately.");
        expect(chatStrings.refundAmountLabel).toBe("Refund amount");
        expect(chatStrings.refundRejectTitle).toBe("Reject Refund");
        expect(chatStrings.refundRejectBody).toBe(
            "The held amount will transfer to your wallet at the end of the hold window.",
        );
        expect(chatStrings.refundToastRequested).toBe("Refund request sent");
        expect(chatStrings.refundToastApproved).toBe("Refund approved");
        expect(chatStrings.refundToastRejected).toBe("Refund rejected");
        expect(chatStrings.refundToastError).toBe("Error");
        expect(chatStrings.refundPill).toBe("Refund");
    });
});

describe("chat-list Refund pill visibility (spec 03 U8)", () => {
    const pending = new Set([CLIENT]);

    it("shows for a confirmed consultant whose 1:1 peer has an open request", () => {
        expect(shouldShowRefundPill({ isConsultant: true, peerId: CLIENT, pendingClients: pending })).toBe(true);
    });

    it("hides for a client, and for an unknown role", () => {
        expect(shouldShowRefundPill({ isConsultant: false, peerId: CLIENT, pendingClients: pending })).toBe(false);
        expect(shouldShowRefundPill({ isConsultant: null, peerId: CLIENT, pendingClients: pending })).toBe(false);
    });

    it("hides when the row is not a 1:1 chat (no peer) or the peer has no open request", () => {
        expect(shouldShowRefundPill({ isConsultant: true, peerId: null, pendingClients: pending })).toBe(false);
        expect(shouldShowRefundPill({ isConsultant: true, peerId: CONSULTANT, pendingClients: pending })).toBe(false);
        expect(shouldShowRefundPill({ isConsultant: true, peerId: CLIENT, pendingClients: new Set() })).toBe(false);
    });
});
