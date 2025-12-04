// app/navigation/AppNavigator.tsx
import React, { useEffect, useState } from "react";
import {
  NavigationContainer,
  type InitialState,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { View, ActivityIndicator, Linking as RNLinking } from "react-native";

import AuthStack from "./AuthStack";
import MainTabs from "./MainTabs";
import { navigationRef, setNavigatorReady } from "./navigationRef";
import { linking } from "./linking";
import { useAuth } from "../context/AuthProvider";
import { supabase } from "../lib/supabase";
import COLORS from "../theme/colors";

import PaywallScreen from "../screens/PaywallScreen";
import PaySuccessScreen from "../screens/PaySuccessScreen";

const Stack = createNativeStackNavigator();

type Props = {
  initialAuthRouteName: "SignIn" | "CreateProfile";
};

/* ------------------------------------------------------------------
   ✔️ REAL recovery detection — requires actual Supabase tokens
------------------------------------------------------------------ */
function isRecoveryUrl(url?: string | null): boolean {
  if (!url) return false;
  if (!url.includes("#")) return false;

  const hash = url.split("#")[1];
  return (
    hash.includes("access_token=") ||
    hash.includes("refresh_token=")
  );
}

export default function AppNavigator({ initialAuthRouteName }: Props) {
  const { ready, userId, profileComplete } = useAuth();

  const [initialState, setInitialState] = useState<InitialState | undefined>();
  const [navReady, setNavReady] = useState(false);

  /* ------------------------------------------------------------------
      1. Recovery Flow — MUST run BEFORE AuthProvider sees session
  ------------------------------------------------------------------ */
  useEffect(() => {
    let active = true;

    const detect = async () => {
      const url = await RNLinking.getInitialURL();
      if (!url || !active) return;

      if (isRecoveryUrl(url)) {
        console.log("🔐 Recovery URL detected:", url);

        const hash = url.split("#")[1];
        const params = new URLSearchParams(hash);

        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");

        if (access_token && refresh_token) {
          console.log("🔐 Setting Supabase session from recovery link...");
          await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
        }
      }
    };

    detect();
    return () => { active = false };
  }, []);

  /* ------------------------------------------------------------------
      2. Restore navigation state (ONLY for logged-in users)
  ------------------------------------------------------------------ */
  useEffect(() => {
    let mounted = true;

    const restore = async () => {
      if (!ready) return;

      // Not logged in OR profile incomplete → start fresh
      if (!userId || !profileComplete) {
        if (mounted) {
          setInitialState(undefined);
          setNavReady(true);
        }
        return;
      }

      // Restore last nav state
      try {
        const saved = await AsyncStorage.getItem(
          `NAVIGATION_STATE_v2:${userId}`
        );
        if (saved && mounted) {
          setInitialState(JSON.parse(saved));
        }
      } catch (e) {
        console.warn("Navigation restore failed:", e);
      } finally {
        if (mounted) setNavReady(true);
      }
    };

    restore();
    return () => { mounted = false };
  }, [ready, userId, profileComplete]);

  /* ------------------------------------------------------------------
      3. Subscription / Paywall Logic (unchanged)
  ------------------------------------------------------------------ */
  const [isPaid, setIsPaid] = useState<boolean | null>(null);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!userId) {
      setIsPaid(null);
      setExpired(false);
      return;
    }

    let mounted = true;

    (async () => {
      const { data } = await supabase
        .from("users")
        .select(
          "subscription_status, grandfathered, premium_access_expires_at"
        )
        .eq("id", userId)
        .single();

      if (!mounted) return;

      const now = Date.now();
      const exp = data?.premium_access_expires_at
        ? new Date(data.premium_access_expires_at).getTime()
        : null;

      const expiredNow = exp ? exp <= now : false;

      const status = (data?.subscription_status || "").toLowerCase();
      const paid =
        !expiredNow &&
        (status === "active" ||
          status === "trialing" ||
          status === "past_due" ||
          data?.grandfathered);

      setExpired(expiredNow);
      setIsPaid(paid);
    })();

    return () => { mounted = false };
  }, [userId]);

  useEffect(() => {
    if (userId && expired) {
      supabase.auth.signOut().catch(() => {});
    }
  }, [userId, expired]);

  /* ------------------------------------------------------------------
      4. Global Loading Screen
  ------------------------------------------------------------------ */
  if (!ready || !navReady || (userId && isPaid === null)) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: COLORS.background,
        }}
      >
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const mustShowPaywall = false;

  /* ------------------------------------------------------------------
      5. Navigation Tree — clean and simple
  ------------------------------------------------------------------ */
  return (
    <NavigationContainer
      ref={navigationRef as any}
      linking={linking}
      initialState={initialState}
      onReady={() => setNavigatorReady(true)}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>

        {/* USER NOT LOGGED IN */}
        {!userId ? (
          <Stack.Screen
            name="Auth"
            children={() => (
              <AuthStack initialRouteName={initialAuthRouteName} />
            )}
          />

        /* SHOW PAYWALL IF NEEDED */
        ) : mustShowPaywall ? (
          <>
            <Stack.Screen name="Paywall" component={PaywallScreen} />
            <Stack.Screen name="PaySuccess" component={PaySuccessScreen} />
          </>

        /* USER LOGGED IN BUT NO PROFILE */
        ) : !profileComplete ? (
          <Stack.Screen
            name="Auth"
            children={() => <AuthStack initialRouteName="CreateProfile" />}
          />

        /* EVERYTHING COMPLETE → MAIN APP */
        ) : (
          <Stack.Screen name="MainTabs" component={MainTabs} />
        )}

      </Stack.Navigator>
    </NavigationContainer>
  );
}
