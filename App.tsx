// App.tsx
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
// SAFARI DEEP LINK FIX — one-shot override (prevents stale replay)
// ------------------------------------------------------------------
if (Platform.OS === "web") {
  const originalGetInitialURL = Linking.getInitialURL;

  Linking.getInitialURL = async () => {
    const injected =
      typeof window !== "undefined" ? (window as any).__INITIAL_URL__ : null;

    if (injected) {
      console.log("🔗 Safari injected initial URL:", injected);
      try {
        (window as any).__INITIAL_URL__ = null;
      } catch {}
      return injected;
    }

    if (typeof window !== "undefined") return window.location.href;
    return originalGetInitialURL();
  };
}

SplashScreen.preventAutoHideAsync().catch(() => {});

function parseAuthParamsFromUrl(url: string) {
  let code: string | null = null;
  let access_token: string | null = null;
  let refresh_token: string | null = null;
  let type: string | null = null;
  let error_description: string | null = null;

  try {
    const u = new URL(url);

    code = u.searchParams.get("code");
    type = u.searchParams.get("type") || type;
    error_description = u.searchParams.get("error_description");

    const hash = (u.hash || "").replace(/^#/, "");
    if (hash) {
      const hp = new URLSearchParams(hash);
      access_token = hp.get("access_token") || access_token;
      refresh_token = hp.get("refresh_token") || refresh_token;
      type = hp.get("type") || type;
      error_description = hp.get("error_description") || error_description;
    }
  } catch {
    // ignore
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
  // Deep-link handler (Supabase signup confirm + recovery)
  // --------------------------------------------------------------
  const handleDeepLink = useCallback(async (url: string | null) => {
    if (!url) return;

    const { code, access_token, refresh_token, type, error_description } =
      parseAuthParamsFromUrl(url);

    const isSupabaseAuthCallback =
      !!code ||
      !!access_token ||
      !!refresh_token ||
      type === "recovery" ||
      type === "signup";

    if (!isSupabaseAuthCallback) return;

    console.log("🔗 Supabase auth callback detected:", {
      hasCode: !!code,
      hasTokens: !!access_token || !!refresh_token,
      type,
    });

    if (error_description) {
      console.error("Supabase auth callback error:", error_description);
      return;
    }

    // PKCE flow: ?code=...
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(url);
      if (error) {
        console.error("exchangeCodeForSession ERROR:", error.message);
        return;
      }
      console.log("✅ Session exchanged from code");
    }

    // ✅ IMPORTANT FIX:
    // If tokens exist in the URL hash, setSession MUST run on WEB too.
    // Otherwise NewPassword will never be able to update the password.
    if (access_token && refresh_token) {
      const { error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });

      if (error) {
        console.error("setSession ERROR:", error.message);
        return;
      }
      console.log("✅ Session restored from tokens (web + native)");
    }

    // ✅ If this is a recovery link, go to NewPassword.
    // DO NOT clean the URL here — NewPassword needs token_hash/email OR hash tokens.
    if (type === "recovery") {
      console.log("🔐 Recovery link detected → navigating to NewPassword");
      navigate("NewPassword");
      return;
    }

    // Clean URL on web (prevents re-processing) — ONLY for non-recovery flows
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const clean = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, clean);
    }
  }, []);

  // --------------------------------------------------------------
  // PASSWORD_RECOVERY event → NewPassword
  // --------------------------------------------------------------
  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        console.log("🚨 PASSWORD_RECOVERY event received");
        navigate("NewPassword");
      }
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  // --------------------------------------------------------------
  // APP INIT — handle initial URL + prevent fake /reset-password loads
  // --------------------------------------------------------------
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        // ✅ HARD GUARD:
        // If someone loads /reset-password without any recovery tokens, kick to /signin.
        if (Platform.OS === "web" && typeof window !== "undefined") {
          const path = window.location.pathname || "";
          const href = window.location.href || "";

          // include token= too (Supabase verify links use token=)
          const hasRecoveryStuff =
            href.includes("type=recovery") ||
            href.includes("access_token=") ||
            href.includes("refresh_token=") ||
            href.includes("token_hash=") ||
            href.includes("token=") ||
            href.includes("code=");

          if (path.includes("reset-password") && !hasRecoveryStuff) {
            console.log(
              "🛑 Loaded /reset-password without tokens → redirecting to /signin"
            );
            window.location.replace("/signin");
            return; // stop init
          }
        }

        const initialUrl = await Linking.getInitialURL();
        console.log("Initial URL:", initialUrl);

        if (initialUrl) {
          await handleDeepLink(initialUrl);
        }

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

        const sub = Linking.addEventListener("url", async (ev) => {
          await handleDeepLink(ev.url);
        });

        if (mounted) setAppIsReady(true);
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
