// App.tsx
import "./app/polyfills"; // must stay first
import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Linking, Platform, LogBox } from "react-native";
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

LogBox.ignoreLogs([
  "TypeError: Network request failed",
  "Network request failed",
]);

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

function setCreateProfileAllowedStorage() {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.sessionStorage.setItem("overlooked.allowCreateProfile", "true");
    window.sessionStorage.setItem("overlooked.createProfileAllowed", "true");
  }
}

function clearCreateProfileAllowedStorage() {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.sessionStorage.removeItem("overlooked.allowCreateProfile");
    window.sessionStorage.removeItem("overlooked.manualSignIn");
    window.sessionStorage.removeItem("overlooked.createProfileAllowed");
  }
}

function markPasswordResetFlow() {
  (globalThis as any).__OVERLOOKED_FORCE_NEW_PASSWORD__ = true;
  (globalThis as any).__OVERLOOKED_RECOVERY__ = true;
  (globalThis as any).__OVERLOOKED_EMAIL_CONFIRM__ = false;
  (globalThis as any).__OVERLOOKED_MANUAL_SIGN_IN__ = false;
  (globalThis as any).__OVERLOOKED_CREATE_PROFILE_ALLOWED__ = false;
  (globalThis as any).__OVERLOOKED_PASSWORD_RESET_DONE__ = false;

  clearCreateProfileAllowedStorage();
}

function markSignupConfirmFlow() {
  (globalThis as any).__OVERLOOKED_FORCE_NEW_PASSWORD__ = false;
  (globalThis as any).__OVERLOOKED_RECOVERY__ = false;
  (globalThis as any).__OVERLOOKED_EMAIL_CONFIRM__ = true;
  (globalThis as any).__OVERLOOKED_MANUAL_SIGN_IN__ = false;
  (globalThis as any).__OVERLOOKED_CREATE_PROFILE_ALLOWED__ = true;
  (globalThis as any).__OVERLOOKED_PASSWORD_RESET_DONE__ = false;

  setCreateProfileAllowedStorage();
}

/**
 * Allows incomplete profiles ONLY when this is a valid create-profile flow:
 * - email confirmation
 * - manual sign-in with a confirmed account
 * - durable create-profile allowed flag
 *
 * This keeps the old random CreateProfile glitch blocked,
 * while preserving valid onboarding.
 */
function isAllowedCreateProfileFlow() {
  const G = globalThis as any;

  if (G.__OVERLOOKED_EMAIL_CONFIRM__ === true) return true;
  if (G.__OVERLOOKED_MANUAL_SIGN_IN__ === true) return true;
  if (G.__OVERLOOKED_CREATE_PROFILE_ALLOWED__ === true) return true;

  if (Platform.OS === "web" && typeof window !== "undefined") {
    return (
      window.sessionStorage.getItem("overlooked.allowCreateProfile") === "true" ||
      window.sessionStorage.getItem("overlooked.manualSignIn") === "true" ||
      window.sessionStorage.getItem("overlooked.createProfileAllowed") === "true"
    );
  }

  return false;
}

async function waitForRealSession(maxAttempts = 10, delayMs = 400) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      console.log("waitForRealSession getSession error:", error.message);
    }

    if (data?.session?.user?.id) {
      return data.session;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return null;
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
  (globalThis as any).__OVERLOOKED_EMAIL_CONFIRM__ = false;
  (globalThis as any).__OVERLOOKED_MANUAL_SIGN_IN__ = false;
  (globalThis as any).__OVERLOOKED_CREATE_PROFILE_ALLOWED__ = false;

  clearCreateProfileAllowedStorage();
}

async function handleWebSignupHashImmediately() {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return false;
  }

  const href = window.location.href || "";
  const hash = window.location.hash || "";

  if (!hash.includes("access_token=") && !hash.includes("refresh_token=")) {
    return false;
  }

  const hashParams = new URLSearchParams(hash.replace(/^#/, ""));

  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");
  const rawType = (hashParams.get("type") || "").toLowerCase();

  const isSignupHash =
    rawType === "signup" ||
    rawType === "signups" ||
    rawType.startsWith("signup");

  const isRecoveryHash =
    rawType === "recovery" || href.toLowerCase().includes("type=recovery");

  if (!accessToken || !refreshToken || !isSignupHash || isRecoveryHash) {
    return false;
  }

  console.log("✅ Early web signup hash detected. Confirming email then going to SignIn.");

  try {
    const { error } = await Promise.race([
      supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      }),
      new Promise<any>((resolve) =>
        setTimeout(() => resolve({ error: null, timedOut: true }), 2500)
      ),
    ]);

    if (error) {
      console.log("Early setSession after confirmation failed:", error.message);
    }
  } catch (e) {
    console.log("Early setSession exception:", e);
  }

  /**
   * Clear local session so confirmation does not auto-open CreateProfile.
   * The user will manually sign in, then missing profile will route to CreateProfile.
   */
  try {
    await Promise.race([
      supabase.auth.signOut({ scope: "local" } as any),
      new Promise((resolve) => setTimeout(resolve, 1200)),
    ]);
  } catch (e) {
    console.log("Early local sign out after confirmation skipped:", e);
  }

  (globalThis as any).__OVERLOOKED_EMAIL_CONFIRM__ = false;
  (globalThis as any).__OVERLOOKED_MANUAL_SIGN_IN__ = false;
  (globalThis as any).__OVERLOOKED_CREATE_PROFILE_ALLOWED__ = false;
  (globalThis as any).__OVERLOOKED_PASSWORD_RESET_DONE__ = false;

  clearCreateProfileAllowedStorage();

  /**
   * Important:
   * Remove the token hash immediately.
   * Then force /signin.
   */
  try {
    window.history.replaceState({}, document.title, window.location.origin + "/signin");
  } catch {}

  setTimeout(() => {
    window.location.replace("/signin");
  }, 50);

  return true;
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
      type === "invite" ||
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
     * Password reset must be handled ONLY by NewPassword.tsx.
     * Do NOT exchange the recovery code here.
     * Do NOT call setSession here.
     */
    if (isResetPasswordLink || type === "recovery") {
      console.log("🔐 Reset password link detected → NewPassword owns this flow");

      (globalThis as any).__OVERLOOKED_RESET_URL__ = url;

      markPasswordResetFlow();
      setInitialAuthRouteName("SignIn");

      setTimeout(() => {
        try {
          navigate("NewPassword" as never);
        } catch (e) {
          console.log("NewPassword navigation skipped:", e);
        }
      }, 300);

      return;
    }

    /**
     * Signup/email confirmation is allowed to create a session here.
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

    const normalizedType = (type || "").toLowerCase();

const isSignupLikeConfirmation =
  normalizedType === "signup" ||
  normalizedType === "signups" ||
  normalizedType === "invite" ||
  normalizedType.startsWith("signup") ||
  (!!code && !isResetPasswordLink && normalizedType !== "recovery") ||
  (!!access_token && !!refresh_token && normalizedType !== "recovery");
    if (isSignupLikeConfirmation) {
  console.log("✅ Signup/email confirmation link detected");

  /**
   * The email is confirmed after exchangeCodeForSession/setSession succeeds above.
   * Now send the user back to SignIn.
   *
   * Important:
   * We clear the temporary session and remove the token URL hash.
   * The user can then manually sign in.
   * If their profile is missing, SignIn will send them to CreateProfile.
   */
  (globalThis as any).__OVERLOOKED_EMAIL_CONFIRM__ = false;
  (globalThis as any).__OVERLOOKED_MANUAL_SIGN_IN__ = false;
  (globalThis as any).__OVERLOOKED_CREATE_PROFILE_ALLOWED__ = false;
  (globalThis as any).__OVERLOOKED_PASSWORD_RESET_DONE__ = false;

  clearCreateProfileAllowedStorage();

  try {
    await supabase.auth.signOut({ scope: "local" } as any);
  } catch (e) {
    console.log("Local sign out after email confirmation skipped:", e);
  }

  setInitialAuthRouteName("SignIn");

  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.history.replaceState({}, document.title, window.location.origin + "/signin");
    window.location.replace("/signin");
    return;
  }

  setTimeout(() => {
    try {
      navigate("Auth" as never, { screen: "SignIn" } as never);
    } catch (e) {
      console.log("Navigate to SignIn after confirmation skipped:", e);
    }
  }, 150);

  return;
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
    const handledEarlySignupHash = await handleWebSignupHashImmediately();

if (handledEarlySignupHash) {
  setInitialAuthRouteName("SignIn");

  if (mounted) {
    setAppIsReady(true);
  }

  return;
}

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

        const isCreateProfileAllowedFlow = isAllowedCreateProfileFlow();

        /**
         * If the app opens with an old saved session and the profile is incomplete,
         * do NOT allow AppNavigator/AuthProvider to send the user to CreateProfile.
         *
         * But DO allow:
         * - fresh email confirmation
         * - manual sign-in
         * - durable create-profile allowed flag
         */
        if (session && !isPasswordResetFlow) {
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
         * If Supabase restores an old incomplete session after app startup,
         * kill it only when it is NOT a valid CreateProfile flow.
         */
        if (
  session?.user?.id &&
  (event === "SIGNED_IN" ||
    event === "INITIAL_SESSION" ||
    event === "TOKEN_REFRESHED")
) {
  console.log("✅ Auth session active:", event);
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
