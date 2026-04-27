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

function isWebRecoveryUrl(): boolean {
  if (Platform.OS !== "web") return false;
  if (typeof window === "undefined") return false;

  const href = window.location.href || "";
  const path = window.location.pathname || "";
  const hash = window.location.hash || "";
  const search = window.location.search || "";

  const isResetRoute =
    path.includes("/reset-password") || path.endsWith("/reset-password");

  const hasRecoveryType =
    href.includes("type=recovery") ||
    hash.includes("type=recovery") ||
    search.includes("type=recovery");

  const hasTokenHash =
    href.includes("token_hash=") ||
    hash.includes("token_hash=") ||
    search.includes("token_hash=");

  const hasCode =
    href.includes("code=") ||
    hash.includes("code=") ||
    search.includes("code=");

  const hasAccessToken =
    href.includes("access_token=") ||
    hash.includes("access_token=") ||
    search.includes("access_token=");

  const hasRefreshToken =
    href.includes("refresh_token=") ||
    hash.includes("refresh_token=") ||
    search.includes("refresh_token=");

  return Boolean(
    isResetRoute &&
      (hasRecoveryType ||
        hasTokenHash ||
        hasCode ||
        hasAccessToken ||
        hasRefreshToken)
  );
}

function isNativeRecoveryUrl(url?: string | null): boolean {
  if (Platform.OS === "web") return false;
  if (!url) return false;

  const lower = url.toLowerCase();

  return (
    lower.includes("reset-password") ||
    lower.includes("type=recovery") ||
    lower.includes("token_hash=") ||
    lower.includes("access_token=") ||
    lower.includes("refresh_token=") ||
    lower.includes("code=")
  );
}

function isRecoveryUrl(url?: string | null): boolean {
  return isWebRecoveryUrl() || isNativeRecoveryUrl(url);
}

function isWebEmailConfirmationUrl(): boolean {
  if (Platform.OS !== "web") return false;
  if (typeof window === "undefined") return false;

  if (isWebRecoveryUrl()) return false;

  const href = window.location.href || "";
  const hash = window.location.hash || "";
  const search = window.location.search || "";
  const path = window.location.pathname || "";

  const hasSignupType =
    href.includes("type=signup") ||
    hash.includes("type=signup") ||
    search.includes("type=signup");

  const hasInviteType =
    href.includes("type=invite") ||
    hash.includes("type=invite") ||
    search.includes("type=invite");

  const hasAccessToken =
    href.includes("access_token=") ||
    hash.includes("access_token=") ||
    search.includes("access_token=");

  const hasRefreshToken =
    href.includes("refresh_token=") ||
    hash.includes("refresh_token=") ||
    search.includes("refresh_token=");

  const isAuthCallbackRoute =
    path.includes("auth") ||
    path.includes("callback") ||
    path.includes("create-profile") ||
    path.includes("signin");

  return Boolean(
    hasSignupType ||
      hasInviteType ||
      ((hasAccessToken || hasRefreshToken) && isAuthCallbackRoute)
  );
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

  const inFlightProfileForRef = useRef<string | null>(null);
  const lastLoadedProfileForRef = useRef<string | null>(null);
  const authBootstrappedRef = useRef(false);
  const clearingSessionRef = useRef(false);
  const latestAuthUserIdRef = useRef<string | null>(null);
  const pendingCreateProfileRedirectRef = useRef(false);

  async function loadProfile(uid: string, force = false) {
    if (!uid) return;

    if (!force && lastLoadedProfileForRef.current === uid && profile?.id === uid) {
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
        return;
      }

      setProfile({
        id: data.id,
        full_name: data.full_name,
        main_role_id: data.main_role_id,
        city_id: data.city_id,
      });
      lastLoadedProfileForRef.current = data.id;
    } catch (e: any) {
      console.warn(
        "AuthProvider loadProfile fatal error:",
        e?.message || String(e)
      );
    } finally {
      inFlightProfileForRef.current = null;
    }
  }

  const clearLocalAuthState = () => {
    latestAuthUserIdRef.current = null;
    setUserId(null);
    setProfile(null);
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
            await loadProfile(resumedUid);
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
        : isWebEmailConfirmationUrl();

      if (shouldBeRecovery) {
        markRecoveryMode();
      } else {
        G.__OVERLOOKED_RECOVERY__ = false;
        G.__OVERLOOKED_EMAIL_CONFIRM__ = shouldBeEmailConfirm;
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
      }
    };

    const linkingSub = Linking.addEventListener("url", ({ url }) => {
      if (isNativeRecoveryUrl(url)) {
        markRecoveryMode();

        if (mounted) {
          authBootstrappedRef.current = true;
          setReady(true);
        }

        setTimeout(() => {
          tryNavigateToNewPassword();
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

          const okRecovery = isRecoveryUrl(initialUrl) || Platform.OS !== "web";

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
          }

          if (!ready && mounted) {
            authBootstrappedRef.current = true;
            setReady(true);
          }

          return;
        }

        if (
          (event === "SIGNED_IN" || event === "INITIAL_SESSION") &&
          (isWebEmailConfirmationUrl() || G.__OVERLOOKED_EMAIL_CONFIRM__) &&
          !isWebRecoveryUrl() &&
          !G.__OVERLOOKED_RECOVERY__ &&
          !G.__OVERLOOKED_FORCE_NEW_PASSWORD__
        ) {
          console.log("✅ Email confirmation flow detected");

          G.__OVERLOOKED_EMAIL_CONFIRM__ = true;
          G.__OVERLOOKED_RECOVERY__ = false;

          const confirmedUid = session?.user?.id ?? null;

          if (confirmedUid) {
            latestAuthUserIdRef.current = confirmedUid;
            setUserId(confirmedUid);
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

        if (event === "SIGNED_IN" && !isWebRecoveryUrl()) {
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
          const activeUrl =
            Platform.OS === "web" ? null : await Linking.getInitialURL();

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
        !profileComplete &&
        !G.__OVERLOOKED_RECOVERY__ &&
        !G.__OVERLOOKED_FORCE_NEW_PASSWORD__
    );
  }, [userId, profileComplete]);

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