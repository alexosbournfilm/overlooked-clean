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

// Helper
function isRecoveryUrl(url?: string | null): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  return (
    u.includes("type=recovery") ||
    u.includes("/auth/v1/verify") ||
    u.includes("/auth/confirm") ||
    u.includes("#access_token")
  );
}

export default function AppNavigator({ initialAuthRouteName }: Props) {
  const { ready, userId, profileComplete } = useAuth();

  const [initialState, setInitialState] = useState<InitialState | undefined>();
  const [navReady, setNavReady] = useState(false);

  /* ------------------------------------------------------------------
      RECOVERY DETECTION — MUST HAPPEN BEFORE AUTH PROVIDER TRIGGERS
  ------------------------------------------------------------------ */
  useEffect(() => {
    let active = true;

    const detect = async () => {
      const url = await RNLinking.getInitialURL();
      if (!url || !active) return;

      if (isRecoveryUrl(url)) {
        console.log("🔐 Recovery deep link detected:", url);

        if (url.includes("#")) {
          const params = new URLSearchParams(url.split("#")[1]);
          const access_token = params.get("access_token");
          const refresh_token = params.get("refresh_token");

          if (access_token && refresh_token) {
            console.log("🔐 Setting Supabase session for recovery...");
            await supabase.auth.setSession({
              access_token,
              refresh_token,
            });
          }
        }
      }
    };

    detect();
    return () => {
      active = false;
    };
  }, []);

  /* ------------------------------------------------------------------
      RESTORE STATE FOR LOGGED-IN USERS
  ------------------------------------------------------------------ */
  useEffect(() => {
    let mounted = true;

    const restore = async () => {
      if (!ready) return;

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
      } catch (e) {
        console.log("Nav restore failed:", e);
      } finally {
        if (mounted) setNavReady(true);
      }
    };

    restore();
    return () => {
      mounted = false;
    };
  }, [ready, userId, profileComplete]);

  /* ------------------------------------------------------------------
      SUBSCRIPTION LOGIC
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
      GLOBAL LOADING
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
      NAVIGATION TREE
  ------------------------------------------------------------------ */
  return (
    <NavigationContainer
      ref={navigationRef as any}
      linking={linking}
      initialState={initialState}
      onReady={() => setNavigatorReady(true)}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!userId ? (
          <Stack.Screen
            name="Auth"
            children={() => (
              <AuthStack initialRouteName={initialAuthRouteName} />
            )}
          />
        ) : mustShowPaywall ? (
          <>
            <Stack.Screen name="Paywall" component={PaywallScreen} />
            <Stack.Screen name="PaySuccess" component={PaySuccessScreen} />
          </>
        ) : !profileComplete ? (
          <Stack.Screen
            name="Auth"
            children={() => <AuthStack initialRouteName="CreateProfile" />}
          />
        ) : (
          <Stack.Screen name="MainTabs" component={MainTabs} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
