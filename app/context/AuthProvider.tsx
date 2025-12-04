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

  /* ------------------------------------------------------------------
     LOAD PROFILE
  ------------------------------------------------------------------ */
  const loadProfile = async (uid: string) => {
    const { data, error } = await supabase
      .from("users")
      .select("id, full_name, main_role_id, city_id")
      .eq("id", uid)
      .maybeSingle();

    if (error || !data) {
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
  };

  const refreshProfile = async () => {
    if (userId) await loadProfile(userId);
  };

  /* ------------------------------------------------------------------
     INITIAL SESSION LOAD
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

    /* ------------------------------------------------------------------
       AUTH LISTENER — REAL FIX FOR RECOVERY + PASSWORD UPDATE
    ------------------------------------------------------------------ */
    const { data: sub } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log("Auth event →", event);

        /* --------------------------------------------------------------
           ⭐ PASSWORD RECOVERY MODE (coming from deep link)
        -------------------------------------------------------------- */
        if (event === "PASSWORD_RECOVERY") {
          console.log("🔐 PASSWORD_RECOVERY detected → go to NewPassword");

          if (navigationRef.isReady()) {
            navigationRef.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{ name: "NewPassword" }],
              })
            );
          }

          return; // STOP normal login flow
        }

        /* --------------------------------------------------------------
           ⭐ USER_UPDATED → AFTER password is successfully changed
           Supabase emits USER_UPDATED, not PASSWORD_RECOVERY.
        -------------------------------------------------------------- */
        if (event === "USER_UPDATED") {
          console.log("🔐 USER_UPDATED → password changed successfully");

          // Reload session to prevent stale state
          await supabase.auth.getSession();

          // Now send user into the app
          if (navigationRef.isReady()) {
            navigationRef.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{ name: "MainTabs" }],
              })
            );
          }

          return;
        }

        /* --------------------------------------------------------------
           ⭐ NORMAL LOGIN / LOGOUT
        -------------------------------------------------------------- */
        const uid = session?.user?.id ?? null;
        setUserId(uid);

        if (uid) await loadProfile(uid);
        else setProfile(null);
      }
    );

    return () => {
      sub?.subscription?.unsubscribe?.();
      mounted = false;
    };
  }, []);

  /* ------------------------------------------------------------------
     LIVE PROFILE SYNC
  ------------------------------------------------------------------ */
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`users-row-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "users",
          filter: `id=eq.${userId}`,
        },
        async () => {
          await loadProfile(userId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  /* ------------------------------------------------------------------
     PROFILE COMPLETENESS
  ------------------------------------------------------------------ */
  const profileComplete = useMemo(() => {
    if (!profile) return false;
    return Boolean(
      profile.full_name && profile.main_role_id && profile.city_id
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

export function useAuth() {
  return useContext(AuthContext);
}
