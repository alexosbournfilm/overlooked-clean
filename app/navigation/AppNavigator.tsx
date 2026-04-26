import React, { useEffect, useRef, useState } from "react";
import {
  NavigationContainer,
  DefaultTheme,
  type InitialState,
  CommonActions,
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
import CreateProfileScreen from "../screens/CreateProfileScreen";

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
  const { ready, userId, profileComplete, shouldRouteToCreateProfile } =
    useAuth();

  const [initialState, setInitialState] = useState<InitialState | undefined>();
  const [navReady, setNavReady] = useState(false);

  const hasBootstrappedNavRef = useRef(false);
  const lastAuthSnapshotRef = useRef<string>("");
  const hasHandledPostMountRedirectRef = useRef(false);

  const G = globalThis as any;

  useEffect(() => {
    let mounted = true;

    const restoreNav = async () => {
      if (!ready) return;

      if (!userId || !profileComplete || shouldRouteToCreateProfile) {
        setInitialState(undefined);
        if (mounted) {
          setNavReady(true);
          hasBootstrappedNavRef.current = true;
        }
        return;
      }

      try {
        const savedState = await AsyncStorage.getItem(
          `NAVIGATION_STATE_v2:${userId}`
        );

        if (savedState && mounted) {
          setInitialState(JSON.parse(savedState));
        }
      } catch (e) {
        console.log("Failed to restore navigation state:", e);
      }

      if (mounted) {
        setNavReady(true);
        hasBootstrappedNavRef.current = true;
      }
    };

    restoreNav();

    return () => {
      mounted = false;
    };
  }, [ready, userId, profileComplete, shouldRouteToCreateProfile]);

  const handleStateChange = async (state?: InitialState) => {
    if (!userId || !profileComplete || !state) return;

    try {
      await AsyncStorage.setItem(
        `NAVIGATION_STATE_v2:${userId}`,
        JSON.stringify(state)
      );
    } catch (e) {
      console.log("Failed to persist navigation state:", e);
    }
  };

  useEffect(() => {
    if (!ready) return;

    if (!userId) {
      setInitialState(undefined);
      return;
    }

    if (!profileComplete || shouldRouteToCreateProfile) {
      setInitialState(undefined);
    }
  }, [ready, userId, profileComplete, shouldRouteToCreateProfile]);

  useEffect(() => {
    if (!ready || !navReady) return;
    if (!navigationRef.isReady()) return;
    if (!hasBootstrappedNavRef.current) return;

    const currentRoute = navigationRef.getCurrentRoute();

    if (currentRoute?.name === "NewPassword") {
      return;
    }

    const authSnapshot = `${userId ?? "guest"}:${
      profileComplete ? "complete" : "incomplete"
    }:${shouldRouteToCreateProfile ? "createprofile" : "normal"}:${
      G.__OVERLOOKED_EMAIL_CONFIRM__ ? "emailconfirm" : "noemailconfirm"
    }`;

    const prevSnapshot = lastAuthSnapshotRef.current;
    lastAuthSnapshotRef.current = authSnapshot;

    if (!hasHandledPostMountRedirectRef.current) {
      hasHandledPostMountRedirectRef.current = true;
      return;
    }

    if (prevSnapshot === authSnapshot) return;

    const resetToAuth = () => {
      navigationRef.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [
            {
              name: "Auth",
              params: {
                screen: initialAuthRouteName,
              },
            },
          ],
        })
      );
    };

    const resetToCreateProfile = () => {
      navigationRef.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: "CreateProfile" as never }],
        })
      );
    };

    const resetToMainTabs = () => {
      navigationRef.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: "MainTabs" }],
        })
      );
    };

    if (!userId) {
      resetToAuth();
      return;
    }

    if (shouldRouteToCreateProfile) {
      resetToCreateProfile();
      return;
    }

    if (!profileComplete) {
      resetToAuth();
      return;
    }

    if (G.__OVERLOOKED_EMAIL_CONFIRM__) {
      G.__OVERLOOKED_EMAIL_CONFIRM__ = false;
    }

    resetToMainTabs();
  }, [
    ready,
    navReady,
    userId,
    profileComplete,
    shouldRouteToCreateProfile,
    initialAuthRouteName,
  ]);

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
  }, [userId]);

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

  const rootInitialRouteName = (globalThis as any).__OVERLOOKED_FORCE_NEW_PASSWORD__
  ? "NewPassword"
  : !userId
  ? "Auth"
  : shouldRouteToCreateProfile
  ? "CreateProfile"
  : !profileComplete
  ? "Auth"
  : mustShowPaywall
  ? "Paywall"
  : "MainTabs";

  return (
    <NavigationContainer
      ref={navigationRef as any}
      linking={linking}
      initialState={initialState}
      onReady={() => {
  setNavigatorReady(true);
  setNavReady(true);

  setTimeout(() => {
    if ((globalThis as any).__OVERLOOKED_FORCE_NEW_PASSWORD__) {
      (globalThis as any).__OVERLOOKED_FORCE_NEW_PASSWORD__ = false;
      navigationRef.navigate("NewPassword" as never);
    }
  }, 500);
}}
      onStateChange={handleStateChange}
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
              initialRouteName={!userId ? initialAuthRouteName : "SignIn"}
            />
          )}
        />

        <Stack.Screen name="CreateProfile" component={CreateProfileScreen} />
        <Stack.Screen name="MainTabs" component={MainTabs} />

        {mustShowPaywall && (
          <Stack.Screen name="PaywallGate" component={PaywallScreen} />
        )}

        <Stack.Screen
          name="WorkshopSubmit"
          component={WorkshopSubmitScreen}
        />

        <Stack.Screen name="PublicProfile" component={PublicProfileScreen} />

        <Stack.Screen name="SharedFilm" component={SharedFilmScreen} />

        <Stack.Screen name="NewPassword" component={NewPassword} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}