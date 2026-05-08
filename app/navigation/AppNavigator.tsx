// app/navigation/AppNavigator.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  NavigationContainer,
  DefaultTheme,
  type InitialState,
  CommonActions,
} from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import { View, ActivityIndicator, Platform } from "react-native";

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

function getAllowCreateProfileFlow() {
  const G = globalThis as any;

  const resetFlowActive = Boolean(
    G.__OVERLOOKED_FORCE_NEW_PASSWORD__ ||
      G.__OVERLOOKED_RECOVERY__ ||
      G.__OVERLOOKED_PASSWORD_RESET_DONE__
  );

  if (resetFlowActive) return false;

  if (G.__OVERLOOKED_EMAIL_CONFIRM__ === true) return true;
  if (G.__OVERLOOKED_MANUAL_SIGN_IN__ === true) return true;
  if (G.__OVERLOOKED_CREATE_PROFILE_ALLOWED__ === true) return true;

  if (Platform.OS === "web" && typeof window !== "undefined") {
    return (
      window.sessionStorage.getItem("overlooked.allowCreateProfile") ===
        "true" ||
      window.sessionStorage.getItem("overlooked.manualSignIn") === "true" ||
      window.sessionStorage.getItem("overlooked.createProfileAllowed") ===
        "true"
    );
  }

  return false;
}

function getPasswordResetFlowActive() {
  const G = globalThis as any;

  return Boolean(
    G.__OVERLOOKED_FORCE_NEW_PASSWORD__ || G.__OVERLOOKED_RECOVERY__
  );
}

function getPasswordResetDone() {
  const G = globalThis as any;

  return Boolean(G.__OVERLOOKED_PASSWORD_RESET_DONE__);
}

function isPublicGuestRoute(routeName?: string | null) {
  return routeName === "PublicProfile" || routeName === "SharedFilm";
}

export default function AppNavigator({
  initialAuthRouteName,
}: {
  initialAuthRouteName: "SignIn" | "CreateProfile";
}) {
  const {
    ready,
    userId,
    profileComplete,
    profileChecked,
    shouldRouteToCreateProfile,
  } = useAuth();

  const [initialState, setInitialState] = useState<InitialState | undefined>();
  const [navReady, setNavReady] = useState(false);

  const hasBootstrappedNavRef = useRef(false);
  const lastAuthSnapshotRef = useRef<string>("");
  const hasHandledPostMountRedirectRef = useRef(false);

  const [isPaid, setIsPaid] = useState<boolean | null>(null);
  const [expired, setExpired] = useState(false);
  const [membershipChecked, setMembershipChecked] = useState(false);
  const lastCheckedUserIdRef = useRef<string | null>(null);

  const G = globalThis as any;

  const isPasswordResetFlow = getPasswordResetFlowActive();
  const isPasswordResetDone = getPasswordResetDone();
  const allowCreateProfileFlow = getAllowCreateProfileFlow();

  useEffect(() => {
    let mounted = true;

    const restoreNav = async () => {
      if (!ready) return;

      setInitialState(undefined);

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

  const handleStateChange = async () => {
    return;
  };

  useEffect(() => {
    if (!ready) return;
    setInitialState(undefined);
  }, [ready, userId, profileComplete, shouldRouteToCreateProfile]);

  useEffect(() => {
    const runRedirectLogic = async () => {
      if (!ready || !navReady) return;
      if (!navigationRef.isReady()) return;
      if (!hasBootstrappedNavRef.current) return;

      const currentRoute = navigationRef.getCurrentRoute();
      const currentRouteName = currentRoute?.name;

      if (currentRouteName === "WorkshopSubmit") {
        return;
      }

      const resetFlowActive =
        G.__OVERLOOKED_FORCE_NEW_PASSWORD__ ||
        G.__OVERLOOKED_RECOVERY__ ||
        currentRouteName === "NewPassword";

      const resetDone = G.__OVERLOOKED_PASSWORD_RESET_DONE__ === true;

      const createProfileAllowed =
        G.__OVERLOOKED_EMAIL_CONFIRM__ === true ||
        G.__OVERLOOKED_MANUAL_SIGN_IN__ === true ||
        G.__OVERLOOKED_CREATE_PROFILE_ALLOWED__ === true ||
        (Platform.OS === "web" &&
          typeof window !== "undefined" &&
          (window.sessionStorage.getItem("overlooked.allowCreateProfile") ===
            "true" ||
            window.sessionStorage.getItem("overlooked.manualSignIn") ===
              "true" ||
            window.sessionStorage.getItem(
              "overlooked.createProfileAllowed"
            ) === "true"));

      const resetToAuth = () => {
        navigationRef.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [
              {
                name: "Auth",
                params: {
                  screen: "SignIn",
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

      if (resetDone) {
        G.__OVERLOOKED_EMAIL_CONFIRM__ = false;
        G.__OVERLOOKED_RECOVERY__ = false;
        G.__OVERLOOKED_FORCE_NEW_PASSWORD__ = false;
        G.__OVERLOOKED_PASSWORD_RESET_DONE__ = false;
        G.__OVERLOOKED_MANUAL_SIGN_IN__ = false;
        G.__OVERLOOKED_CREATE_PROFILE_ALLOWED__ = false;

        if (Platform.OS === "web" && typeof window !== "undefined") {
          window.sessionStorage.removeItem("overlooked.allowCreateProfile");
          window.sessionStorage.removeItem("overlooked.manualSignIn");
          window.sessionStorage.removeItem("overlooked.createProfileAllowed");
          window.sessionStorage.setItem("overlooked.justResetPassword", "true");
        }

        resetToAuth();
        return;
      }

      if (resetFlowActive) {
        return;
      }

      /**
       * PUBLIC GUEST ROUTES
       *
       * These routes must be visible without signing in:
       * - /creative/:slug → PublicProfile
       * - /f/:shareSlug → SharedFilm
       *
       * This is what makes shared film links behave like public portfolio links.
       */
      if (!userId) {
        if (isPublicGuestRoute(currentRouteName)) {
          return;
        }

        resetToAuth();
        return;
      }

      /**
       * IMPORTANT:
       * Do not make any decision until AuthProvider has actually checked the profile.
       */
      if (!profileChecked) {
        return;
      }

      /**
       * Profile is incomplete.
       */
      if (!profileComplete) {
        const latestRoute = navigationRef.getCurrentRoute();
        const latestRouteName = latestRoute?.name;

        if (G.__OVERLOOKED_PROFILE_JUST_COMPLETED__) {
          resetToMainTabs();
          return;
        }

        if (latestRouteName === "CreateProfile") {
          return;
        }

        /**
         * A signed-in confirmed user with no profile should go to CreateProfile.
         * Do NOT sign them out here.
         */
        resetToCreateProfile();
        return;
      }

      /**
       * Profile is complete. Now and only now clear create-profile permissions.
       */
      G.__OVERLOOKED_EMAIL_CONFIRM__ = false;
      G.__OVERLOOKED_MANUAL_SIGN_IN__ = false;
      G.__OVERLOOKED_CREATE_PROFILE_ALLOWED__ = false;

      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.sessionStorage.removeItem("overlooked.allowCreateProfile");
        window.sessionStorage.removeItem("overlooked.manualSignIn");
        window.sessionStorage.removeItem("overlooked.createProfileAllowed");
      }

      /**
       * Signed-in users should also be allowed to stay on public routes.
       * This prevents opening a shared film while signed in from instantly resetting
       * back to MainTabs.
       */
      const alreadyInsideAllowedAppRoute =
        currentRouteName === "MainTabs" ||
        currentRouteName === "Featured" ||
        currentRouteName === "Workshop" ||
        currentRouteName === "WorkshopSubmit" ||
        currentRouteName === "Challenge" ||
        currentRouteName === "Location" ||
        currentRouteName === "Jobs" ||
        currentRouteName === "Chats" ||
        currentRouteName === "Profile" ||
        currentRouteName === "PublicProfile" ||
        currentRouteName === "SharedFilm";

      if (!alreadyInsideAllowedAppRoute) {
        resetToMainTabs();
      }
    };

    void runRedirectLogic();
  }, [
    ready,
    navReady,
    userId,
    profileComplete,
    profileChecked,
    shouldRouteToCreateProfile,
    initialAuthRouteName,
  ]);

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
  }, [userId, isPaid]);

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

  /**
   * IMPORTANT:
   * CreateProfile can only be the initial route if create-profile flow is allowed.
   * shouldRouteToCreateProfile alone is NOT enough.
   */
  const rootInitialRouteName =
    isPasswordResetFlow
      ? "NewPassword"
      : isPasswordResetDone
      ? "Auth"
      : !userId
      ? "Auth"
      : G.__OVERLOOKED_PROFILE_JUST_COMPLETED__
      ? "MainTabs"
      : !profileChecked
      ? "Auth"
      : !profileComplete && allowCreateProfileFlow
      ? "CreateProfile"
      : !profileComplete && !allowCreateProfileFlow
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
          if (
            (globalThis as any).__OVERLOOKED_FORCE_NEW_PASSWORD__ ||
            (globalThis as any).__OVERLOOKED_RECOVERY__
          ) {
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
          children={() => <AuthStack initialRouteName="SignIn" />}
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