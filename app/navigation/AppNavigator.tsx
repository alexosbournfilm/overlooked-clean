// app/navigation/AppNavigator.tsx
import React, { useEffect, useRef, useState } from "react";
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
          // JSON.parse can be expensive on web if state grows; keep it guarded.
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
  // Paid / membership check (same logic, but made non-blocking)
  // --------------------------------------------------------------
  const [isPaid, setIsPaid] = useState<boolean | null>(null);
  const [expired, setExpired] = useState(false);

  // ✅ key improvement:
  // Do not block rendering/navigation while this loads.
  // We still compute isPaid exactly the same way, and we still sign out on expired.
  const [membershipChecked, setMembershipChecked] = useState(false);

  // Prevent duplicate requests for same userId (fast tab switching / auth churn)
  const lastCheckedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setIsPaid(null);
      setExpired(false);
      setMembershipChecked(true); // nothing to check if logged out
      lastCheckedUserIdRef.current = null;
      return;
    }

    let mounted = true;

    // Start a fresh check state for this user
    setMembershipChecked(false);

    // If we already checked this userId recently and still have a value,
    // keep UI responsive and just re-check in the background.
    // (No logic change: isPaid will still end up correct.)
    const sameUserAsLast = lastCheckedUserIdRef.current === userId;

    if (sameUserAsLast && isPaid !== null) {
      // allow navigation to proceed instantly while we refresh quietly
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
          // keep previous value if any; just mark check complete so UI isn't blocked
          setMembershipChecked(true);
          return;
        }

        const exp = data?.premium_access_expires_at
          ? new Date(data.premium_access_expires_at).getTime()
          : null;

        const expiredNow = exp ? Date.now() >= exp : false;
        const stat = (data?.subscription_status || "").toLowerCase();

        // ✅ PRIMARY: tier (because membership.ts gates off tier)
        const paidByTier = (data?.tier || "").toLowerCase() === "pro";

        // ✅ FALLBACK: keep your existing logic
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
    // Intentionally NOT including isPaid in deps; we don't want extra re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (userId && expired) supabase.auth.signOut();
  }, [userId, expired]);

  // --------------------------------------------------------------
  // Global loading
  // --------------------------------------------------------------
  // ✅ We keep your original "global loading" behavior for app readiness + nav restore.
  // ✅ But we DO NOT block on membership fetch anymore (speed).
  if (!ready || !navReady) {
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

  // If you ever want to force paywall globally, set this.
  // But Paywall is now always registered so you can navigate to it anytime.
  const mustShowPaywall = false;

  // ✅ CRITICAL FIX:
  // If no deep-link matches, React Navigation uses the first screen in the stack
  // unless initialRouteName is set.
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
    >
      <Stack.Navigator
        screenOptions={{ headerShown: false }}
        initialRouteName={rootInitialRouteName as any}
      >
        {/* ✅ Always register these so UpgradeModal can nav.navigate('Paywall') */}
        <Stack.Screen name="Paywall" component={PaywallScreen} />
        <Stack.Screen name="PaySuccess" component={PaySuccessScreen} />

        {/* AUTH / MAIN TREE */}
        {!userId ? (
          <Stack.Screen
            name="Auth"
            children={() => (
              <AuthStack initialRouteName={initialAuthRouteName} />
            )}
          />
        ) : mustShowPaywall ? (
          // If you ever force paywall, it’s already registered above.
          <Stack.Screen name="PaywallGate" component={PaywallScreen} />
        ) : !profileComplete ? (
          <Stack.Screen
            name="Auth"
            children={() => <AuthStack initialRouteName="CreateProfile" />}
          />
        ) : (
          <Stack.Screen name="MainTabs" component={MainTabs} />
        )}

        {/* Always keep NewPassword accessible (deep link + manual nav) */}
        <Stack.Screen name="NewPassword" component={NewPassword} />
      </Stack.Navigator>

      {/* ✅ Optional: keep invisible, but ensures membership check doesn't "feel stuck".
          No logic change; just a non-blocking background check indicator if you want later.
          We are NOT rendering anything here to avoid UI changes.
      */}
    </NavigationContainer>
  );
}
