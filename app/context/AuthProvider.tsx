import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, AppState, Linking } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../lib/supabase";
import { navigationRef } from "../navigation/navigationRef";
import { CommonActions } from "@react-navigation/native";
import { registerAndSavePushToken } from "../lib/registerAndSavePushToken";

type MinimalProfile = {
  id: string;
  full_name: string | null;
  main_role_id: string | number | null;
  city_id: string | number | null;
};

type AuthContextType = {
  ready: boolean;
  userId: string | null;
  profile: MinimalProfile | null;
  profileComplete: boolean;
  shouldRouteToCreateProfile: boolean;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  ready: false,
  userId: null,
  profile: null,
  profileComplete: false,
  shouldRouteToCreateProfile: false,
  refreshProfile: async () => {},
});

const G = globalThis as any;

if (typeof G.__OVERLOOKED_RECOVERY__ === "undefined") {
  G.__OVERLOOKED_RECOVERY__ = false;
}

if (typeof G.__OVERLOOKED_EMAIL_CONFIRM__ === "undefined") {
  G.__OVERLOOKED_EMAIL_CONFIRM__ = false;
}

if (typeof G.__OVERLOOKED_FORCE_NEW_PASSWORD__ === "undefined") {
  G.__OVERLOOKED_FORCE_NEW_PASSWORD__ = false;
}

const NATIVE_AUTH_STORAGE_KEY = "overlooked.supabase.auth";

/* =====================================================
   URL HELPERS
   ===================================================== */

function getWebUrlParts() {
  if (Platform.OS !== "web") {
    return {
      href: "",
      path: "",
      hash: "",
      search: "",
    };
  }

  if (typeof window === "undefined") {
    return {
      href: "",
      path: "",
      hash: "",
      search: "",
    };
  }

  return {
    href: window.location.href || "",
    path: window.location.pathname || "",
    hash: window.location.hash || "",
    search: window.location.search || "",
  };
}

function getUrlParam(url: string, key: string): string | null {
  try {
    const parsed = new URL(url);

    const direct = parsed.searchParams.get(key);
    if (direct) return direct;

    const hash = parsed.hash?.replace(/^#/, "") || "";
    if (hash) {
      const hashParams = new URLSearchParams(hash);
      const fromHash = hashParams.get(key);
      if (fromHash) return fromHash;
    }

    return null;
  } catch {
    try {
      const lower = url.toLowerCase();
      const safeKey = `${key.toLowerCase()}=`;

      if (!lower.includes(safeKey)) return null;

      const after = url.split(new RegExp(`${key}=`, "i"))[1];
      if (!after) return null;

      return after.split("&")[0].split("#")[0] || null;
    } catch {
      return null;
    }
  }
}

/**
 * WEB password reset detection.
 *
 * Important:
 * - On web, token/code/access_token can exist for multiple auth flows.
 * - So we only treat it as recovery if the route/path itself is a reset route
 *   OR the URL explicitly says type=recovery.
 */
function isWebRecoveryUrl(): boolean {
  if (Platform.OS !== "web") return false;

  const { href, path, hash, search } = getWebUrlParts();

  const lowerHref = href.toLowerCase();
  const lowerPath = path.toLowerCase();
  const lowerHash = hash.toLowerCase();
  const lowerSearch = search.toLowerCase();

  const isResetRoute =
    lowerPath.includes("/reset-password") ||
    lowerPath.endsWith("/reset-password") ||
    lowerPath.includes("/new-password") ||
    lowerPath.endsWith("/new-password");

  const hasRecoveryType =
    lowerHref.includes("type=recovery") ||
    lowerHash.includes("type=recovery") ||
    lowerSearch.includes("type=recovery");

  return Boolean(isResetRoute || hasRecoveryType);
}

/**
 * NATIVE password reset detection.
 *
 * Critical fix:
 * - DO NOT treat "code=", "token_hash=", "access_token=", or "refresh_token="
 *   as recovery by themselves.
 * - Signup confirmation links can also contain code/tokens.
 * - Only recovery routes or type=recovery should trigger NewPassword.
 */
function isNativeRecoveryUrl(url?: string | null): boolean {
  if (Platform.OS === "web") return false;
  if (!url) return false;

  const lower = url.toLowerCase();

  return (
    lower.includes("reset-password") ||
    lower.includes("new-password") ||
    lower.includes("newpassword") ||
    lower.includes("type=recovery")
  );
}

function isRecoveryUrl(url?: string | null): boolean {
  return isWebRecoveryUrl() || isNativeRecoveryUrl(url);
}

/**
 * WEB email confirmation detection.
 */
function isWebEmailConfirmationUrl(): boolean {
  if (Platform.OS !== "web") return false;
  if (typeof window === "undefined") return false;

  if (isWebRecoveryUrl()) return false;

  const { href, path, hash, search } = getWebUrlParts();

  const lowerHref = href.toLowerCase();
  const lowerPath = path.toLowerCase();
  const lowerHash = hash.toLowerCase();
  const lowerSearch = search.toLowerCase();

  const hasSignupType =
    lowerHref.includes("type=signup") ||
    lowerHash.includes("type=signup") ||
    lowerSearch.includes("type=signup");

  const hasInviteType =
    lowerHref.includes("type=invite") ||
    lowerHash.includes("type=invite") ||
    lowerSearch.includes("type=invite");

  const hasCode =
    lowerHref.includes("code=") ||
    lowerHash.includes("code=") ||
    lowerSearch.includes("code=");

  const hasAccessToken =
    lowerHref.includes("access_token=") ||
    lowerHash.includes("access_token=") ||
    lowerSearch.includes("access_token=");

  const hasRefreshToken =
    lowerHref.includes("refresh_token=") ||
    lowerHash.includes("refresh_token=") ||
    lowerSearch.includes("refresh_token=");

  const isAuthCallbackRoute =
    lowerPath.includes("auth") ||
    lowerPath.includes("callback") ||
    lowerPath.includes("create-profile") ||
    lowerPath.includes("signin");

  return Boolean(
    hasSignupType ||
      hasInviteType ||
      ((hasCode || hasAccessToken || hasRefreshToken) && isAuthCallbackRoute)
  );
}

/**
 * NATIVE email confirmation detection.
 *
 * This catches:
 * - overlooked://callback?code=...
 * - overlooked://create-profile?code=...
 * - overlooked://callback?type=signup
 * - overlooked://callback#access_token=...&type=signup
 */
function isNativeEmailConfirmationUrl(url?: string | null): boolean {
  if (Platform.OS === "web") return false;
  if (!url) return false;

  if (isNativeRecoveryUrl(url)) return false;

  const lower = url.toLowerCase();

  const type = getUrlParam(url, "type")?.toLowerCase() || "";

  const hasSignupType =
    type === "signup" ||
    lower.includes("type=signup") ||
    lower.includes("type=invite");

  const hasAuthCode =
    lower.includes("code=") &&
    !lower.includes("type=recovery") &&
    !lower.includes("reset-password") &&
    !lower.includes("new-password") &&
    !lower.includes("newpassword");

  const hasSignupTokens =
    (lower.includes("access_token=") || lower.includes("refresh_token=")) &&
    !lower.includes("type=recovery") &&
    !lower.includes("reset-password") &&
    !lower.includes("new-password") &&
    !lower.includes("newpassword");

  const isCallbackRoute =
    lower.includes("overlooked://callback") ||
    lower.includes("overlooked://create-profile") ||
    lower.includes("https://overlooked.cloud/create-profile") ||
    lower.includes("https://www.overlooked.cloud/create-profile") ||
    lower.includes("https://overlooked.cloud/signin") ||
    lower.includes("https://www.overlooked.cloud/signin");

  return Boolean(
    hasSignupType ||
      (isCallbackRoute && (hasAuthCode || hasSignupTokens))
  );
}

function isEmailConfirmationUrl(url?: string | null): boolean {
  return isWebEmailConfirmationUrl() || isNativeEmailConfirmationUrl(url);
}

function isInvalidRefreshTokenError(error: any): boolean {
  const message = String(error?.message || error || "").toLowerCase();

  return (
    message.includes("invalid refresh token") ||
    message.includes("refresh token not found") ||
    message.includes("refresh_token_not_found")
  );
}

async function clearPersistedAuthSession() {
  try {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem(NATIVE_AUTH_STORAGE_KEY);
      }
      return;
    }

    await AsyncStorage.removeItem(NATIVE_AUTH_STORAGE_KEY);
  } catch (e: any) {
    console.warn(
      "AuthProvider clearPersistedAuthSession error:",
      e?.message || String(e)
    );
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<MinimalProfile | null>(null);
  const [profileChecked, setProfileChecked] = useState(false);

  const inFlightProfileForRef = useRef<string | null>(null);
  const lastLoadedProfileForRef = useRef<string | null>(null);
  const authBootstrappedRef = useRef(false);
  const clearingSessionRef = useRef(false);
  const latestAuthUserIdRef = useRef<string | null>(null);
  const pendingCreateProfileRedirectRef = useRef(false);

  async function loadProfile(uid: string, force = false) {
    if (!uid) {
      setProfileChecked(true);
      return;
    }

    setProfileChecked(false);

    if (!force && lastLoadedProfileForRef.current === uid && profile?.id === uid) {
      setProfileChecked(true);
      return;
    }

    if (inFlightProfileForRef.current === uid) {
      return;
    }

    inFlightProfileForRef.current = uid;

    try {
      const { data, error } = await supabase
        .from("users")
        .select("id, full_name, main_role_id, city_id")
        .eq("id", uid)
        .maybeSingle();

      if (error) {
        console.warn("AuthProvider loadProfile error:", error.message);
        return;
      }

      if (latestAuthUserIdRef.current !== uid) return;

      if (!data) {
        setProfile(null);
        lastLoadedProfileForRef.current = null;
        setProfileChecked(true);
        return;
      }

      setProfile({
        id: data.id,
        full_name: data.full_name,
        main_role_id: data.main_role_id,
        city_id: data.city_id,
      });

      lastLoadedProfileForRef.current = data.id;
      setProfileChecked(true);
    } catch (e: any) {
      console.warn(
        "AuthProvider loadProfile fatal error:",
        e?.message || String(e)
      );
    } finally {
      inFlightProfileForRef.current = null;
      setProfileChecked(true);
    }
  }

  const clearLocalAuthState = () => {
    latestAuthUserIdRef.current = null;
    setUserId(null);
    setProfile(null);
    setProfileChecked(false);
    lastLoadedProfileForRef.current = null;
    inFlightProfileForRef.current = null;
  };

  const tryNavigateToCreateProfile = () => {
    if (G.__OVERLOOKED_RECOVERY__ || G.__OVERLOOKED_FORCE_NEW_PASSWORD__) return;
    if (!pendingCreateProfileRedirectRef.current) return;
    if (!navigationRef.isReady()) return;

    pendingCreateProfileRedirectRef.current = false;

    navigationRef.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: "CreateProfile" as never }],
      })
    );
  };

  const tryNavigateToNewPassword = () => {
    if (!G.__OVERLOOKED_FORCE_NEW_PASSWORD__) return;
    if (!navigationRef.isReady()) return;

    navigationRef.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: "NewPassword" as never }],
      })
    );
  };

  const markRecoveryMode = () => {
    G.__OVERLOOKED_RECOVERY__ = true;
    G.__OVERLOOKED_EMAIL_CONFIRM__ = false;
    G.__OVERLOOKED_FORCE_NEW_PASSWORD__ = true;
    pendingCreateProfileRedirectRef.current = false;
  };

  const markEmailConfirmationMode = () => {
    G.__OVERLOOKED_RECOVERY__ = false;
    G.__OVERLOOKED_FORCE_NEW_PASSWORD__ = false;
    G.__OVERLOOKED_EMAIL_CONFIRM__ = true;
    pendingCreateProfileRedirectRef.current = true;
  };

  const safelyHandleMissingSession = async () => {
    if (clearingSessionRef.current) return;
    clearingSessionRef.current = true;

    try {
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        if (isInvalidRefreshTokenError(error)) {
          await clearPersistedAuthSession();
          clearLocalAuthState();
          return;
        }

        console.warn("AuthProvider getSession recheck error:", error.message);
      }

      const recoveredUid = data?.session?.user?.id ?? null;

      if (recoveredUid) {
        latestAuthUserIdRef.current = recoveredUid;
        setUserId(recoveredUid);

        if (!G.__OVERLOOKED_RECOVERY__ && !G.__OVERLOOKED_FORCE_NEW_PASSWORD__) {
          await loadProfile(recoveredUid);
        }

        return;
      }

      clearLocalAuthState();
    } finally {
      clearingSessionRef.current = false;
    }
  };

  const refreshProfile = async () => {
    if (userId) {
      lastLoadedProfileForRef.current = null;
      await loadProfile(userId, true);
    }
  };

  useEffect(() => {
    let mounted = true;

    try {
      supabase.auth.startAutoRefresh();
    } catch {}

    const appStateSub = AppState.addEventListener("change", async (state) => {
      try {
        if (state === "active") {
          supabase.auth.startAutoRefresh();

          const activeUrl =
            Platform.OS === "web" ? null : await Linking.getInitialURL();

          if (isRecoveryUrl(activeUrl)) {
            markRecoveryMode();
            tryNavigateToNewPassword();
            return;
          }

          if (isEmailConfirmationUrl(activeUrl)) {
            markEmailConfirmationMode();
          }

          const { data, error } = await supabase.auth.getSession();

          if (error) {
            if (isInvalidRefreshTokenError(error)) {
              await clearPersistedAuthSession();
              clearLocalAuthState();
              return;
            }

            console.warn(
              "AuthProvider resume session check error:",
              error.message
            );
            return;
          }

          const resumedUid = data?.session?.user?.id ?? null;

          if (resumedUid) {
            latestAuthUserIdRef.current = resumedUid;
            setUserId((prev) => (prev === resumedUid ? prev : resumedUid));

            if (!G.__OVERLOOKED_RECOVERY__ && !G.__OVERLOOKED_FORCE_NEW_PASSWORD__) {
              await loadProfile(resumedUid, G.__OVERLOOKED_EMAIL_CONFIRM__);
            }

            if (G.__OVERLOOKED_EMAIL_CONFIRM__) {
              pendingCreateProfileRedirectRef.current = true;
              tryNavigateToCreateProfile();
            }
          }
        }
      } catch (e: any) {
        console.warn(
          "AuthProvider AppState handler error:",
          e?.message || String(e)
        );
      }
    });

    const init = async () => {
      const initialUrl =
        Platform.OS === "web" ? null : await Linking.getInitialURL();

      const shouldBeRecovery = isRecoveryUrl(initialUrl);
      const shouldBeEmailConfirm = shouldBeRecovery
        ? false
        : isEmailConfirmationUrl(initialUrl);

      if (shouldBeRecovery) {
        markRecoveryMode();
      } else if (shouldBeEmailConfirm) {
        markEmailConfirmationMode();
      } else {
        G.__OVERLOOKED_RECOVERY__ = false;
        G.__OVERLOOKED_FORCE_NEW_PASSWORD__ = false;
      }

      const { data, error } = await supabase.auth.getSession();

      if (!mounted) return;

      if (error) {
        if (isInvalidRefreshTokenError(error)) {
          await clearPersistedAuthSession();
          clearLocalAuthState();
          authBootstrappedRef.current = true;
          setReady(true);
          return;
        }

        console.warn("AuthProvider init getSession error:", error.message);
      }

      const uid = data.session?.user?.id ?? null;

      if (uid) {
        latestAuthUserIdRef.current = uid;
        setUserId(uid);

        if (!shouldBeRecovery) {
          await registerAndSavePushToken(uid);
          await loadProfile(uid, true);
        }

        if (shouldBeEmailConfirm && !shouldBeRecovery) {
          pendingCreateProfileRedirectRef.current = true;
        }
      } else {
        latestAuthUserIdRef.current = null;
        setUserId(null);
        setProfile(null);
        lastLoadedProfileForRef.current = null;
        inFlightProfileForRef.current = null;
      }

      authBootstrappedRef.current = true;
      setReady(true);

      if (shouldBeRecovery) {
        setTimeout(() => {
          tryNavigateToNewPassword();
        }, 0);
      } else if (shouldBeEmailConfirm) {
        setTimeout(() => {
          tryNavigateToCreateProfile();
        }, 0);
      }
    };

    const linkingSub = Linking.addEventListener("url", async ({ url }) => {
      if (isNativeRecoveryUrl(url)) {
        markRecoveryMode();

        if (mounted) {
          authBootstrappedRef.current = true;
          setReady(true);
        }

        setTimeout(() => {
          tryNavigateToNewPassword();
        }, 0);

        return;
      }

      if (isNativeEmailConfirmationUrl(url)) {
        markEmailConfirmationMode();

        if (mounted) {
          authBootstrappedRef.current = true;
          setReady(true);
        }

        try {
          const { data, error } = await supabase.auth.getSession();

          if (error && !isInvalidRefreshTokenError(error)) {
            console.warn(
              "AuthProvider email confirmation getSession error:",
              error.message
            );
          }

          const confirmedUid = data?.session?.user?.id ?? null;

          if (confirmedUid) {
            latestAuthUserIdRef.current = confirmedUid;
            setUserId(confirmedUid);
            await registerAndSavePushToken(confirmedUid);
            await loadProfile(confirmedUid, true);
          }
        } catch (e: any) {
          console.warn(
            "AuthProvider native email confirmation handler error:",
            e?.message || String(e)
          );
        }

        setTimeout(() => {
          tryNavigateToCreateProfile();
        }, 0);
      }
    });

    init();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log("Auth event →", event);

        if (event === "PASSWORD_RECOVERY") {
          const initialUrl =
            Platform.OS === "web" ? null : await Linking.getInitialURL();

          const okRecovery =
            G.__OVERLOOKED_RECOVERY__ ||
            G.__OVERLOOKED_FORCE_NEW_PASSWORD__ ||
            isRecoveryUrl(initialUrl);

          console.log(
            "🔐 PASSWORD_RECOVERY event received. okRecovery=",
            okRecovery
          );

          if (okRecovery) {
            markRecoveryMode();
            tryNavigateToNewPassword();
          } else {
            console.warn(
              "⚠️ PASSWORD_RECOVERY fired but URL is not recovery. Ignoring."
            );

            G.__OVERLOOKED_RECOVERY__ = false;
            G.__OVERLOOKED_FORCE_NEW_PASSWORD__ = false;
          }

          if (!ready && mounted) {
            authBootstrappedRef.current = true;
            setReady(true);
          }

          return;
        }

        const activeUrl =
          Platform.OS === "web" ? null : await Linking.getInitialURL();

        const authEventIsEmailConfirmation =
          isEmailConfirmationUrl(activeUrl) ||
          G.__OVERLOOKED_EMAIL_CONFIRM__;

        if (
          (event === "SIGNED_IN" || event === "INITIAL_SESSION") &&
          authEventIsEmailConfirmation &&
          !isRecoveryUrl(activeUrl) &&
          !G.__OVERLOOKED_RECOVERY__ &&
          !G.__OVERLOOKED_FORCE_NEW_PASSWORD__
        ) {
          console.log("✅ Email confirmation flow detected");

          markEmailConfirmationMode();

          const confirmedUid = session?.user?.id ?? null;

          if (confirmedUid) {
            latestAuthUserIdRef.current = confirmedUid;
            setUserId(confirmedUid);
            await registerAndSavePushToken(confirmedUid);
            await loadProfile(confirmedUid, true);
            pendingCreateProfileRedirectRef.current = true;
          }

          if (!ready && mounted) {
            authBootstrappedRef.current = true;
            setReady(true);
          }

          tryNavigateToCreateProfile();
          return;
        }

        if (event === "USER_UPDATED") {
          console.log("🔐 USER_UPDATED fired");

          if (G.__OVERLOOKED_RECOVERY__) {
            console.log("✅ Recovery complete → exiting recovery mode");

            G.__OVERLOOKED_RECOVERY__ = false;
            G.__OVERLOOKED_FORCE_NEW_PASSWORD__ = false;

            if (Platform.OS === "web" && typeof window !== "undefined") {
              const clean = window.location.origin + "/signin";
              window.history.replaceState({}, document.title, clean);
            }

            if (navigationRef.isReady()) {
              navigationRef.dispatch(
                CommonActions.reset({
                  index: 0,
                  routes: [{ name: "Auth", params: { screen: "SignIn" } }],
                })
              );
            }

            return;
          }
        }

        if (event === "SIGNED_IN" && !isRecoveryUrl(activeUrl)) {
          if (!G.__OVERLOOKED_FORCE_NEW_PASSWORD__) {
            G.__OVERLOOKED_RECOVERY__ = false;
          }
        }

        if (event === "SIGNED_OUT") {
          G.__OVERLOOKED_RECOVERY__ = false;
          G.__OVERLOOKED_EMAIL_CONFIRM__ = false;
          G.__OVERLOOKED_FORCE_NEW_PASSWORD__ = false;
        }

        const uid = session?.user?.id ?? null;

        if (uid) {
          const inRecoveryFlow =
            G.__OVERLOOKED_RECOVERY__ ||
            G.__OVERLOOKED_FORCE_NEW_PASSWORD__ ||
            event === "PASSWORD_RECOVERY" ||
            isRecoveryUrl(activeUrl);

          if (inRecoveryFlow) {
            console.log(
              "🔐 Recovery session detected — not treating as normal app sign-in"
            );

            markRecoveryMode();
            tryNavigateToNewPassword();

            if (!ready && mounted) {
              authBootstrappedRef.current = true;
              setReady(true);
            }

            return;
          }

          latestAuthUserIdRef.current = uid;
          setUserId(uid);

          await registerAndSavePushToken(uid);
          await loadProfile(uid, event === "SIGNED_IN" || event === "USER_UPDATED");

          if (G.__OVERLOOKED_EMAIL_CONFIRM__) {
            pendingCreateProfileRedirectRef.current = true;
            tryNavigateToCreateProfile();
          }

          if (!ready && mounted) {
            authBootstrappedRef.current = true;
            setReady(true);
          }

          return;
        }

        if (
          event === "TOKEN_REFRESHED" ||
          event === "INITIAL_SESSION" ||
          event === "SIGNED_IN" ||
          event === "USER_UPDATED"
        ) {
          await safelyHandleMissingSession();

          if (!ready && mounted) {
            authBootstrappedRef.current = true;
            setReady(true);
          }

          return;
        }

        if (event === "SIGNED_OUT") {
          clearLocalAuthState();

          if (!ready && mounted) {
            authBootstrappedRef.current = true;
            setReady(true);
          }

          return;
        }

        await safelyHandleMissingSession();

        if (!ready && mounted) {
          authBootstrappedRef.current = true;
          setReady(true);
        }
      }
    );

    return () => {
      try {
        appStateSub.remove();
      } catch {}

      try {
        linkingSub.remove();
      } catch {}

      listener?.subscription?.unsubscribe?.();
      mounted = false;
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;

    if (G.__OVERLOOKED_FORCE_NEW_PASSWORD__ || G.__OVERLOOKED_RECOVERY__) {
      tryNavigateToNewPassword();
      return;
    }

    tryNavigateToCreateProfile();
  }, [ready, userId, profile]);

  const profileComplete = useMemo(() => {
    if (!profile) return false;

    return Boolean(profile.full_name && profile.main_role_id && profile.city_id);
  }, [profile]);

  const shouldRouteToCreateProfile = useMemo(() => {
    return Boolean(
      userId &&
        profileChecked &&
        !profile &&
        G.__OVERLOOKED_EMAIL_CONFIRM__ &&
        !G.__OVERLOOKED_RECOVERY__ &&
        !G.__OVERLOOKED_FORCE_NEW_PASSWORD__
    );
  }, [userId, profile, profileChecked]);

  const value = useMemo(
    () => ({
      ready,
      userId,
      profile,
      profileComplete,
      shouldRouteToCreateProfile,
      refreshProfile,
    }),
    [ready, userId, profile, profileComplete, shouldRouteToCreateProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);