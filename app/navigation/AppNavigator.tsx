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

/* ------------------------------------------------------------
   HARD DEEP-LINK RECOVERY DETECTOR
------------------------------------------------------------ */
function isRecoveryUrl(url?: string | null): boolean {
  if (!url) return false;

  const lower = url.toLowerCase();

  return (
    lower.includes("type=recovery") ||
    lower.includes("reset-password") ||
    lower.includes("/auth/v1/verify") ||
    lower.includes("/auth/confirm") ||
    (lower.includes("access_token") && lower.includes("recovery"))
  );
}

export default function AppNavigator({ initialAuthRouteName }: Props) {
  const { ready, userId, profileComplete } = useAuth();

  const [initialState, setInitialState] = useState<InitialState | undefined>();
  const [navReady, setNavReady] = useState(false);
  const [forceRecovery, setForceRecovery] = useState(false);

  /* -----------------------------------------------------------------------
     1. Detect deep link **before** Supabase hydrates the session
     ----------------------------------------------------------------------- */
  useEffect(() => {
    let active = true;

    const detect = async (incoming: string | null) => {
      const url = incoming ?? (await RNLinking.getInitialURL());
      if (!url || !active) return;

      if (isRecoveryUrl(url)) {
        console.log("🔐 HARD RECOVERY MODE TRIGGERED:", url);
        setForceRecovery(true);

        // Force navigation state → ONLY NewPassword route
        const state: InitialState = {
          routes: [{ name: "NewPassword" }],
        };
        setInitialState(state);
      }
    };

    detect(null);

    const sub = RNLinking.addEventListener("url", (e) => detect(e.url));

    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  /* -----------------------------------------------------------------------
     2. Restore normal navigation state ONLY if not in recovery mode
     ----------------------------------------------------------------------- */
  useEffect(() => {
    let mounted = true;

    const restore = async () => {
      if (!ready) return;

      if (forceRecovery) {
        // skip restore entirely
        if (mounted) setNavReady(true);
        return;
      }

      if (!userId || !profileComplete) {
        setInitialState(undefined);
        if (mounted) setNavReady(true);
        return;
      }

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

  /* -----------------------------------------------------------------------
     3. Subscription check
     ----------------------------------------------------------------------- */
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

  /* -----------------------------------------------------------------------
     4. Auto sign-out if subscription expired
     ----------------------------------------------------------------------- */
  useEffect(() => {
    if (userId && expired) {
      supabase.auth.signOut().catch(() => {});
    }
  }, [userId, expired]);

  /* -----------------------------------------------------------------------
     5. Reset recovery mode when user is logged out
     ----------------------------------------------------------------------- */
  useEffect(() => {
    if (!userId) {
      setForceRecovery(false);
      setInitialState(undefined);
    }
  }, [userId]);

  /* -----------------------------------------------------------------------
     6. Global loading screen
     ----------------------------------------------------------------------- */
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

  /* -----------------------------------------------------------------------
     7. Navigation tree
     ----------------------------------------------------------------------- */
  return (
    <NavigationContainer
      ref={navigationRef as any}
      linking={linking}
      initialState={initialState}
      onReady={() => setNavigatorReady(true)}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {/* Always registered */}
        <Stack.Screen name="NewPassword" component={NewPassword} />

        {/* FORCE recovery mode */}
        {forceRecovery ? null : !userId ? (
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
