import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../lib/supabase";
import { navigationRef } from "../navigation/navigationRef";
import { CommonActions } from "@react-navigation/native";

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
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  ready: false,
  userId: null,
  profile: null,
  profileComplete: false,
  refreshProfile: async () => {},
});

const G = globalThis as any;
if (typeof G.__OVERLOOKED_RECOVERY__ === "undefined") {
  G.__OVERLOOKED_RECOVERY__ = false;
}

const NATIVE_AUTH_STORAGE_KEY = "overlooked.supabase.auth";

function isWebRecoveryUrl(): boolean {
  if (Platform.OS !== "web") return false;
  if (typeof window === "undefined") return false;

  const href = window.location.href || "";
  const path = window.location.pathname || "";
  const hash = window.location.hash || "";
  const search = window.location.search || "";

  const hasRecoveryType =
    href.includes("type=recovery") ||
    hash.includes("type=recovery") ||
    search.includes("type=recovery");

  const hasTokenHash =
    href.includes("token_hash=") ||
    hash.includes("token_hash=") ||
    search.includes("token_hash=");

  const isResetRoute =
    path.includes("/reset-password") || path.endsWith("/reset-password");

  return Boolean(hasRecoveryType || hasTokenHash || isResetRoute);
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

      // IMPORTANT:
      // Do NOT create a fake empty profile object when the row is missing or
      // the fetch briefly returns nothing. That was helping trigger false
      // "incomplete profile" states for existing users.
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
        await loadProfile(recoveredUid);
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
      const shouldBeRecovery = isWebRecoveryUrl();
      G.__OVERLOOKED_RECOVERY__ = shouldBeRecovery;

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
      latestAuthUserIdRef.current = uid;

      setUserId(uid);

      if (uid) {
        await loadProfile(uid);
      } else {
        setProfile(null);
        lastLoadedProfileForRef.current = null;
        inFlightProfileForRef.current = null;
      }

      authBootstrappedRef.current = true;
      setReady(true);
    };

    init();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log("Auth event →", event);

        if (event === "PASSWORD_RECOVERY") {
          const okRecovery = isWebRecoveryUrl() || Platform.OS !== "web";

          console.log(
            "🔐 PASSWORD_RECOVERY event received. okRecovery=",
            okRecovery
          );

          if (okRecovery) {
            G.__OVERLOOKED_RECOVERY__ = true;

            if (navigationRef.isReady()) {
              navigationRef.dispatch(
                CommonActions.reset({
                  index: 0,
                  routes: [{ name: "NewPassword" }],
                })
              );
            }
          } else {
            console.warn(
              "⚠️ PASSWORD_RECOVERY fired but URL is not recovery. Ignoring."
            );
            G.__OVERLOOKED_RECOVERY__ = false;
          }

          return;
        }

        if (event === "USER_UPDATED") {
          console.log("🔐 USER_UPDATED fired");

          if (G.__OVERLOOKED_RECOVERY__) {
            console.log("✅ Recovery complete → exiting recovery mode");
            G.__OVERLOOKED_RECOVERY__ = false;

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

        if (event === "SIGNED_IN") {
          if (!isWebRecoveryUrl()) {
            G.__OVERLOOKED_RECOVERY__ = false;
          }
        }

        if (event === "SIGNED_OUT") {
          G.__OVERLOOKED_RECOVERY__ = false;
        }

        const uid = session?.user?.id ?? null;

        if (uid) {
          latestAuthUserIdRef.current = uid;
          setUserId(uid);
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

      listener?.subscription?.unsubscribe?.();
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const profileComplete = useMemo(() => {
    if (!profile) return false;

    return Boolean(profile.full_name && profile.main_role_id && profile.city_id);
  }, [profile]);

  const value = useMemo(
    () => ({
      ready,
      userId,
      profile,
      profileComplete,
      refreshProfile,
    }),
    [ready, userId, profile, profileComplete]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);