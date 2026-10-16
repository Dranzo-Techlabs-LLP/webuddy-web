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

import { useEffect, useRef, useState } from "react";

import { RechargeFlow } from "../wallet/rechargeFlow";
import { type RechargeState } from "../wallet/rechargeMachine";

/**
 * One `RechargeFlow` per mounted recharge UI. The flow outlives the component's renders (it is created once) and is
 * disposed on unmount: a verification already in flight still completes, background ledger polling stops.
 */
export function useRecharge(factory?: () => RechargeFlow): { flow: RechargeFlow; state: RechargeState } {
    const flowRef = useRef<RechargeFlow>();
    if (!flowRef.current) flowRef.current = factory ? factory() : new RechargeFlow();
    const flow = flowRef.current;

    const [state, setState] = useState<RechargeState>(flow.state);
    useEffect(() => {
        const unsubscribe = flow.subscribe(setState);
        setState(flow.state); // anything that changed between render and subscription
        return () => {
            unsubscribe();
            flow.dispose();
        };
    }, [flow]);

    return { flow, state };
}
