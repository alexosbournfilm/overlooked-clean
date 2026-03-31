// App.tsx
import "./app/polyfills"; // must stay first
import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Linking, Platform } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
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

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(url);
      if (error) {
        console.error("exchangeCodeForSession ERROR:", error.message);
        return;
      }
      console.log("✅ Session exchanged from code");
    }

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

    if (type === "recovery") {
      console.log("🔐 Recovery link detected → navigating to NewPassword");
      navigate("NewPassword");
      return;
    }

    if (Platform.OS === "web" && typeof window !== "undefined") {
      const clean = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, clean);
    }
  }, []);

  // --------------------------------------------------------------
  // PASSWORD_RECOVERY event → NewPassword
  // --------------------------------------------------------------
  const recoveryNavArmedRef = useRef(true);

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        if (!recoveryNavArmedRef.current) return;
        recoveryNavArmedRef.current = false;

        console.log("🚨 PASSWORD_RECOVERY event received");
        navigate("NewPassword");

        setTimeout(() => {
          recoveryNavArmedRef.current = true;
        }, 800);
      }
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  // --------------------------------------------------------------
  // APP INIT — handle initial URL + prevent fake /reset-password loads
  // --------------------------------------------------------------
  useEffect(() => {
    let mounted = true;
    let linkSub: { remove: () => void } | null = null;

    async function init() {
      try {
        if (Platform.OS === "web" && typeof window !== "undefined") {
          const path = window.location.pathname || "";
          const href = window.location.href || "";

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
            return;
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

          const meta: any = (session.user as any)?.user_metadata || {};
          const metaHasProfileBits =
            !!meta?.full_name && !!meta?.main_role_id && !!meta?.city_id;

          if (metaHasProfileBits) {
            setInitialAuthRouteName("SignIn");
          } else {
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
          }
        } else {
          setInitialAuthRouteName("SignIn");
        }

        linkSub = Linking.addEventListener("url", async (ev) => {
          await handleDeepLink(ev.url);
        });

        if (mounted) setAppIsReady(true);
      } catch (err) {
        console.error("INIT ERROR:", err);
        if (mounted) setAppIsReady(true);
      }
    }

    init();

    return () => {
      mounted = false;
      linkSub?.remove();
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

  // ✅ DO NOT return null — keep startup black
  if (!appIsReady || !fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0D0D0D" }}>
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#0D0D0D" }}>
      <AppErrorBoundary>
        <PaperProvider>
          <SafeAreaProvider>
            <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#0D0D0D" }}>
              <StatusBar style="light" />
              <AuthProvider>
                <GamificationProvider>
                  <AppNavigator initialAuthRouteName={initialAuthRouteName} />
                </GamificationProvider>
              </AuthProvider>
            </GestureHandlerRootView>
          </SafeAreaProvider>
        </PaperProvider>
      </AppErrorBoundary>
    </View>
  );
}