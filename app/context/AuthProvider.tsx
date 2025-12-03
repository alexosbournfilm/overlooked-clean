import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "../lib/supabase";
import { navigationRef } from "../navigation/navigationRef";

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

  // -------------------------------------------------------
  // Fetch Profile
  // -------------------------------------------------------
  const loadProfile = async (uid: string) => {
    const { data: userRow, error } = await supabase
      .from("users")
      .select("id, full_name, main_role_id, city_id")
      .eq("id", uid)
      .maybeSingle();

    if (error || !userRow) {
      setProfile({
        id: uid,
        full_name: null,
        main_role_id: null,
        city_id: null,
      });
      return;
    }

    setProfile({
      id: userRow.id,
      full_name: userRow.full_name,
      main_role_id: userRow.main_role_id,
      city_id: userRow.city_id,
    });
  };

  const refreshProfile = async () => {
    if (userId) await loadProfile(userId);
  };

  // -------------------------------------------------------
  // Initial session load
  // -------------------------------------------------------
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

    // -------------------------------------------------------
    // AUTH LISTENER
    // -------------------------------------------------------
    const { data: subscription } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log("Auth event →", event);

        // ⭐ PASSWORD RESET FLOW (VERY IMPORTANT)
        if (event === "PASSWORD_RECOVERY") {
          console.log("🔐 Password recovery detected → redirecting");

          if (navigationRef.isReady()) {
            navigationRef.reset({
              index: 0,
              routes: [{ name: "NewPassword" }],
            });
          }

          return; // STOP NORMAL LOGIN FLOW
        }

        // ⭐ NORMAL LOGIN / LOGOUT
        const uid = session?.user?.id ?? null;
        setUserId(uid);

        if (uid) await loadProfile(uid);
        else setProfile(null);
      }
    );

    return () => {
      subscription?.subscription?.unsubscribe?.();
      mounted = false;
    };
  }, []);

  // -------------------------------------------------------
  // Live profile updates via Postgres
  // -------------------------------------------------------
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

  // -------------------------------------------------------
  // Profile completeness
  // -------------------------------------------------------
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
