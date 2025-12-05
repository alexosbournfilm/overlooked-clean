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

/* ------------------------------------------------------------------
   Helper — detect Supabase-style recovery deep links
------------------------------------------------------------------ */
function isRecoveryUrl(url?: string | null): boolean {
  if (!url) return false;
  if (!url.includes("#")) return false;

  const hash = url.split("#")[1];
  return (
    hash.includes("access_token=") ||
    hash.includes("refresh_token=") ||
    hash.includes("type=recovery")
  );
}

export default function AppNavigator({
  initialAuthRouteName,
}: {
  initialAuthRouteName: "SignIn" | "CreateProfile";
}) {
  const { ready, userId, profileComplete } = useAuth();

  const [initialState, setInitialState] = useState<InitialState | undefined>();
  const [navReady, setNavReady] = useState(false);

  // ⭐ Master flag → forces NewPassword screen and disables all other routing
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);

  /* ------------------------------------------------------------------
      1) Detect recovery BEFORE AuthProvider and Navigation load
  ------------------------------------------------------------------ */
  useEffect(() => {
    let active = true;

    const detectRecovery = async () => {
      const url = await RNLinking.getInitialURL();
      if (!url || !active) return;

      if (!isRecoveryUrl(url)) return;

      console.log("🔐 Recovery URL detected:", url);
      setIsRecoveryMode(true);

      const hash = url.split("#")[1];
      const params = new URLSearchParams(hash);

      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");

      if (access_token && refresh_token) {
        console.log("🔐 Setting Supabase recovery session...");
        window.__RECOVERY__ = true;

        await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
      }
    };

    detectRecovery();

    return () => {
      active = false;
    };
  }, []);

  /* ------------------------------------------------------------------
      2) Navigation restore — DISABLED during recovery
  ------------------------------------------------------------------ */
  useEffect(() => {
    let mounted = true;

    const restore = async () => {
      if (!ready) return;

      // BLOCK restore during recovery mode
      if (isRecoveryMode) {
        console.log("⛔ Nav restore skipped — recovery mode active");
        if (mounted) {
          setInitialState(undefined);
          setNavReady(true);
        }
        return;
      }

      // Logged out or incomplete profile → clean state
      if (!userId || !profileComplete) {
        if (mounted) {
          setInitialState(undefined);
          setNavReady(true);
        }
        return;
      }

      // Normal restore for logged-in users
      try {
        const saved = await AsyncStorage.getItem(
          `NAVIGATION_STATE_v2:${userId}`
        );
        if (saved && mounted) {
          setInitialState(JSON.parse(saved));
        }
      } catch (err) {
        console.warn("Navigation restore failed:", err);
      } finally {
        if (mounted) setNavReady(true);
      }
    };

    restore();

    return () => {
      mounted = false;
    };
  }, [ready, userId, profileComplete, isRecoveryMode]);

  /* ------------------------------------------------------------------
      3) Paywall subscription logic (unchanged)
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
      4) Global loading
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
      5) Navigation Tree — recovery mode OVERRIDES EVERYTHING
  ------------------------------------------------------------------ */
  return (
    <NavigationContainer
      ref={navigationRef as any}
      linking={linking}
      initialState={initialState}
      onReady={() => setNavigatorReady(true)}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>

        {/* 🔥 ALWAYS SHOW THIS DURING PASSWORD RECOVERY */}
        {isRecoveryMode ? (
          <Stack.Screen name="NewPassword" component={NewPassword} />
        ) : !userId ? (
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
            children={() => (
              <AuthStack initialRouteName="CreateProfile" />
            )}
          />
        ) : (
          <Stack.Screen name="MainTabs" component={MainTabs} />
        )}

      </Stack.Navigator>
    </NavigationContainer>
  );
}
