// app/navigation/AppNavigator.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  NavigationContainer,
  DefaultTheme,
  type InitialState,
} from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
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
import WorkshopSubmitScreen from "../screens/WorkshopSubmitScreen";
import PublicProfileScreen from "../screens/PublicProfileScreen";
import SharedFilmScreen from "../screens/SharedFilmScreen";

const Stack = createStackNavigator();

const NAV_THEME = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: "#0D0D0D",
    card: "#0D0D0D",
    text: "#EDEBE6",
    border: "transparent",
    primary: "#EDEBE6",
    notification: DefaultTheme.colors.notification,
  },
};

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

  // --------------------------------------------------------------
  // Paid / membership check (non-blocking)
  // --------------------------------------------------------------
  const [isPaid, setIsPaid] = useState<boolean | null>(null);
  const [expired, setExpired] = useState(false);
  const [membershipChecked, setMembershipChecked] = useState(false);
  const lastCheckedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setIsPaid(null);
      setExpired(false);
      setMembershipChecked(true);
      lastCheckedUserIdRef.current = null;
      return;
    }

    let mounted = true;
    setMembershipChecked(false);

    const sameUserAsLast = lastCheckedUserIdRef.current === userId;

    if (sameUserAsLast && isPaid !== null) {
      setMembershipChecked(true);
    }

    (async () => {
      try {
        const { data, error } = await supabase
          .from("users")
          .select(
            "tier, subscription_status, grandfathered, premium_access_expires_at"
          )
          .eq("id", userId)
          .single();

        if (!mounted) return;

        if (error) {
          setMembershipChecked(true);
          return;
        }

        const exp = data?.premium_access_expires_at
          ? new Date(data.premium_access_expires_at).getTime()
          : null;

        const expiredNow = exp ? Date.now() >= exp : false;
        const stat = (data?.subscription_status || "").toLowerCase();

        const paidByTier = (data?.tier || "").toLowerCase() === "pro";

        const paidByStatus =
          !expiredNow &&
          (stat === "active" ||
            stat === "trialing" ||
            stat === "past_due" ||
            data?.grandfathered);

        const paid = paidByTier || paidByStatus;

        setExpired(expiredNow);
        setIsPaid(paid);

        lastCheckedUserIdRef.current = userId;
      } finally {
        if (mounted) setMembershipChecked(true);
      }
    })();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  

  // --------------------------------------------------------------
  // Global loading
  // --------------------------------------------------------------
  if (!ready || !navReady) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#0D0D0D",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator color={COLORS.loader} />
      </View>
    );
  }

  const mustShowPaywall = false;

  const rootInitialRouteName =
    !userId || !profileComplete
      ? "Auth"
      : mustShowPaywall
      ? "Paywall"
      : "MainTabs";

  // --------------------------------------------------------------
  // Navigation tree
  // --------------------------------------------------------------
  return (
    <NavigationContainer
      ref={navigationRef as any}
      linking={linking}
      initialState={initialState}
      onReady={() => setNavigatorReady(true)}
      theme={NAV_THEME}
    >
      <Stack.Navigator
  screenOptions={{
    headerShown: false,
    cardStyle: { backgroundColor: "#0D0D0D" },
  }}
  initialRouteName={rootInitialRouteName as any}
>
        <Stack.Screen name="Paywall" component={PaywallScreen} />
        <Stack.Screen name="PaySuccess" component={PaySuccessScreen} />

        <Stack.Screen
          name="Auth"
          children={() => (
            <AuthStack
              initialRouteName={
                !userId
                  ? initialAuthRouteName
                  : !profileComplete
                  ? "CreateProfile"
                  : "SignIn"
              }
            />
          )}
        />

        <Stack.Screen name="MainTabs" component={MainTabs} />

        {mustShowPaywall && (
          <Stack.Screen name="PaywallGate" component={PaywallScreen} />
        )}

        <Stack.Screen
          name="WorkshopSubmit"
          component={WorkshopSubmitScreen}
        />
        <Stack.Screen
          name="PublicProfile"
          component={PublicProfileScreen}
        />
        <Stack.Screen
          name="SharedFilm"
          component={SharedFilmScreen}
        />
        <Stack.Screen
          name="NewPassword"
          component={NewPassword}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}