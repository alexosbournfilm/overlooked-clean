// App.tsx
/**
 * ------------------------------------------------------------
 *  FINAL APP.TSX — SAFARI + SUPABASE AUTH CALLBACK FIX (SIGNUP + RECOVERY)
 * ------------------------------------------------------------
 * Fixes:
 * - Safari not passing deep link on first load
 * - Blank white screen until refresh
 * - Password reset link not opening NewPassword
 * - getInitialURL() returning null
 * - ✅ Email confirmation links (?code=... / type=signup) not being handled
 *
 * Uses:
 * - index.html injects window.__INITIAL_URL__
 * - This file overrides Linking.getInitialURL() on web
 * - Handles BOTH:
 *    - PKCE links: ?code=...
 *    - Legacy token links: #access_token=...&refresh_token=...
 * - Cleans URL on web to prevent re-processing and bad routing
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

// ------------------------------------------------------------------
// SAFARI DEEP LINK FIX — override Linking.getInitialURL to use injected URL
// ------------------------------------------------------------------
if (Platform.OS === "web") {
  const injected =
    typeof window !== "undefined" ? (window as any).__INITIAL_URL__ : null;

  if (injected) {
    console.log("🔗 Safari injected initial URL:", injected);

    // Override getInitialURL so React Navigation receives the correct URL
    Linking.getInitialURL = async () => injected;
  }
}

SplashScreen.preventAutoHideAsync().catch(() => {});

function parseAuthParamsFromUrl(url: string) {
  // Supports:
  // - PKCE: ?code=...
  // - Legacy: #access_token=...&refresh_token=...&type=recovery|signup
  let code: string | null = null;
  let access_token: string | null = null;
  let refresh_token: string | null = null;
  let type: string | null = null;
  let error_description: string | null = null;

  try {
    // Best effort parse
    const u = new URL(url);

    // Query params (PKCE / error)
    code = u.searchParams.get("code");
    type = u.searchParams.get("type") || type;
    error_description = u.searchParams.get("error_description");

    // Hash params (legacy)
    const hash = (u.hash || "").replace(/^#/, "");
    if (hash) {
      const hp = new URLSearchParams(hash);
      access_token = hp.get("access_token") || access_token;
      refresh_token = hp.get("refresh_token") || refresh_token;
      type = hp.get("type") || type;
      error_description = hp.get("error_description") || error_description;
    }
  } catch {
    // Fallback for non-standard URLs
    const hasHash = url.includes("#");
    const [base, hashPart] = url.split("#");
    try {
      const u2 = new URL(base);
      code = u2.searchParams.get("code");
      type = u2.searchParams.get("type") || type;
      error_description = u2.searchParams.get("error_description");
    } catch {}

    if (hasHash && hashPart) {
      const hp = new URLSearchParams(hashPart);
      access_token = hp.get("access_token") || access_token;
      refresh_token = hp.get("refresh_token") || refresh_token;
      type = hp.get("type") || type;
      error_description = hp.get("error_description") || error_description;
    }
  }

  return { code, access_token, refresh_token, type, error_description };
}

export default function App() {
  const [appIsReady, setAppIsReady] = useState(false);
  const [initialAuthRouteName, setInitialAuthRouteName] =
    useState<"SignIn" | "CreateProfile">("SignIn");

  // Load fonts
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

  // --------------------------------------------------------------
  // Proper deep-link handler (Supabase signup confirm + recovery)
  // --------------------------------------------------------------
  const handleDeepLink = useCallback(async (url: string | null) => {
    if (!url) return;

    const { code, access_token, refresh_token, type, error_description } =
      parseAuthParamsFromUrl(url);

    const isSupabaseAuthCallback =
      !!code ||
      !!access_token ||
      !!refresh_token ||
      (type === "recovery") ||
      (type === "signup");

    if (!isSupabaseAuthCallback) return;

    console.log("🔗 Supabase auth callback detected:", {
      url,
      hasCode: !!code,
      hasTokens: !!access_token || !!refresh_token,
      type,
    });

    if (error_description) {
      console.error("Supabase auth callback error:", error_description);
      return;
    }

    // 1) PKCE flow (modern): ?code=...
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(url);
      if (error) {
        console.error("exchangeCodeForSession ERROR:", error.message);
        return;
      }
      console.log("✅ Session exchanged from code");
    }

    // 2) Legacy token flow: #access_token=...&refresh_token=...
    // On native, detectSessionInUrl is false, so we set the session explicitly if tokens exist.
    if (access_token && refresh_token && Platform.OS !== "web") {
      const { error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });

      if (error) {
        console.error("setSession ERROR:", error.message);
        return;
      }

      console.log("✅ Session restored from legacy tokens");
    }

    // IMPORTANT: clean URL on web so linking doesn't keep re-processing / mis-route
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const clean = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, clean);
    }
  }, []);

  // --------------------------------------------------------------
  // Supabase PASSWORD_RECOVERY event → navigate to NewPassword
  // --------------------------------------------------------------
  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange(
      async (event) => {
        if (event === "PASSWORD_RECOVERY") {
          console.log("🚨 PASSWORD_RECOVERY event received");
          navigate("NewPassword");
        }
      }
    );

    return () => subscription.subscription.unsubscribe();
  }, []);

  // --------------------------------------------------------------
  // APP INIT — handle initial deep link + session restore
  // --------------------------------------------------------------
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        // 1️⃣ Get initial URL (Safari-safe)
        const initialUrl = await Linking.getInitialURL();
        console.log("Initial URL:", initialUrl);

        if (initialUrl) {
          await handleDeepLink(initialUrl);
        }

        // 2️⃣ Restore session
        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData?.session ?? null;

        if (session) {
          await SecureStore.setItemAsync(
            "supabaseSession",
            JSON.stringify(session)
          );

          // Load profile completeness
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

        // 3️⃣ Listen for in-app deep links
        const sub = Linking.addEventListener("url", async (ev) => {
          await handleDeepLink(ev.url);
        });

        if (mounted) {
          setAppIsReady(true);
        }

        return () => sub.remove();
      } catch (err) {
        console.error("INIT ERROR:", err);
        if (mounted) setAppIsReady(true);
      }
    }

    init();
    return () => {
      mounted = false;
    };
  }, [handleDeepLink]);

  // --------------------------------------------------------------
  // Splash screen final hide
  // --------------------------------------------------------------
  useEffect(() => {
    if (appIsReady && fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [appIsReady, fontsLoaded]);

  if (!appIsReady || !fontsLoaded) return null;

  // --------------------------------------------------------------
  // RENDER APP
  // --------------------------------------------------------------
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
