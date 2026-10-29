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

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@vector-im/compound-web";
import { logger } from "matrix-js-sdk/src/logger";

import { type IMatrixClientCreds } from "../../../MatrixClientPeg";
import { type ValidatedServerConfig } from "../../../utils/ValidatedServerConfig";
import Modal from "../../../Modal";
import PlatformPeg from "../../../PlatformPeg";
import ErrorDialog from "../../../components/views/dialogs/ErrorDialog";
import InlineSpinner from "../../../components/views/elements/InlineSpinner";
import { getClarivaConfig } from "../../config";
import { ClarivaHttpError } from "../../api/http";
import { type ClarivaAvailability } from "../../api/types";
import {
    AUTH_STRINGS,
    ClarivaAuthError,
    type ClarivaMatrixCredentials,
    type ClarivaSignedIn,
    clarivaAuth,
    mapAuthError,
} from "../../session/ClarivaAuthService";
import { ClarivaSession } from "../../session/ClarivaSession";
import {
    currentOrigin,
    type GoogleButtonText,
    type GoogleUnavailableReason,
    isDevOrigin,
    isGoogleSignInConfigured,
} from "../../session/googleIdentity";
import { takeLandingNotice } from "../../session/signOutState";
import {
    type Availability,
    type AuthMode,
    AVAILABILITY_DEBOUNCE_MS,
    emailSupportText,
    forgotPasswordPrefill,
    isUsernameWellFormed,
    looksLikeEmail,
    MIN_PASSWORD_LENGTH,
    nameErrorText,
    normalizeUsername,
    signInFailureText,
    submitEnabled,
    usernameSupportText,
} from "../../session/authForm";
import {
    type ConsultantSetupForm,
    EMPTY_CONSULTANT_SETUP,
    isSetupReady,
    maxCreditsValue,
    resumeSetup,
    saveConsultantSetup,
    type SetupSaveFailure,
    setupFailureText,
    setupToSave,
    showSetupFailure,
    skipSetup,
    unsavedSetupFailure,
    withSetupField,
} from "../../session/consultantSetup";
import { WalletStore } from "../../stores/WalletStore";
import { authStrings, DEFAULT_MATRIX_SERVER_NAME } from "../../strings/auth";
import { applyIfscAutofill, type IfscAutofill } from "../../wallet/bankDetails";
import { ifscBlocksSave, useIfscLookup } from "../../wallet/ifsc";
import { ClarivaAurora } from "../../ui";
import { AuthField, PasswordField, SwitchRow } from "./fields";
import { ConsultantSetupFields, SkippedSetup } from "./ConsultantSetupFields";
import { authFooterLinks, displayVersion } from "./authFooter";
import { ClarivaLogo } from "./ClarivaLogo";
import { ClarivaGoogleButton } from "./ClarivaGoogleButton";
import { ClarivaGoogleDevHint, ClarivaGoogleNotice } from "./ClarivaGoogleNotice";
import { ClarivaForgotPasswordDialog } from "./ClarivaForgotPasswordDialog";
import { ClarivaGoogleRoleDialog } from "./ClarivaGoogleRoleDialog";

export interface ClarivaAuthPageProps {
    /** The validated server config MatrixChat passes to its auth views (homeserver + identity server URLs). */
    serverConfig: Pick<ValidatedServerConfig, "hsUrl" | "isUrl" | "hsName">;
    /** `MatrixChat.onUserCompletedLoginFlow`: persists the session and starts the client. */
    onLoggedIn: (credentials: IMatrixClientCreds, password: string) => Promise<void> | void;
    initialMode?: AuthMode;
    openForgotPassword?: boolean;
    /** Prefill for the identifier field (`#/login?defaultUsername=`). */
    defaultIdentifier?: string;
}

interface AvailabilityResult {
    value: string;
    state: Availability;
    reason: string | null;
}

/**
 * Live availability with a 450 ms debounce and cancellation (spec 01 §3.3). The result is keyed by the checked
 * value, so a stale "taken" for what the user typed a moment ago can never block (or flatter) the current value.
 * Any failure (offline, 429, 5xx) is `unknown`, i.e. silent.
 */
function useAvailability(
    check: (value: string, signal: AbortSignal) => Promise<ClarivaAvailability | null>,
    value: string,
    active: boolean,
): { state: Availability; reason: string | null } {
    const [result, setResult] = useState<AvailabilityResult>({ value: "", state: "unknown", reason: null });
    const checkRef = useRef(check);
    checkRef.current = check;

    useEffect(() => {
        if (!active) return;
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            const response = await checkRef.current(value, controller.signal);
            if (controller.signal.aborted) return;
            setResult({
                value,
                state: response === null ? "unknown" : response.available ? "available" : "taken",
                reason: response?.reason ?? null,
            });
        }, AVAILABILITY_DEBOUNCE_MS);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [value, active]);

    if (!active) return { state: "unknown", reason: null };
    if (result.value === value) return { state: result.state, reason: result.reason };
    return { state: "checking", reason: null };
}

function showErrorDialog(description: string): void {
    Modal.createDialog(ErrorDialog, {
        title: authStrings.errorTitle,
        description: <span style={{ whiteSpace: "pre-line" }}>{description || authStrings.errorGeneric}</span>,
        button: authStrings.ok,
    });
}

interface PendingSetupSave {
    result: Promise<SetupSaveFailure>;
    /** A chat rate was asked for (so a saved one must reach the wallet store). */
    savesRate: boolean;
}

/**
 * Start saving the optional consultant setup once the account exists. The JWT is read NOW: `complete()` drops it.
 * Runs alongside opening the session, so it never delays signing in (Android awaits it, bounded, before the import).
 */
function startSetupSave(matrixUserId: string, setup: ConsultantSetupForm | null): PendingSetupSave | null {
    if (!setup) return null;
    return {
        result: saveConsultantSetup({ matrixUserId, jwt: ClarivaSession.instance.jwt, setup }),
        savesRate: maxCreditsValue(setup) !== null,
    };
}

/**
 * After sign-in completed (the client has started): say what the setup did not save, once. A saved chat rate is
 * re-read into the wallet store (Android's `updateMaxCredits` writes its own cache): the store's first read ran
 * alongside the save and may predate it. Twice, because the first call joins a read that may still be in flight.
 */
function reportSetupSave(pending: PendingSetupSave | null): void {
    if (!pending) return;
    void pending.result.then((failure) => {
        showSetupFailure(failure);
        if (pending.savesRate && failure !== "rate" && failure !== "both") {
            const wallet = WalletStore.instance;
            void wallet.refreshBalance().then(() => wallet.refreshBalance());
        }
    });
}

/** The longest foreign (non-API) error text shown to the user; the full error goes to the log. */
const MAX_SHOWN_ERROR_LENGTH = 200;

/**
 * What to tell the user when Google sign-in fails after Google itself succeeded. API failures keep the mapped
 * messages ("Invalid Google credentials", rate limit, offline...). Anything else (opening the Matrix session threw,
 * e.g. IndexedDB or crypto unavailable) shows its own message, like the e-mail path does, rather than being
 * mislabelled as a network problem. That text is not ours, so it is flattened to one line and capped (a stack trace
 * or a long library message does not belong in a dialog); the whole error is logged.
 */
function googleFailureText(e: unknown): string {
    if (e instanceof ClarivaAuthError || e instanceof ClarivaHttpError) return mapAuthError(e, "google").message;
    const text = e instanceof Error ? e.message.replace(/\s+/g, " ").trim() : "";
    if (!text) return authStrings.errorGeneric;
    return text.length > MAX_SHOWN_ERROR_LENGTH ? `${text.slice(0, MAX_SHOWN_ERROR_LENGTH - 1)}…` : text;
}

/**
 * The Clariva landing page: sign in / create account / Google, in one centred card (spec 01 §2.1). Replaces
 * Element's Welcome, Login, Registration and ForgotPassword views whenever `Clariva.enabled`.
 */
export const ClarivaAuthPage: React.FC<ClarivaAuthPageProps> = ({
    serverConfig,
    onLoggedIn,
    initialMode = "signIn",
    openForgotPassword,
    defaultIdentifier,
}) => {
    const [mode, setMode] = useState<AuthMode>(initialMode);
    // Shared by both modes (Android): "Email or username" when signing in, "Email" when signing up.
    const [email, setEmail] = useState(defaultIdentifier ?? "");
    const [password, setPassword] = useState("");
    const [name, setName] = useState("");
    const [username, setUsername] = useState("");
    const [isConsultant, setIsConsultant] = useState(false);
    // Typed values are kept even if the switch goes off, so flipping it back does not lose them; they are only ever
    // saved for a consultant.
    const [setup, setSetup] = useState<ConsultantSetupForm>(EMPTY_CONSULTANT_SETUP);
    // What the last IFSC lookup filled in, so a new IFSC can replace it but never a value the user typed.
    const ifscAutofill = useRef<IfscAutofill | null>(null);
    const [loading, setLoading] = useState(false);
    const [notice, setNotice] = useState<string | null>(() => takeLandingNotice());
    // Why Google's button is missing, once it has been found to be unusable (the form keeps working regardless).
    const [googleProblem, setGoogleProblem] = useState<GoogleUnavailableReason | null>(null);
    const googleConfigured = isGoogleSignInConfigured();
    // Whether "Sign in with Google" can actually be pointed at: configured, and not found broken.
    const googleAvailable = googleConfigured && googleProblem === null;
    // Read by callbacks that outlive the render that created them (a slow password request, a dialog opened earlier).
    const googleAvailableRef = useRef(googleAvailable);
    googleAvailableRef.current = googleAvailable;
    // Set by "Try again" so the button it mounts takes focus (the notice that held it is gone); cleared after each commit.
    const focusGoogleButton = useRef(false);
    const [version, setVersion] = useState<string | null>(null);

    const mounted = useRef(true);
    const inFlight = useRef(false);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    // children's effects (the focus) have run by now: later mounts are not a "Try again"
    useEffect(() => {
        focusGoogleButton.current = false;
    });

    useEffect(() => {
        PlatformPeg.get()
            ?.getAppVersion()
            .then((v) => {
                if (mounted.current) setVersion(v);
            })
            .catch(() => {});
    }, []);

    const serverName =
        getClarivaConfig().matrix_server_name ||
        (serverConfig.hsName && !serverConfig.hsName.includes("/") ? serverConfig.hsName : "") ||
        DEFAULT_MATRIX_SERVER_NAME;

    const usernameAvailability = useAvailability(
        (v, signal) => clarivaAuth.isUsernameAvailable(v, signal),
        normalizeUsername(username),
        mode === "signUp" && isUsernameWellFormed(username),
    );
    const emailAvailability = useAvailability(
        (v, signal) => clarivaAuth.isEmailAvailable(v, signal),
        email.trim(),
        mode === "signUp" && looksLikeEmail(email),
    );

    // Only while the payout fields are on screen: a third-party lookup for a code nobody can see would be wasted.
    const setupShown = mode === "signUp" && isConsultant && !setup.isSkipped;
    const ifscStatus = useIfscLookup(setupShown ? setup.ifscCode : "", (branch) => {
        const found = { bank: branch.bank, branch: branch.branch };
        const previous = ifscAutofill.current;
        setSetup((s) => applyIfscAutofill(s, found, previous));
        ifscAutofill.current = found;
    });

    const canSubmit = submitEnabled({
        mode,
        email,
        password,
        name,
        username,
        usernameAvailability: usernameAvailability.state,
        emailAvailability: emailAvailability.state,
        isLoading: loading,
        isConsultant,
        consultantSetupReady: isSetupReady(setup, ifscBlocksSave(ifscStatus)),
    });

    const release = useCallback((): void => {
        inFlight.current = false;
        if (mounted.current) setLoading(false);
    }, []);

    /** Hand the Matrix session to Element (`Lifecycle.setLoggedIn` via MatrixChat). No Matrix /login, no password. */
    const complete = useCallback(
        async (credentials: ClarivaMatrixCredentials): Promise<void> => {
            ClarivaSession.instance.dropJwt(); // it only existed to mint this session
            if (!serverConfig.hsUrl) throw new ClarivaAuthError("No homeserver is configured.");
            await onLoggedIn(
                {
                    homeserverUrl: serverConfig.hsUrl,
                    identityServerUrl: serverConfig.isUrl || undefined,
                    userId: credentials.matrixUserId,
                    deviceId: credentials.deviceId,
                    accessToken: credentials.accessToken,
                    guest: false,
                },
                "", // the Matrix password does not exist on the client
            );
            // The page unmounts as soon as MatrixChat switches views; until then it stays busy (no second sign-in).
        },
        [onLoggedIn, serverConfig.hsUrl, serverConfig.isUrl],
    );

    /**
     * Sign-up created the account but the session could not be opened: a second "Create account" would 409, so go to
     * sign-in with the e-mail prefilled (spec 01 §7.3 #12). Network-level failures get exactly one automatic retry.
     * The consultant setup typed for this sign-up (`toSave`) is saved once the retry opens the session; when it
     * cannot be, the dialog says what was not saved, so it is never dropped silently.
     */
    const recoverFromHalfSignUp = useCallback(
        async (error: ClarivaAuthError, toSave: ConsultantSetupForm | null): Promise<boolean> => {
            let pending: PendingSetupSave | null = null;
            if (error.status === 0) {
                try {
                    const retried: ClarivaSignedIn = await clarivaAuth.resumeMatrixSession();
                    pending = startSetupSave(retried.credentials.matrixUserId, toSave);
                    await complete(retried.credentials);
                    reportSetupSave(pending);
                    return true;
                } catch (e) {
                    error = mapAuthError(e);
                }
            }
            // A save started before opening the session failed has its own (bounded) answer; otherwise nothing ran.
            const unsaved = pending ? await pending.result : unsavedSetupFailure(toSave);
            if (mounted.current) {
                setMode("signIn");
                setPassword("");
            }
            const lines = [error.message, authStrings.accountCreatedSignIn, setupFailureText(unsaved)];
            showErrorDialog(lines.filter((line): line is string => !!line).join("\n"));
            return false;
        },
        [complete],
    );

    const submit = async (): Promise<void> => {
        if (!canSubmit || inFlight.current) return;
        inFlight.current = true;
        setLoading(true);
        ClarivaSession.instance.clear(); // so "jwt present" below means "this attempt got past step one"
        const signingUp = mode === "signUp";
        // Captured now: only a consultant signing up has anything to save, and only what was typed and not skipped.
        const toSave = signingUp ? setupToSave(isConsultant, setup) : null;
        // Set once the account exists; if opening the session then fails, its outcome still goes into the error.
        let pendingSetup: PendingSetupSave | null = null;
        try {
            const signedIn = signingUp
                ? await clarivaAuth.signUpWithEmail({
                      email,
                      password,
                      name,
                      username: normalizeUsername(username),
                      isConsultant,
                  })
                : await clarivaAuth.signInWithEmail(email, password);
            // The account exists either way, so a failure here never blocks signing in.
            pendingSetup = startSetupSave(signedIn.credentials.matrixUserId, toSave);
            await complete(signedIn.credentials);
            reportSetupSave(pendingSetup);
        } catch (e) {
            logger.warn("Clariva: sign-in failed", e instanceof ClarivaAuthError ? e.status : undefined);
            const error =
                e instanceof ClarivaAuthError ? e : new ClarivaAuthError(e instanceof Error ? e.message : "", 0, e);
            if (signingUp && ClarivaSession.instance.jwt) {
                // the JWT is still held, so `complete()` never ran: the setup was not started yet
                if (await recoverFromHalfSignUp(error, toSave)) return;
            } else {
                // the client did not start, so no toast: what the setup did not save goes into this dialog
                const unsaved = pendingSetup ? await pendingSetup.result : null;
                const lines = [
                    signInFailureText(error.message, error.status, !signingUp, googleAvailableRef.current),
                    setupFailureText(unsaved),
                ];
                showErrorDialog(lines.filter((l): l is string => !!l).join("\n"));
            }
            release();
        }
    };

    /** `renderedText` is the text of the live Google button that delivered the token (Google offers no way to tell which render was pressed). */
    const onGoogleCredential = async (idToken: string, renderedText: GoogleButtonText): Promise<void> => {
        if (inFlight.current) return;
        inFlight.current = true;
        setLoading(true);
        ClarivaSession.instance.clear();
        const startedFromSignUp = renderedText === "signup_with";
        let pendingSetup: PendingSetupSave | null = null;
        try {
            let outcome = await clarivaAuth.signInWithGoogle({
                idToken,
                isConsultant: null,
                isSignUp: startedFromSignUp,
            });
            let toSave: ConsultantSetupForm | null = null;
            if (outcome.kind === "roleRequired") {
                // Two-step: nothing has been created yet. Ask (and, for a consultant, the optional payout step), then
                // repeat WITHOUT `mode: "signup"`.
                const { finished } = Modal.createDialog(
                    ClarivaGoogleRoleDialog,
                    {
                        email: outcome.email,
                        name: outcome.name,
                        fromSignIn: !startedFromSignUp,
                        isExisting: outcome.isExisting,
                        // what was typed on the e-mail form carries over (Android shares one setup state)
                        initialSetup: setup,
                    },
                    undefined,
                    false,
                    false,
                    { onBeforeClose: async (reason) => reason !== "backgroundClick" },
                );
                const [confirmed, consultant, payoutSetup] = await finished;
                if (!confirmed) {
                    release();
                    return;
                }
                toSave = payoutSetup ? setupToSave(!!consultant, payoutSetup) : null;
                outcome = await clarivaAuth.signInWithGoogle({ idToken, isConsultant: !!consultant });
            }
            if (outcome.kind !== "signedIn") throw new ClarivaAuthError(AUTH_STRINGS.roleLoop);
            pendingSetup = startSetupSave(outcome.credentials.matrixUserId, toSave);
            await complete(outcome.credentials);
            reportSetupSave(pendingSetup);
        } catch (e) {
            logger.warn("Clariva: Google sign-in failed", e instanceof ClarivaAuthError ? e.status : e);
            const unsaved = pendingSetup ? await pendingSetup.result : null;
            const lines = [googleFailureText(e), setupFailureText(unsaved)];
            showErrorDialog(lines.filter((l): l is string => !!l).join("\n"));
            release();
        }
    };

    const openForgot = useCallback(async (): Promise<void> => {
        const { finished } = Modal.createDialog(ClarivaForgotPasswordDialog, {
            initialEmail: forgotPasswordPrefill(email),
            // decides which Google hint the code step shows: whether Google is usable on this page right now
            googleAvailable: googleAvailableRef.current,
        });
        const [signInEmail] = await finished;
        if (typeof signInEmail === "string" && mounted.current) {
            // back to sign-in with the address prefilled; the new password is typed fresh
            setMode("signIn");
            setEmail(signInEmail);
            setPassword("");
        }
    }, [email]);

    useEffect(() => {
        if (openForgotPassword) void openForgot();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const toggleMode = (): void => {
        setMode((m) => (m === "signIn" ? "signUp" : "signIn"));
        setNotice(null);
    };

    const signingUp = mode === "signUp";
    const footerLinks = authFooterLinks();
    const shownVersion = displayVersion(version);

    return (
        <div className="mx_ClarivaAuth" data-testid="clariva-auth">
            {/* The signature moment (DESIGN-SYSTEM.md rule 6): the LIVE aurora drifts behind the ONE glass card below, which is
                the only blurred layer on this page (the logo tile, the fields and the notices are opaque or inset tiles). */}
            <ClarivaAurora live />
            <div className="mx_ClarivaAuth_scroll">
                <main className="mx_ClarivaAuth_card">
                    <div className="mx_ClarivaAuth_logoTile">
                        <ClarivaLogo className="mx_ClarivaAuth_logo" />
                    </div>
                    <h1 className="mx_ClarivaAuth_title">{authStrings.welcomeTitle}</h1>
                    <p className="mx_ClarivaAuth_tagline">
                        {authStrings.taglineLine1}
                        <br />
                        {authStrings.taglineLine2}
                    </p>

                    {notice && (
                        <div className="mx_ClarivaAuth_notice" role="status" data-testid="clariva-auth-notice">
                            {notice}
                        </div>
                    )}

                    <form
                        className="mx_ClarivaAuth_form"
                        noValidate
                        onSubmit={(e) => {
                            e.preventDefault();
                            void submit(); // Enter obeys the same predicate as the button (Android's did not)
                        }}
                    >
                        {signingUp && (
                            <>
                                <AuthField
                                    id="mx_ClarivaAuth_name"
                                    label={authStrings.nameLabel}
                                    value={name}
                                    onChange={setName}
                                    placeholder={authStrings.namePlaceholder}
                                    autoComplete="name"
                                    disabled={loading}
                                    support={
                                        nameErrorText(name)
                                            ? { kind: "error", text: nameErrorText(name) as string }
                                            : null
                                    }
                                    testId="clariva-auth-name"
                                />
                                <AuthField
                                    id="mx_ClarivaAuth_username"
                                    label={authStrings.usernameLabel}
                                    value={username}
                                    onChange={setUsername}
                                    placeholder={authStrings.usernamePlaceholder}
                                    autoComplete="username"
                                    identifier
                                    disabled={loading}
                                    support={usernameSupportText(
                                        username,
                                        usernameAvailability.state,
                                        serverName,
                                        usernameAvailability.reason,
                                    )}
                                    testId="clariva-auth-username"
                                />
                            </>
                        )}
                        <AuthField
                            id="mx_ClarivaAuth_email"
                            label={signingUp ? authStrings.emailLabel : authStrings.identifierLabel}
                            type={signingUp ? "email" : "text"}
                            value={email}
                            onChange={setEmail}
                            placeholder={signingUp ? authStrings.emailPlaceholder : authStrings.identifierPlaceholder}
                            autoComplete={signingUp ? "email" : "username"}
                            identifier
                            disabled={loading}
                            autoFocus={!signingUp}
                            support={signingUp ? emailSupportText(emailAvailability.state) : null}
                            testId="clariva-auth-email"
                        />
                        <PasswordField
                            id="mx_ClarivaAuth_password"
                            label={authStrings.passwordLabel}
                            value={password}
                            onChange={setPassword}
                            placeholder={signingUp ? authStrings.passwordHint(MIN_PASSWORD_LENGTH) : undefined}
                            autoComplete={signingUp ? "new-password" : "current-password"}
                            disabled={loading}
                            testId="clariva-auth-password"
                        />
                        {!signingUp && (
                            <div className="mx_ClarivaAuth_forgotRow">
                                <button
                                    type="button"
                                    className="mx_ClarivaAuth_linkButton mx_Dialog_nonDialogButton"
                                    onClick={() => void openForgot()}
                                    disabled={loading}
                                    data-testid="clariva-auth-forgot-password"
                                >
                                    {authStrings.forgotPassword}
                                </button>
                            </div>
                        )}
                        {signingUp && (
                            // The switch and, only once it is on, the optional payout setup: one group, so the setup
                            // reads as part of that choice rather than as more mandatory sign-up fields.
                            <div className="mx_ClarivaSetup">
                                <SwitchRow
                                    id="mx_ClarivaAuth_consultant"
                                    title={authStrings.consultantTitle}
                                    subtitle={authStrings.consultantSubtitle}
                                    checked={isConsultant}
                                    onChange={setIsConsultant}
                                    disabled={loading}
                                    testId="clariva-auth-consultant"
                                />
                                {isConsultant && (
                                    <div className="mx_ClarivaSetup_panel">
                                        {setup.isSkipped ? (
                                            <SkippedSetup
                                                disabled={loading}
                                                onResume={() => setSetup((s) => resumeSetup(s))}
                                            />
                                        ) : (
                                            <ConsultantSetupFields
                                                idPrefix="mx_ClarivaAuth_setup"
                                                setup={setup}
                                                onChange={(field, value) =>
                                                    setSetup((s) => withSetupField(s, field, value))
                                                }
                                                ifscStatus={ifscStatus}
                                                disabled={loading}
                                                holderNameHint={name}
                                                onSkip={() => {
                                                    ifscAutofill.current = null;
                                                    setSetup(skipSetup());
                                                }}
                                            />
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        <Button
                            type="submit"
                            kind="primary"
                            size="lg"
                            className="mx_ClarivaAuth_submit"
                            disabled={!canSubmit}
                            data-testid="clariva-auth-submit"
                        >
                            {loading ? <InlineSpinner /> : null}
                            {signingUp ? authStrings.createAccount : authStrings.signIn}
                        </Button>
                    </form>

                    {googleConfigured && (
                        <>
                            <div className="mx_ClarivaAuth_or" aria-hidden>
                                {authStrings.or}
                            </div>
                            {googleProblem === null ? (
                                <>
                                    <ClarivaGoogleButton
                                        text={signingUp ? "signup_with" : "signin_with"}
                                        onCredential={(token, renderedText) =>
                                            void onGoogleCredential(token, renderedText)
                                        }
                                        disabled={loading}
                                        onUnavailable={setGoogleProblem}
                                        autoFocus={focusGoogleButton.current}
                                        testId="clariva-auth-google"
                                    />
                                    {isDevOrigin(currentOrigin()) && <ClarivaGoogleDevHint />}
                                </>
                            ) : (
                                <ClarivaGoogleNotice
                                    reason={googleProblem}
                                    context={mode}
                                    // clearing the problem remounts the button, which loads the Google script afresh
                                    onRetry={() => {
                                        focusGoogleButton.current = true;
                                        setGoogleProblem(null);
                                    }}
                                    testId="clariva-auth-google-notice"
                                />
                            )}
                        </>
                    )}

                    <button
                        type="button"
                        className="mx_ClarivaAuth_toggle mx_Dialog_nonDialogButton"
                        onClick={toggleMode}
                        disabled={loading}
                        data-testid="clariva-auth-toggle-mode"
                    >
                        {signingUp ? authStrings.haveAccount : authStrings.noAccount}
                    </button>

                    {(footerLinks.length > 0 || shownVersion) && (
                        <footer className="mx_ClarivaAuth_footer">
                            {footerLinks.length > 0 && (
                                <nav aria-label={authStrings.legalNavLabel}>
                                    <ul className="mx_ClarivaAuth_legal">
                                        {footerLinks.map((link) => (
                                            <li key={link.url}>
                                                <a href={link.url} target="_blank" rel="noreferrer noopener">
                                                    {link.text}
                                                </a>
                                            </li>
                                        ))}
                                    </ul>
                                </nav>
                            )}
                            {shownVersion && (
                                <div className="mx_ClarivaAuth_version">{authStrings.version(shownVersion)}</div>
                            )}
                        </footer>
                    )}
                </main>
            </div>
        </div>
    );
};

export default ClarivaAuthPage;
