// app/navigation/AppNavigator.tsx
import React, { useEffect, useState } from "react";
import {
  NavigationContainer,
  type InitialState,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { View, ActivityIndicator, Platform, Linking } from "react-native";

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

export default function AppNavigator({
  initialAuthRouteName,
}: {
  initialAuthRouteName: "SignIn" | "CreateProfile";
}) {
  const { ready, userId, profileComplete } = useAuth();

  const [initialState, setInitialState] = useState<InitialState | undefined>();
  const [navReady, setNavReady] = useState(false);

  // --------------------------------------------------------------
  // Password recovery detection (web + mobile)
  // --------------------------------------------------------------

  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    async function detectRecovery() {
      let url = "";

      if (Platform.OS === "web") {
        url = window.location.href;
      } else {
        url = (await Linking.getInitialURL()) || "";
      }

      if (!url.includes("#")) return;

      const hash = url.split("#")[1];
      const params = new URLSearchParams(hash);

      const access = params.get("access_token");
      const refresh = params.get("refresh_token");

      if (access && refresh) {
        console.log("🔐 Recovery link detected");
        setRecoveryMode(true);

        await supabase.auth.setSession({
          access_token: access,
          refresh_token: refresh,
        });
      }
    }

    detectRecovery();
  }, []);

  // --------------------------------------------------------------
  // Restore navigation (NOT used during recovery)
  // --------------------------------------------------------------
  useEffect(() => {
    let mounted = true;

    const restoreNav = async () => {
      if (!ready) return;

      if (recoveryMode) {
        console.log("⛔ Skipping state restore (recovery mode)");
        setInitialState(undefined);
        setNavReady(true);
        return;
      }

      if (!userId || !profileComplete) {
        setInitialState(undefined);
        setNavReady(true);
        return;
      }

      try {
        const saved = await AsyncStorage.getItem(
          `NAVIGATION_STATE_v2:${userId}`
        );
        if (saved && mounted) {
          setInitialState(JSON.parse(saved));
        }
      } catch {}

      if (mounted) setNavReady(true);
    };

    restoreNav();
    return () => {
      mounted = false;
    };
  }, [ready, userId, profileComplete, recoveryMode]);

  // --------------------------------------------------------------
  // Subscription check
  // --------------------------------------------------------------
  const [isPaid, setIsPaid] = useState<boolean | null>(null);

  useEffect(() => {
    if (!userId) {
      setIsPaid(null);
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

      const exp = data?.premium_access_expires_at
        ? new Date(data.premium_access_expires_at).getTime()
        : null;

      const expired = exp ? Date.now() >= exp : false;
      const status = (data?.subscription_status || "").toLowerCase();

      const paid =
        !expired &&
        (status === "active" ||
          status === "trialing" ||
          status === "past_due" ||
          data?.grandfathered);

      setIsPaid(paid);
      if (expired) supabase.auth.signOut();
    })();

    return () => {
      mounted = false;
    };
  }, [userId]);

  // --------------------------------------------------------------
  // Global loading
  // --------------------------------------------------------------
  if (!ready || !navReady || (userId && isPaid === null)) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: COLORS.background,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const mustShowPaywall = false;

  // --------------------------------------------------------------
  // Navigation tree
  // --------------------------------------------------------------
  return (
    <NavigationContainer
      ref={navigationRef as any}
      linking={linking}
      initialState={initialState}
      onReady={() => setNavigatorReady(true)}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>

        {/* ONLY show this if recovery deep-link is active */}
        {recoveryMode ? (
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
