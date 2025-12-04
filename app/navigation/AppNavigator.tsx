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
import NewPassword from "../screens/NewPassword";

const Stack = createNativeStackNavigator();

type Props = {
  initialAuthRouteName: "SignIn" | "CreateProfile";
};

/* ------------------------------------------------------------------
   Detect recovery URLs
------------------------------------------------------------------ */
function isRecoveryUrl(url?: string | null): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes("type=recovery") ||
    lower.includes("reset-password") ||
    lower.includes("/auth/v1/verify") ||
    lower.includes("/auth/confirm") ||
    lower.includes("access_token")
  );
}

export default function AppNavigator({ initialAuthRouteName }: Props) {
  const { ready, userId, profileComplete } = useAuth();

  const [initialState, setInitialState] = useState<InitialState | undefined>();
  const [navReady, setNavReady] = useState(false);
  const [forceRecovery, setForceRecovery] = useState(false);

  /* ------------------------------------------------------------------
      1. Detect deep link BEFORE navigator loads
  ------------------------------------------------------------------ */
  useEffect(() => {
    let active = true;

    const detect = async (incoming: string | null) => {
      const url = incoming ?? (await RNLinking.getInitialURL());
      if (!url || !active) return;

      if (isRecoveryUrl(url)) {
        console.log("🔐 RECOVERY MODE DETECTED:", url);
        setForceRecovery(true);

        // IMPORTANT: Must match the route name inside <Stack.Navigator>
        setInitialState({
          routes: [{ name: "Recovery" }],
        });
      }
    };

    detect(null);

    const sub = RNLinking.addEventListener("url", (e) => detect(e.url));
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  /* ------------------------------------------------------------------
      2. Restore previous state ONLY IF not in recovery mode
  ------------------------------------------------------------------ */
  useEffect(() => {
    let mounted = true;

    const restore = async () => {
      if (!ready) return;

      // In recovery mode → do NOT restore nav state
      if (forceRecovery) {
        if (mounted) setNavReady(true);
        return;
      }

      // Not logged in OR no profile → start fresh
      if (!userId || !profileComplete) {
        setInitialState(undefined);
        if (mounted) setNavReady(true);
        return;
      }

      // Restore saved nav state for normal users
      try {
        const saved = await AsyncStorage.getItem(
          `NAVIGATION_STATE_v2:${userId}`
        );
        if (saved && mounted) {
          setInitialState(JSON.parse(saved));
        }
      } finally {
        if (mounted) setNavReady(true);
      }
    };

    restore();
    return () => {
      mounted = false;
    };
  }, [ready, userId, profileComplete, forceRecovery]);

  /* ------------------------------------------------------------------
      3. Subscription logic
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

    return () => {
      mounted = false;
    };
  }, [userId]);

  useEffect(() => {
    if (userId && expired) {
      supabase.auth.signOut().catch(() => {});
    }
  }, [userId, expired]);

  /* ------------------------------------------------------------------
      4. Reset recovery mode when the user logs out
  ------------------------------------------------------------------ */
  useEffect(() => {
    if (!userId) {
      setForceRecovery(false);
      setInitialState(undefined);
    }
  }, [userId]);

  /* ------------------------------------------------------------------
      5. Global loading spinner
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
      6. Navigation Tree
      FORCE RECOVERY creates a completely separate root navigator
  ------------------------------------------------------------------ */
  return (
    <NavigationContainer
      ref={navigationRef as any}
      linking={linking}
      initialState={initialState}
      onReady={() => setNavigatorReady(true)}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {/* 🔥 COMPLETELY SEPARATE ROOT WHEN RECOVERING */}
        {forceRecovery ? (
          <Stack.Screen name="Recovery" component={NewPassword} />
        ) : !userId ? (
          <>
            <Stack.Screen name="Auth">
              {() => <AuthStack initialRouteName={initialAuthRouteName} />}
            </Stack.Screen>
          </>
        ) : mustShowPaywall ? (
          <>
            <Stack.Screen name="Paywall" component={PaywallScreen} />
            <Stack.Screen name="PaySuccess" component={PaySuccessScreen} />
          </>
        ) : !profileComplete ? (
          <>
            <Stack.Screen name="Auth">
              {() => <AuthStack initialRouteName="CreateProfile" />}
            </Stack.Screen>
          </>
        ) : (
          <>
            <Stack.Screen name="MainTabs" component={MainTabs} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
