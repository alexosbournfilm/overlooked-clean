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
import * as Notifications from "expo-notifications";

import AppNavigator from "./app/navigation/AppNavigator";
import { supabase } from "./app/lib/supabase";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AuthProvider } from "./app/context/AuthProvider";
import { AppRefreshProvider } from "./app/context/AppRefreshContext";
import { GamificationProvider } from "./app/context/GamificationContext";
import { navigate } from "./app/navigation/navigationRef";
import { registerAndSavePushToken } from "./app/lib/registerAndSavePushToken";

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

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

SplashScreen.preventAutoHideAsync().catch(() => {});

function parseAuthParamsFromUrl(url: string) {
  let code: string | null = null;
  let access_token: string | null = null;
  let refresh_token: string | null = null;
  let type: string | null = null;
  let error_description: string | null = null;
  let token_hash: string | null = null;

  try {
    const u = new URL(url);

    code = u.searchParams.get("code");
    type = u.searchParams.get("type") || type;
    error_description = u.searchParams.get("error_description");
    token_hash = u.searchParams.get("token_hash");

    const hash = (u.hash || "").replace(/^#/, "");
    if (hash) {
      const hp = new URLSearchParams(hash);
      access_token = hp.get("access_token") || access_token;
      refresh_token = hp.get("refresh_token") || refresh_token;
      type = hp.get("type") || type;
      error_description = hp.get("error_description") || error_description;
      token_hash = hp.get("token_hash") || token_hash;
    }
  } catch {
    // ignore
  }

  return {
    code,
    access_token,
    refresh_token,
    type,
    error_description,
    token_hash,
  };
}

function markPasswordResetFlow() {
  (globalThis as any).__OVERLOOKED_FORCE_NEW_PASSWORD__ = true;
  (globalThis as any).__OVERLOOKED_RECOVERY__ = true;
  (globalThis as any).__OVERLOOKED_EMAIL_CONFIRM__ = false;
  (globalThis as any).__OVERLOOKED_PASSWORD_RESET_DONE__ = false;
}

function markSignupConfirmFlow() {
  (globalThis as any).__OVERLOOKED_FORCE_NEW_PASSWORD__ = false;
  (globalThis as any).__OVERLOOKED_RECOVERY__ = false;
  (globalThis as any).__OVERLOOKED_EMAIL_CONFIRM__ = true;
  (globalThis as any).__OVERLOOKED_PASSWORD_RESET_DONE__ = false;
}

function isAllowedEmailConfirmCreateProfileFlow() {
  return Boolean((globalThis as any).__OVERLOOKED_EMAIL_CONFIRM__);
}

async function isCurrentUserProfileComplete(userId: string) {
  const { data: profile, error } = await supabase
    .from("users")
    .select("id, full_name, main_role_id, city_id")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.log("Profile startup check error:", error.message);
    return false;
  }

  return Boolean(
    profile?.id &&
      profile?.full_name &&
      profile?.main_role_id &&
      profile?.city_id
  );
}

async function forceSignInForIncompleteProfile(reason: string) {
  console.log(`🛑 Incomplete profile blocked from startup: ${reason}`);

  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.log("Sign out during incomplete-profile cleanup failed:", e);
  }

  try {
    if (Platform.OS !== "web") {
      await SecureStore.deleteItemAsync("supabaseSession");
    }
  } catch {}

  (globalThis as any).__OVERLOOKED_FORCE_NEW_PASSWORD__ = false;
  (globalThis as any).__OVERLOOKED_RECOVERY__ = false;
  (globalThis as any).__OVERLOOKED_PASSWORD_RESET_DONE__ = false;
}

export default function App() {
  const [appIsReady, setAppIsReady] = useState(false);

  /**
   * Keep the prop type compatible with your AppNavigator,
   * but do not use CreateProfile as an initial auth route anymore.
   */
  const [initialAuthRouteName, setInitialAuthRouteName] =
    useState<"SignIn" | "CreateProfile">("SignIn");

  const notificationListener = useRef<any>(null);
  const responseListener = useRef<any>(null);

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

  const savePushTokenForUser = useCallback(async (userId: string) => {
    try {
      if (Platform.OS === "web") return;
      await registerAndSavePushToken(userId);
    } catch (err: any) {
      console.error("❌ Push token save failed:", err?.message || err);
    }
  }, []);

  const handleDeepLink = useCallback(async (url: string | null) => {
    if (!url) return;

    const lowerUrl = url.toLowerCase();

    const isResetPasswordLink =
      lowerUrl.includes("reset-password") ||
      lowerUrl.includes("new-password") ||
      lowerUrl.includes("newpassword") ||
      lowerUrl.includes("type=recovery");

    const {
      code,
      access_token,
      refresh_token,
      type,
      error_description,
      token_hash,
    } = parseAuthParamsFromUrl(url);

    const isSupabaseAuthCallback =
      !!code ||
      !!access_token ||
      !!refresh_token ||
      !!token_hash ||
      type === "recovery" ||
      type === "signup" ||
      isResetPasswordLink;

    if (!isSupabaseAuthCallback) return;

    console.log("🔗 Supabase auth callback detected:", {
      hasCode: !!code,
      hasTokens: !!access_token || !!refresh_token,
      hasTokenHash: !!token_hash,
      type,
      isResetPasswordLink,
    });

    if (error_description) {
      console.error("Supabase auth callback error:", error_description);
      return;
    }

    /**
     * CRITICAL FIX:
     *
     * Password reset must be handled ONLY by NewPassword.tsx.
     *
     * Do NOT exchange the recovery code here.
     * Do NOT call setSession here.
     *
     * Store the original reset URL so NewPassword.tsx can read it.
     * This prevents the reset token/code from being lost during navigation.
     */
    if (isResetPasswordLink || type === "recovery") {
      console.log("🔐 Reset password link detected → NewPassword owns this flow");

      (globalThis as any).__OVERLOOKED_RESET_URL__ = url;

      markPasswordResetFlow();
      setInitialAuthRouteName("SignIn");

      setTimeout(() => {
        try {
          navigate("NewPassword");
        } catch (e) {
          console.log("NewPassword navigation skipped:", e);
        }
      }, 300);

      return;
    }

    /**
     * Signup confirmation is allowed to create a session here.
     * Password recovery is not.
     */
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(url);

      if (error) {
        console.error("exchangeCodeForSession ERROR:", error.message);
        return;
      }

      console.log("✅ Signup session exchanged from code");
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

      console.log("✅ Session restored from tokens");
    }

    if (type === "signup") {
      console.log("✅ Signup confirmation link detected");
      markSignupConfirmFlow();
      setInitialAuthRouteName("SignIn");
    }

    if (Platform.OS === "web" && typeof window !== "undefined") {
      const clean = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, clean);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;

    const handleNotificationNavigation = (data: any) => {
      if (data?.screen) {
        try {
          navigate(data.screen, data.params || {});
        } catch (err) {
          console.log("Navigation from notification failed:", err);
        }
      }
    };

    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        console.log("📩 Notification received:", notification);
      });

    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        console.log("👆 Notification tapped:", response);

        const data = response.notification.request.content.data as any;
        handleNotificationNavigation(data);
      });

    (async () => {
      try {
        const lastResponse =
          await Notifications.getLastNotificationResponseAsync();

        if (lastResponse) {
          console.log("🚀 App opened from notification:", lastResponse);

          const data = lastResponse.notification.request.content.data as any;
          handleNotificationNavigation(data);
        }
      } catch (err) {
        console.log("Failed to get last notification response:", err);
      }
    })();

    return () => {
      notificationListener.current?.remove?.();
      responseListener.current?.remove?.();
    };
  }, []);

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

          /**
           * Mark recovery before any session/profile checks.
           * This protects AppNavigator/AuthProvider during first render.
           */
          if (
            href.toLowerCase().includes("reset-password") ||
            href.toLowerCase().includes("type=recovery")
          ) {
            markPasswordResetFlow();

            /**
             * Store web reset URL too, in case NewPassword needs it.
             */
            (globalThis as any).__OVERLOOKED_RESET_URL__ = href;
          }
        }

        const initialUrl = await Linking.getInitialURL();
        console.log("Initial URL:", initialUrl);

        if (initialUrl) {
          await handleDeepLink(initialUrl);
        }

        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData?.session ?? null;

        /**
         * Do not treat a recovery session as a normal logged-in session here.
         * It belongs to NewPassword.tsx.
         */
        const isPasswordResetFlow =
          (globalThis as any).__OVERLOOKED_FORCE_NEW_PASSWORD__ ||
          (globalThis as any).__OVERLOOKED_RECOVERY__ ||
          (globalThis as any).__OVERLOOKED_PASSWORD_RESET_DONE__;

        const isEmailConfirmFlow = isAllowedEmailConfirmCreateProfileFlow();

        /**
         * IMPORTANT FIX:
         *
         * If the app opens with an old saved session and the profile is incomplete,
         * do NOT allow AppNavigator/AuthProvider to send the user to CreateProfile.
         *
         * Only a real email confirmation flow can continue toward CreateProfile.
         */
        if (session && !isPasswordResetFlow) {
          const profileComplete = await isCurrentUserProfileComplete(
            session.user.id
          );

          if (!profileComplete && !isEmailConfirmFlow) {
            await forceSignInForIncompleteProfile(
              "cold app open with stale incomplete session"
            );
            setInitialAuthRouteName("SignIn");
          } else {
            try {
              if (Platform.OS !== "web") {
                await SecureStore.setItemAsync(
                  "supabaseSession",
                  JSON.stringify(session)
                );
              }
            } catch {}

            if (Platform.OS !== "web") {
              savePushTokenForUser(session.user.id).catch((err) => {
                console.log("Push token save skipped:", err?.message || err);
              });
            }

            setInitialAuthRouteName("SignIn");
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
  }, [handleDeepLink, savePushTokenForUser]);

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const isPasswordResetFlow =
          (globalThis as any).__OVERLOOKED_FORCE_NEW_PASSWORD__ ||
          (globalThis as any).__OVERLOOKED_RECOVERY__ ||
          (globalThis as any).__OVERLOOKED_PASSWORD_RESET_DONE__;

        /**
         * Never run normal post-login work while password reset is active.
         */
        if (isPasswordResetFlow) {
          return;
        }

        /**
         * IMPORTANT FIX:
         *
         * If Supabase restores an old incomplete session after app startup,
         * kill it unless this is the real email-confirmation flow.
         */
        if (
          session?.user?.id &&
          (event === "SIGNED_IN" ||
            event === "INITIAL_SESSION" ||
            event === "TOKEN_REFRESHED")
        ) {
          const isEmailConfirmFlow = isAllowedEmailConfirmCreateProfileFlow();

          if (!isEmailConfirmFlow) {
            const profileComplete = await isCurrentUserProfileComplete(
              session.user.id
            );

            if (!profileComplete) {
              await forceSignInForIncompleteProfile(
                `auth state ${event} with incomplete profile`
              );
              setInitialAuthRouteName("SignIn");
              return;
            }
          }
        }

        if (
          Platform.OS !== "web" &&
          session?.user?.id &&
          (event === "SIGNED_IN" ||
            event === "TOKEN_REFRESHED" ||
            event === "INITIAL_SESSION" ||
            event === "USER_UPDATED")
        ) {
          savePushTokenForUser(session.user.id).catch((err) => {
            console.log("Push token save skipped:", err?.message || err);
          });
        }
      }
    );

    return () => subscription.subscription.unsubscribe();
  }, [savePushTokenForUser]);

  useEffect(() => {
    if (appIsReady && fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [appIsReady, fontsLoaded]);

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
            <GestureHandlerRootView
              style={{ flex: 1, backgroundColor: "#0D0D0D" }}
            >
              <StatusBar style="light" />
              <AuthProvider>
                <AppRefreshProvider>
                  <GamificationProvider>
                    <AppNavigator initialAuthRouteName={initialAuthRouteName} />
                  </GamificationProvider>
                </AppRefreshProvider>
              </AuthProvider>
            </GestureHandlerRootView>
          </SafeAreaProvider>
        </PaperProvider>
      </AppErrorBoundary>
    </View>
  );
}