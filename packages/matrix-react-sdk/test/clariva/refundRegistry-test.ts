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

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { acquireRefundController, resetRefundControllersForTests } from "../../src/clariva/refund/registry";
import { WalletStore } from "../../src/clariva/stores/WalletStore";
import { CONSULTANT, ME, configureClariva, installFakeApi, mockResponse, walletUser } from "./helpers";

const ROOM = "!dm:clarivahub.com";
const enc = encodeURIComponent;

const flush = async (rounds = 80): Promise<void> => {
    for (let i = 0; i < rounds; i++) await Promise.resolve();
};

const liveHold = {
    exists: true,
    pendingHoldId: 17,
    refund_status: "none",
    clientId: ME,
    consultantId: CONSULTANT,
    amount: 50,
    refundRequestId: null,
    pendingAutoApprovalNotification: null,
};

describe("refund controller registry + real dependencies", () => {
    let client: { getSafeUserId: jest.Mock; sendMessage: jest.Mock };

    beforeEach(() => {
        jest.useFakeTimers();
        configureClariva();
        WalletStore.resetForTests();
        resetRefundControllersForTests();
        client = {
            getSafeUserId: jest.fn().mockReturnValue(ME),
            sendMessage: jest.fn().mockResolvedValue({ event_id: "$e" }),
        };
    });

    afterEach(() => {
        resetRefundControllersForTests();
        WalletStore.resetForTests();
        jest.useRealTimers();
    });

    const acquire = (): ReturnType<typeof acquireRefundController> =>
        acquireRefundController(client as unknown as MatrixClient, ROOM, CONSULTANT);

    it("shares ONE controller (one poll) between all holders and stops with the last release", async () => {
        const fetchMock = installFakeApi({
            "GET /v1/pending-holds/status": () => mockResponse(200, liveHold),
            [`GET /v1/users/${enc(CONSULTANT)}`]: () =>
                mockResponse(200, walletUser({ Webuddy_name: CONSULTANT, isConsultant: 1 })),
        });
        const statusCalls = (): number =>
            fetchMock.mock.calls.filter(([url]) => String(url).includes("/v1/pending-holds/status")).length;

        const header = acquire();
        const banner = acquire();
        expect(banner.controller).toBe(header.controller);
        await flush();
        expect(statusCalls()).toBe(1);

        // the status request is for (me, peer)
        const url = new URL(String(fetchMock.mock.calls.find(([u]) => String(u).includes("/status"))![0]));
        expect(url.searchParams.get("clientId")).toBe(ME);
        expect(url.searchParams.get("consultantId")).toBe(CONSULTANT);

        header.release();
        header.release(); // idempotent: must not steal the banner's reference
        jest.advanceTimersByTime(15_000);
        await flush();
        expect(statusCalls()).toBe(2); // still polling for the banner

        banner.release();
        jest.advanceTimersByTime(60_000);
        await flush();
        expect(statusCalls()).toBe(2); // the last release cancelled the poll

        // a new holder gets a FRESH controller
        const again = acquire();
        expect(again.controller).not.toBe(header.controller);
        again.release();
    });

    it("applies decision D5 with the real wallet lookup: a non-consultant payee hides the refund UI", async () => {
        installFakeApi({
            "GET /v1/pending-holds/status": () => mockResponse(200, liveHold),
            [`GET /v1/users/${enc(CONSULTANT)}`]: () =>
                mockResponse(200, walletUser({ Webuddy_name: CONSULTANT, isConsultant: 0 })),
        });
        const holder = acquire();
        await flush();
        expect(holder.controller.state.isRefundButtonVisible).toBe(false);
        holder.release();
    });

    it("announces through client.sendMessage(roomId, content) in the main timeline (no composer, no thread)", async () => {
        installFakeApi({
            "GET /v1/pending-holds/status": () => mockResponse(200, liveHold),
            [`GET /v1/users/${enc(CONSULTANT)}`]: () =>
                mockResponse(200, walletUser({ Webuddy_name: CONSULTANT, isConsultant: 1 })),
            "POST /v1/refund/request": (_url, init) => {
                expect(JSON.parse(String(init.body))).toEqual({
                    clientId: ME,
                    consultantId: CONSULTANT,
                    pendingHoldId: "17",
                });
                return mockResponse(201, { message: "Refund requested successfully", refundRequestId: 9 });
            },
        });
        const holder = acquire();
        await flush();
        const result = await holder.controller.requestRefund();
        expect(result).toEqual({ ok: true, message: "Refund request sent" });

        expect(client.sendMessage).toHaveBeenCalledTimes(1);
        // exactly two arguments: (roomId, content) -> the main timeline, not a thread
        expect(client.sendMessage.mock.calls[0]).toEqual([
            ROOM,
            {
                "msgtype": "m.text",
                "body": "Refund requested for the held credits",
                "m.mentions": {},
                "com.clariva.refund": { event: "requested", refund_request_id: 9 },
            },
        ]);
        holder.release();
    });

    it("approve/reject refresh the consultant's list pills through the wallet store", async () => {
        const consultant = "@rao:clarivahub.com";
        client.getSafeUserId.mockReturnValue(consultant);
        const pillCalls = jest.fn(() => mockResponse(200, { clientIds: [] }));
        installFakeApi({
            [`GET /v1/users/${enc(consultant)}`]: () =>
                mockResponse(200, walletUser({ Webuddy_name: consultant, isConsultant: 1 })),
            "GET /v1/pending-holds/status": () =>
                mockResponse(200, {
                    ...liveHold,
                    clientId: ME,
                    consultantId: consultant,
                    refund_status: "requested",
                    refundRequestId: 9,
                }),
            "POST /v1/refund/reject": () => mockResponse(201, { message: "Refund rejected" }),
            "GET /v1/refund/pending-for-consultant": pillCalls,
        });
        WalletStore.instance.start(consultant);
        await flush();
        pillCalls.mockClear();

        const holder = acquireRefundController(client as unknown as MatrixClient, ROOM, ME);
        await flush();
        expect(holder.controller.state.isConsultantInThisRoom).toBe(true);
        expect((await holder.controller.reject()).ok).toBe(true);
        await flush();
        expect(pillCalls).toHaveBeenCalledTimes(1);
        holder.release();
    });
});
