// app/context/AuthProvider.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
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
    if (userId) loadProfile(userId);
  };

  /* ------------------------------------------------------------------
      INITIAL SESSION + AUTH LISTENER
  ------------------------------------------------------------------ */
  useEffect(() => {
    let mounted = true;

    const init = async () => {
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

        /* -------------------------------
           PASSWORD_RECOVERY event
        ------------------------------- */
        if (event === "PASSWORD_RECOVERY") {
          console.log("🔐 PASSWORD_RECOVERY → NewPassword screen");

          window.__RECOVERY__ = true;

          if (navigationRef.isReady()) {
            navigationRef.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{ name: "NewPassword" }],
              })
            );
          }
          return;
        }

        /* -------------------------------
           USER_UPDATED — user saved new password
        ------------------------------- */
        if (event === "USER_UPDATED") {
          console.log("🔐 USER_UPDATED fired");

          // When recovering password, DO NOT send user into MainTabs yet
          if (window.__RECOVERY__) {
            console.log("Recovery mode active → stay on NewPassword");
            return;
          }
        }

        // Generic login/logout handler
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

  const profileComplete = useMemo(() => {
    if (!profile) return false;
    return Boolean(
      profile.full_name &&
      profile.main_role_id &&
      profile.city_id
    );
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
