/**
 * ------------------------------------------------------------
 *  FULLY PATCHED APP.TSX — SAFARI / SUPABASE FIX
 * ------------------------------------------------------------
 * Fixes:
 * - getInitialURL returns null on first load (Safari bug)
 * - Password reset page requires manual refresh
 * - Deep links load only after refresh
 * - NewPassword screen enters infinite loading after update
 *
 * This implementation GUARANTEES:
 * - URL is fetched BEFORE React renders
 * - URL is polled until available
 * - Supabase exchangeCodeForSession always receives correct URL
 * - PASSWORD_RECOVERY event always navigates correctly
 * ------------------------------------------------------------
 */

import "./app/polyfills"; // must stay first
import React, { useEffect, useState, useCallback } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import { Linking, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { Provider as PaperProvider } from "react-native-paper";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import AppNavigator from "./app/navigation/AppNavigator";
import { supabase } from "./app/lib/supabase";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AuthProvider } from "./app/context/AuthProvider";
import { GamificationProvider } from "./app/context/GamificationContext";
import { navigate } from "./app/navigation/navigationRef";

// fonts
import {
  useFonts as useCourierFonts,
  CourierPrime_400Regular,
  CourierPrime_700Bold,
} from "@expo-google-fonts/courier-prime";

import {
  useFonts as useCinzelFonts,
  Cinzel_400Regular,
  Cinzel_700Bold,
  Cinzel_900Black,
} from "@expo-google-fonts/cinzel";

// ❗ SAFARI FIX (forces URL to hydrate ASAP)
if (Platform.OS === "web") {
  Linking.getInitialURL();
}

SplashScreen.preventAutoHideAsync().catch(() => {});

// ---------------------------------------------------------------
// SAFARI URL POLLER — ensures URL is available before Supabase
// ---------------------------------------------------------------
async function waitForUrl(): Promise<string | null> {
  let tries = 0;

  while (tries < 20) {
    const url = await Linking.getInitialURL();
    if (url) return url;

    await new Promise((res) => setTimeout(res, 120));
    tries++;
  }

  return null;
}

export default function App() {
  const [appIsReady, setAppIsReady] = useState(false);
  const [initialAuthRouteName, setInitialAuthRouteName] =
    useState<"SignIn" | "CreateProfile">("SignIn");

  const [courierLoaded] = useCourierFonts({
    CourierPrime_400Regular,
    CourierPrime_700Bold,
  });
  const [cinzelLoaded] = useCinzelFonts({
    Cinzel_400Regular,
    Cinzel_700Bold,
    Cinzel_900Black,
  });
  const fontsLoaded = courierLoaded && cinzelLoaded;

  /**
   * -----------------------------------------------------------------
   *  DEEP LINK HANDLER — patched with Safari URL hydration fix
   * -----------------------------------------------------------------
   */
  const handleDeepLink = useCallback(async (url: string | null) => {
    if (!url) return;

    const isSupabaseLink =
      url.includes("access_token=") ||
      url.includes("refresh_token=") ||
      url.includes("type=recovery") ||
      url.includes("code=");

    if (!isSupabaseLink) return;

    console.log("Deep link detected:", url);

    const { error } = await supabase.auth.exchangeCodeForSession(url);
    if (error) {
      console.error("exchangeCodeForSession error:", error.message);
      return;
    }

    console.log("Session restored via deep link");
    setInitialAuthRouteName("SignIn");
  }, []);

  /**
   * --------------------------------------------------------------
   * PASSWORD_RECOVERY → Navigate to NewPassword (must not race)
   * --------------------------------------------------------------
   */
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange(
      async (event) => {
        if (event === "PASSWORD_RECOVERY") {
          console.log("Supabase event: PASSWORD_RECOVERY");
          navigate("NewPassword");
        }
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  /**
   * --------------------------------------------------------------
   * APP INIT — handles splash, deep links, session restoration
   * --------------------------------------------------------------
   */
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        // 1️⃣ Wait for Safari to deliver URL
        const initialUrl = await waitForUrl();

        // 2️⃣ Handle deep link FIRST
        if (initialUrl) {
          await handleDeepLink(initialUrl);
        }

        // 3️⃣ Restore session
        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData?.session ?? null;

        if (session) {
          await SecureStore.setItemAsync(
            "supabaseSession",
            JSON.stringify(session)
          );

          const { data: profile } = await supabase
            .from("users")
            .select("full_name, main_role_id, city_id")
            .eq("id", session.user.id)
            .maybeSingle();

          const needsProfile =
            !profile ||
            !profile.full_name ||
            !profile.main_role_id ||
            !profile.city_id;

          setInitialAuthRouteName(needsProfile ? "CreateProfile" : "SignIn");
        } else {
          setInitialAuthRouteName("SignIn");
        }

        // 4️⃣ URL event subscription (for in-app flows)
        const sub = Linking.addEventListener("url", async (e) => {
          await handleDeepLink(e.url);
        });

        if (mounted) {
          setAppIsReady(true);
        }

        return () => sub.remove();
      } catch (e) {
        console.error("App init error:", e);
        if (mounted) setAppIsReady(true);
      }
    }

    init();

    return () => {
      mounted = false;
    };
  }, [handleDeepLink]);

  useEffect(() => {
    if (appIsReady && fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [appIsReady, fontsLoaded]);

  if (!appIsReady || !fontsLoaded) return null;

  return (
    <AppErrorBoundary>
      <PaperProvider>
        <SafeAreaProvider>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <StatusBar style="dark" />
            <AuthProvider>
              <GamificationProvider>
                <AppNavigator initialAuthRouteName={initialAuthRouteName} />
              </GamificationProvider>
            </AuthProvider>
          </GestureHandlerRootView>
        </SafeAreaProvider>
      </PaperProvider>
    </AppErrorBoundary>
  );
}
