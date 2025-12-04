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

export default function AppNavigator({ initialAuthRouteName }: Props) {
  const { ready, userId, profileComplete } = useAuth();

  const [initialState, setInitialState] = useState<InitialState | undefined>();
  const [navStateReady, setNavStateReady] = useState(false);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  /* -----------------------------------------------------------------------
     1. DETECT RECOVERY LINKS BEFORE NAV LOAD
     ----------------------------------------------------------------------- */
  useEffect(() => {
    let mounted = true;

    const detectRecovery = async (incoming?: string | null) => {
      const url = incoming ?? (await RNLinking.getInitialURL());
      if (!url || !mounted) return;

      const lower = url.toLowerCase();
      const isRecovery =
        lower.includes("type=recovery") ||
        lower.includes("reset-password") ||
        lower.includes("/auth/v1/verify") ||
        (lower.includes("access_token") && lower.includes("recovery"));

      if (isRecovery) {
        setIsPasswordRecovery(true);

        // Minimal Navigation State to jump directly to NewPassword
        const state: InitialState = {
          routes: [{ name: "NewPassword" }],
        };

        setInitialState(state);
      }
    };

    detectRecovery(null);

    const sub = RNLinking.addEventListener("url", (e) => {
      detectRecovery(e.url);
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  /* -----------------------------------------------------------------------
     2. RESTORE NAVIGATION STATE
     ----------------------------------------------------------------------- */
  useEffect(() => {
    let active = true;

    const restore = async () => {
      if (!ready) return;

      // Recovery mode → skip restore
      if (isPasswordRecovery) {
        setNavStateReady(true);
        return;
      }

      // No user or incomplete profile → no restore
      if (!userId || !profileComplete) {
        setInitialState(undefined);
        setNavStateReady(true);
        return;
      }

      try {
        const saved = await AsyncStorage.getItem(
          `NAVIGATION_STATE_v2:${userId}`
        );
        if (saved && active) {
          setInitialState(JSON.parse(saved));
        }
      } finally {
        if (active) setNavStateReady(true);
      }
    };

    restore();
    return () => {
      active = false;
    };
  }, [ready, userId, profileComplete, isPasswordRecovery]);

  /* -----------------------------------------------------------------------
     3. SUBSCRIPTION CHECK
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
     4. AUTO SIGN-OUT ON EXPIRATION
     ----------------------------------------------------------------------- */
  useEffect(() => {
    if (userId && expired) {
      supabase.auth.signOut().catch(() => {});
    }
  }, [userId, expired]);

  /* -----------------------------------------------------------------------
     5. CLEAR RECOVERY MODE ON LOGOUT
     ----------------------------------------------------------------------- */
  useEffect(() => {
    if (!userId) {
      setIsPasswordRecovery(false);
      setInitialState(undefined);
    }
  }, [userId]);

  /* -----------------------------------------------------------------------
     6. GLOBAL LOADING STATE
     ----------------------------------------------------------------------- */
  if (!ready || !navStateReady || (userId && isPaid === null)) {
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
     7. NAVIGATION CONTAINER (FULLY FIXED)
     ----------------------------------------------------------------------- */
  return (
    <NavigationContainer
      ref={navigationRef as any}
      linking={linking}
      initialState={initialState}
      onReady={() => {
        // CRITICAL — flush queued navigation
        setNavigatorReady(true);
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {/* Always REGISTER NewPassword */}
        <Stack.Screen name="NewPassword" component={NewPassword} />

        {/* RECOVERY MODE → ONLY NewPassword is visible */}
        {isPasswordRecovery ? null : !userId ? (
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
