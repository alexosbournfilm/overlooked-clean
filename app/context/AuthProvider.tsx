// app/context/AuthProvider.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";
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

// ✅ Safe global flag across web + native
const G = globalThis as any;
if (typeof G.__OVERLOOKED_RECOVERY__ === "undefined") {
  G.__OVERLOOKED_RECOVERY__ = false;
}

// ✅ Web-only helper: are we ACTUALLY on a recovery/reset link?
function isWebRecoveryUrl(): boolean {
  if (Platform.OS !== "web") return false;
  if (typeof window === "undefined") return false;

  const href = window.location.href || "";
  const path = window.location.pathname || "";
  const hash = window.location.hash || "";
  const search = window.location.search || "";

  // Any of these strongly indicate a recovery link
  const hasRecoveryType =
    href.includes("type=recovery") ||
    hash.includes("type=recovery") ||
    search.includes("type=recovery");

  const hasTokenHash =
    href.includes("token_hash=") ||
    hash.includes("token_hash=") ||
    search.includes("token_hash=");

  // Your linking maps reset-password → NewPassword
  const isResetRoute =
    path.includes("/reset-password") || path.endsWith("/reset-password");

  return Boolean(hasRecoveryType || hasTokenHash || isResetRoute);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<MinimalProfile | null>(null);

  async function loadProfile(uid: string) {
    const { data } = await supabase
      .from("users")
      .select("id, full_name, main_role_id, city_id")
      .eq("id", uid)
      .maybeSingle();

    if (!data) {
      setProfile({
        id: uid,
        full_name: null,
        main_role_id: null,
        city_id: null,
      });
      return;
    }

    setProfile({
      id: data.id,
      full_name: data.full_name,
      main_role_id: data.main_role_id,
      city_id: data.city_id,
    });
  }

  const refreshProfile = async () => {
    if (userId) await loadProfile(userId);
  };

  /* ------------------------------------------------------------------
      INITIAL SESSION + AUTH LISTENER
  ------------------------------------------------------------------ */
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      // ✅ On app start, DO NOT stay in recovery mode unless URL proves it
      // This prevents "stuck recovery" where plain /signin keeps showing NewPassword.
      const shouldBeRecovery = isWebRecoveryUrl();
      G.__OVERLOOKED_RECOVERY__ = shouldBeRecovery;

      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id ?? null;

      if (!mounted) return;

      setUserId(uid);
      if (uid) await loadProfile(uid);
      else setProfile(null);

      setReady(true);
    };

    init();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log("Auth event →", event);

        // ✅ PASSWORD_RECOVERY should ONLY push to NewPassword
        // when we are truly processing a recovery link.
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
            // If Supabase fires it unexpectedly, don't trap the user.
            console.warn(
              "⚠️ PASSWORD_RECOVERY fired but URL is not recovery. Ignoring."
            );
            G.__OVERLOOKED_RECOVERY__ = false;
          }

          return;
        }

        // ✅ USER_UPDATED happens after password is successfully changed
        // We END recovery mode here and return user to SignIn.
        if (event === "USER_UPDATED") {
          console.log("🔐 USER_UPDATED fired");

          if (G.__OVERLOOKED_RECOVERY__) {
            console.log("✅ Recovery complete → exiting recovery mode");
            G.__OVERLOOKED_RECOVERY__ = false;

            // Optional hard clean of URL on web
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

        // ✅ Clear recovery mode on normal sign in/out
        if (event === "SIGNED_IN") {
          // If user signed in normally, we should not remain in recovery mode
          if (!isWebRecoveryUrl()) {
            G.__OVERLOOKED_RECOVERY__ = false;
          }
        }

        if (event === "SIGNED_OUT") {
          G.__OVERLOOKED_RECOVERY__ = false;
        }

        /* ----------------------------------------------------------
           GENERIC LOGIN/LOGOUT UPDATE
        ---------------------------------------------------------- */
        const uid = session?.user?.id ?? null;
        setUserId(uid);

        if (uid) await loadProfile(uid);
        else setProfile(null);
      }
    );

    return () => {
      listener?.subscription?.unsubscribe?.();
      mounted = false;
    };
  }, []);

  /* ------------------------------------------------------------------
      PROFILE COMPLETENESS
  ------------------------------------------------------------------ */
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
