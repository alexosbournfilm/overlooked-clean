// App.tsx
import "./app/polyfills"; // must stay first
import React, { useEffect, useState, useCallback, useRef } from "react";
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

    // ✅ IMPORTANT: clear it so we don't keep reusing a stale URL later
    try {
      (window as any).__INITIAL_URL__ = null;
    } catch {}
  }
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

  // ✅ Only navigate to NewPassword if we actually just handled a recovery link
  const recoveryLinkSeenRef = useRef(false);

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

    // ✅ Mark recovery link ONLY when type=recovery
    recoveryLinkSeenRef.current = type === "recovery";

    // 1) PKCE flow: ?code=...
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(url);
      if (error) {
        console.error("exchangeCodeForSession ERROR:", error.message);
        return;
      }
      console.log("✅ Session exchanged from code");
    }

    // 2) Legacy token flow: #access_token=...&refresh_token=...
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

    // ✅ Clean URL on web so linking doesn’t re-process / mis-route
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const clean = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, clean);
    }
  }, []);

  // --------------------------------------------------------------
  // Supabase PASSWORD_RECOVERY event → navigate to NewPassword (guarded)
  // --------------------------------------------------------------
  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange(
      async (event) => {
        if (event === "PASSWORD_RECOVERY") {
          // ✅ Only navigate if we *actually* just opened a recovery link
          if (recoveryLinkSeenRef.current) {
            console.log("🚨 PASSWORD_RECOVERY event received (from recovery link)");
            navigate("NewPassword");
            // One-shot
            recoveryLinkSeenRef.current = false;
          } else {
            console.log(
              "ℹ️ PASSWORD_RECOVERY event ignored (not from a recovery link)"
            );
          }
          return;
        }

        // Any normal auth event should clear the recovery flag
        if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "SIGNED_OUT") {
          recoveryLinkSeenRef.current = false;
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
