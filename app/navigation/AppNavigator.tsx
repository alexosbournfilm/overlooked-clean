// app/navigation/AppNavigator.tsx
import React, { useEffect, useState } from "react";
import {
  NavigationContainer,
  type InitialState,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { View, ActivityIndicator } from "react-native";

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
  // Restore navigation only for logged-in users
  // --------------------------------------------------------------
  useEffect(() => {
    let mounted = true;

    const restoreNav = async () => {
      if (!ready) return;

      if (!userId || !profileComplete) {
        setInitialState(undefined);
        setNavReady(true);
        return;
      }

      try {
        const savedState = await AsyncStorage.getItem(
          `NAVIGATION_STATE_v2:${userId}`
        );
        if (savedState && mounted) {
          setInitialState(JSON.parse(savedState));
        }
      } catch {}

      if (mounted) setNavReady(true);
    };

    restoreNav();
    return () => {
      mounted = false;
    };
  }, [ready, userId, profileComplete]);

  // Subscription check
  const [isPaid, setIsPaid] = useState<boolean | null>(null);
  const [expired, setExpired] = useState(false);

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

      const expiredNow = exp ? Date.now() >= exp : false;
      const stat = (data?.subscription_status || "").toLowerCase();
      const paid =
        !expiredNow &&
        (stat === "active" ||
          stat === "trialing" ||
          stat === "past_due" ||
          data?.grandfathered);

      setExpired(expiredNow);
      setIsPaid(paid);
    })();

    return () => {
      mounted = false;
    };
  }, [userId]);

  useEffect(() => {
    if (userId && expired) supabase.auth.signOut();
  }, [userId, expired]);

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

        {/* Always keep NewPassword accessible */}
        <Stack.Screen name="NewPassword" component={NewPassword} />

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
