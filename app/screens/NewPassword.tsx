// app/screens/NewPassword.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, CommonActions } from "@react-navigation/native";
import { supabase } from "../lib/supabase";
import { navigationRef } from "../navigation/navigationRef";

const BG = "#000";
const CARD = "#0B0B0B";
const TEXT = "#F5F3EF";
const SUB = "#A9A7A3";
const GOLD = "#C6A664";
const BORDER = "#262626";

type ResetTokens = {
  code?: string;
  access_token?: string;
  refresh_token?: string;
  token_hash?: string;
  type?: string;
  email?: string;
  error?: string;
  error_code?: string;
  error_description?: string;
  rawUrl?: string | null;
};

export default function NewPassword() {
  const navigation = useNavigation<any>();

  const latestNativeUrlRef = useRef<string | null>(null);
  const hasTriedSessionRef = useRef(false);
  const mountedRef = useRef(true);
  const hasLeftScreenRef = useRef(false);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [status, setStatus] = useState("");

  const collectParamsFromUrl = (url?: string | null) => {
    const params: Record<string, string> = {};
    if (!url) return params;

    try {
      const queryPart = url.includes("?")
        ? url.split("?")[1]?.split("#")[0]
        : "";
      const hashPart = url.includes("#") ? url.split("#")[1] : "";

      if (queryPart) {
        const queryParams = new URLSearchParams(queryPart);
        queryParams.forEach((v, k) => {
          params[k] = v;
        });
      }

      if (hashPart) {
        const hashParams = new URLSearchParams(hashPart);
        hashParams.forEach((v, k) => {
          params[k] = v;
        });
      }
    } catch (e) {
      console.log("Token parse error:", e);
    }

    return params;
  };

  const parseTokensFromUrl = async (): Promise<ResetTokens> => {
    let rawUrl: string | null = null;
    let params: Record<string, string> = {};

    if (Platform.OS === "web" && typeof window !== "undefined") {
      rawUrl = window.location.href;
      params = collectParamsFromUrl(rawUrl);
    } else {
      rawUrl = latestNativeUrlRef.current || (await Linking.getInitialURL());
      latestNativeUrlRef.current = rawUrl;
      params = collectParamsFromUrl(rawUrl);
    }

    return {
      code: params["code"],
      access_token: params["access_token"],
      refresh_token: params["refresh_token"],
      token_hash: params["token_hash"],
      type: params["type"],
      email: params["email"],
      error: params["error"],
      error_code: params["error_code"],
      error_description: params["error_description"],
      rawUrl,
    };
  };

  const markResetFlowActive = () => {
    (globalThis as any).__OVERLOOKED_FORCE_NEW_PASSWORD__ = true;
    (globalThis as any).__OVERLOOKED_RECOVERY__ = true;
    (globalThis as any).__OVERLOOKED_PASSWORD_RESET_DONE__ = false;
    (globalThis as any).__OVERLOOKED_EMAIL_CONFIRM__ = false;

    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.sessionStorage.removeItem("overlooked.allowCreateProfile");
    }
  };

  const markResetDone = () => {
    (globalThis as any).__OVERLOOKED_FORCE_NEW_PASSWORD__ = false;
    (globalThis as any).__OVERLOOKED_RECOVERY__ = false;
    (globalThis as any).__OVERLOOKED_PASSWORD_RESET_DONE__ = true;
    (globalThis as any).__OVERLOOKED_EMAIL_CONFIRM__ = false;

    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.sessionStorage.removeItem("overlooked.allowCreateProfile");
      window.sessionStorage.setItem("overlooked.justResetPassword", "true");
    }
  };

  const clearResetFlagsForNativeSignIn = () => {
    (globalThis as any).__OVERLOOKED_FORCE_NEW_PASSWORD__ = false;
    (globalThis as any).__OVERLOOKED_RECOVERY__ = false;
    (globalThis as any).__OVERLOOKED_PASSWORD_RESET_DONE__ = false;
    (globalThis as any).__OVERLOOKED_EMAIL_CONFIRM__ = false;
  };

  const resetToSignInNative = () => {
    const action = CommonActions.reset({
      index: 0,
      routes: [{ name: "Auth", params: { screen: "SignIn" } }],
    });

    if (navigationRef.isReady()) {
      navigationRef.dispatch(action);
    } else {
      navigation.dispatch(action);
    }
  };

  const clearSupabaseAuthStorage = async () => {
    try {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const keysToRemove: string[] = [];

        for (let i = 0; i < window.localStorage.length; i += 1) {
          const key = window.localStorage.key(i);
          if (!key) continue;

          if (
            key.startsWith("sb-") ||
            key.includes("supabase") ||
            key.includes("overlooked.supabase.auth")
          ) {
            keysToRemove.push(key);
          }
        }

        keysToRemove.forEach((key) => window.localStorage.removeItem(key));

        window.sessionStorage.removeItem("overlooked.allowCreateProfile");
        window.sessionStorage.setItem("overlooked.justResetPassword", "true");
        return;
      }

      const AsyncStorage =
        require("@react-native-async-storage/async-storage").default;
      await AsyncStorage.removeItem("overlooked.supabase.auth");
    } catch (e) {
      console.log("clearSupabaseAuthStorage error:", e);
    }
  };

  const goToSignIn = async () => {
    if (signingOut || hasLeftScreenRef.current) return;

    hasLeftScreenRef.current = true;
    setSigningOut(true);
    setStatus("Returning to Sign In...");

    try {
      markResetDone();

      try {
        await Promise.race([
          supabase.auth.signOut({ scope: "local" as any }),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      } catch (e) {
        console.log("Supabase signOut failed, clearing local auth anyway:", e);
      }

      await clearSupabaseAuthStorage();

      if (Platform.OS === "web") {
        if (typeof window !== "undefined") {
          window.sessionStorage.removeItem("overlooked.allowCreateProfile");
          window.sessionStorage.setItem("overlooked.justResetPassword", "true");
          window.location.replace("/signin");
        }
        return;
      }

      resetToSignInNative();

      setTimeout(() => {
        clearResetFlagsForNativeSignIn();
      }, 500);
    } catch (e) {
      console.log("goToSignIn error:", e);

      await clearSupabaseAuthStorage();

      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.sessionStorage.removeItem("overlooked.allowCreateProfile");
        window.sessionStorage.setItem("overlooked.justResetPassword", "true");
        window.location.replace("/signin");
        return;
      }

      resetToSignInNative();

      setTimeout(() => {
        clearResetFlagsForNativeSignIn();
      }, 500);
    } finally {
      if (mountedRef.current) {
        setSigningOut(false);
      }
    }
  };

  const establishSession = async () => {
    markResetFlowActive();

    const {
      code,
      access_token,
      refresh_token,
      token_hash,
      type,
      email,
      error_description,
      error_code,
      rawUrl,
    } = await parseTokensFromUrl();

    console.log("Parsed Reset Tokens:", {
      rawUrl,
      hasCode: !!code,
      hasAccessToken: !!access_token,
      hasRefreshToken: !!refresh_token,
      hasTokenHash: !!token_hash,
      hasEmail: !!email,
      type,
      error_code,
      error_description,
    });

    if (error_code === "otp_expired" || error_description) {
      Alert.alert(
        "Link expired",
        "That password reset link is invalid or has expired. Please request a new one from Sign In.",
        [{ text: "OK", onPress: () => void goToSignIn() }]
      );
      return false;
    }

    if (type && type !== "recovery") {
      console.log(`Not a recovery link. type=${type}`);
      return false;
    }

    if (code) {
      console.log("Using PKCE code to exchange recovery session");

      const fullUrl = rawUrl || code;
      const { error } = await supabase.auth.exchangeCodeForSession(fullUrl);

      if (!error) {
        const { data: sessionCheck } = await supabase.auth.getSession();

        console.log("Session check after code exchange:", {
          hasSession: !!sessionCheck?.session,
        });

        return !!sessionCheck?.session;
      }

      console.log("exchangeCodeForSession full URL error:", error.message);

      const fallback = await supabase.auth.exchangeCodeForSession(code);

      if (!fallback.error) {
        const { data: sessionCheck } = await supabase.auth.getSession();

        console.log("Session check after code fallback:", {
          hasSession: !!sessionCheck?.session,
        });

        return !!sessionCheck?.session;
      }

      console.log(
        "exchangeCodeForSession code fallback error:",
        fallback.error.message
      );
    }

    if (access_token && refresh_token) {
      console.log("Using access_token + refresh_token recovery session");

      const { error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });

      if (!error) {
        const { data: sessionCheck } = await supabase.auth.getSession();

        console.log("Session check after setSession:", {
          hasSession: !!sessionCheck?.session,
        });

        return !!sessionCheck?.session;
      }

      console.log("setSession error:", error.message);
    }

    if (token_hash) {
      console.log("Using token_hash to verify recovery session");

      const { data, error } = await supabase.auth.verifyOtp({
        type: "recovery",
        token_hash,
      } as any);

      if (!error) {
        const { data: sessionCheck } = await supabase.auth.getSession();

        console.log("Session check after verifyOtp:", {
          hasSession: !!sessionCheck?.session,
          hasDataSession: !!data?.session,
          hasUser: !!data?.user,
        });

        if (sessionCheck?.session) {
          return true;
        }

        if (data?.session) {
          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
          });

          if (!setSessionError) {
            const { data: secondCheck } = await supabase.auth.getSession();
            return !!secondCheck?.session;
          }

          console.log(
            "setSession after verifyOtp error:",
            setSessionError.message
          );
        }
      }

      if (error) {
        console.log("verifyOtp token_hash error:", error.message);
      }
    }

    const { data: existing } = await supabase.auth.getSession();

    if (existing?.session) {
      console.log("Existing recovery session found");
      return true;
    }

    console.log("No valid recovery session could be created");
    return false;
  };

  useEffect(() => {
    mountedRef.current = true;

    markResetFlowActive();

    const linkingSub = Linking.addEventListener("url", ({ url }) => {
      latestNativeUrlRef.current = url;
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log("NewPassword auth event:", event, {
          hasSession: !!session,
        });

        if (event === "PASSWORD_RECOVERY" && session) {
          markResetFlowActive();

          if (mountedRef.current) {
            setSessionReady(true);
            setStatus("");
          }
        }

        if (event === "USER_UPDATED") {
          console.log("USER_UPDATED received inside NewPassword");
        }
      }
    );

    const run = async () => {
      if (hasTriedSessionRef.current) return;
      hasTriedSessionRef.current = true;

      setStatus("Validating reset link...");

      try {
        const ok = await Promise.race([
          establishSession(),
          new Promise<boolean>((resolve) =>
            setTimeout(() => resolve(false), 15000)
          ),
        ]);

        if (!mountedRef.current) return;

        if (ok) {
          setSessionReady(true);
          setStatus("");

          if (Platform.OS === "web" && typeof window !== "undefined") {
            const clean = window.location.origin + "/reset-password";
            window.history.replaceState({}, document.title, clean);
          }
        } else {
          setSessionReady(false);
          setStatus(
            "Reset link not ready. You can still press Update Password to retry the session."
          );
        }
      } catch (e: any) {
        console.log("NewPassword session run error:", e);

        if (!mountedRef.current) return;

        setSessionReady(false);
        setStatus(
          "Could not validate reset link yet. Press Update Password to retry."
        );
      }
    };

    run();

    return () => {
      mountedRef.current = false;

      try {
        linkingSub.remove();
      } catch {}

      authListener?.subscription?.unsubscribe?.();
    };
  }, []);

  const updatePassword = async () => {
    console.log("🔥 UPDATE PASSWORD BUTTON PRESSED");

    setStatus("Button pressed...");

    if (loading || signingOut) {
      console.log("Blocked because already loading/signingOut");
      return;
    }

    if (!password || !confirm) {
      setStatus("");
      Alert.alert("Error", "Fill in both fields.");
      return;
    }

    if (password !== confirm) {
      setStatus("");
      Alert.alert("Error", "Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setStatus("");
      Alert.alert("Error", "Password must be at least 6 characters.");
      return;
    }

    setLoading(true);

    try {
      markResetFlowActive();

      setStatus("Checking reset session...");

      let { data: sessionData } = await supabase.auth.getSession();

      console.log("Session before password update:", {
        hasSession: !!sessionData?.session,
        userId: sessionData?.session?.user?.id,
      });

      if (!sessionData?.session) {
        setStatus("Trying to restore reset session...");

        const ok = await Promise.race([
          establishSession(),
          new Promise<boolean>((resolve) =>
            setTimeout(() => resolve(false), 15000)
          ),
        ]);

        console.log("establishSession result inside updatePassword:", ok);

        const retry = await supabase.auth.getSession();
        sessionData = retry.data;

        console.log("Session after restore attempt:", {
          hasSession: !!sessionData?.session,
          userId: sessionData?.session?.user?.id,
        });
      }

      if (!sessionData?.session) {
        setSessionReady(false);
        setStatus("Reset session missing.");

        Alert.alert(
          "Reset link problem",
          "The reset session is missing. Please request a new password reset email and open the newest link."
        );

        return;
      }

      setSessionReady(true);
      setStatus("Updating password...");

      const result: any = await Promise.race([
        supabase.auth.updateUser({ password }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Password update timed out")), 15000)
        ),
      ]);

      const error = result?.error;

      if (error) {
        console.log("Password update error:", error);

        const msg = (error.message || "").toLowerCase();

        setStatus("");

        if (
          msg.includes("different") ||
          msg.includes("same") ||
          msg.includes("old password") ||
          msg.includes("must be different")
        ) {
          Alert.alert(
            "Choose a different password",
            "You can’t change your password to the same password as before. Please choose a new one."
          );
          return;
        }

        Alert.alert(
          "Password update failed",
          error.message || "Could not update your password."
        );

        return;
      }

      console.log("✅ PASSWORD UPDATED");

      setStatus("Password updated. Returning to Sign In...");

      markResetDone();

      await new Promise((resolve) => setTimeout(resolve, 600));

      await goToSignIn();
    } catch (e: any) {
      console.log("updatePassword fatal error:", e);

      setStatus("");

      Alert.alert(
        "Password update problem",
        e?.message === "Password update timed out"
          ? "The request took too long. Please check your connection, then try again."
          : e?.message || "Could not update your password. Please try again."
      );
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }}>
      <View style={styles.container}>
        <TouchableOpacity
          onPress={() => void goToSignIn()}
          style={styles.back}
          disabled={signingOut}
        >
          {signingOut ? (
            <ActivityIndicator color={SUB} />
          ) : (
            <Ionicons name="chevron-back" size={18} color={SUB} />
          )}
          <Text style={styles.backText}>Back to Sign In</Text>
        </TouchableOpacity>

        <View style={styles.card}>
          <Text style={styles.title}>Set a New Password</Text>
<Text style={styles.subtitle}>Enter your new password below.</Text>

<Text style={styles.passwordHint}>
  Password must be at least 6 characters. Numbers, symbols, and uppercase letters are optional.
</Text>

          <View style={styles.inputRow}>
            <Ionicons name="lock-closed" size={16} color={SUB} />
            <TextInput
              secureTextEntry={!showPassword}
              placeholder="New password"
              placeholderTextColor={SUB}
              value={password}
              onChangeText={setPassword}
              style={styles.input}
              editable={!loading && !signingOut}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              onPress={() => setShowPassword((prev) => !prev)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              disabled={loading || signingOut}
            >
              <Ionicons
                name={showPassword ? "eye-off" : "eye"}
                size={18}
                color={SUB}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.inputRow}>
            <Ionicons name="shield-checkmark" size={16} color={SUB} />
            <TextInput
              secureTextEntry={!showConfirmPassword}
              placeholder="Confirm password"
              placeholderTextColor={SUB}
              value={confirm}
              onChangeText={setConfirm}
              style={styles.input}
              editable={!loading && !signingOut}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              onPress={() => setShowConfirmPassword((prev) => !prev)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              disabled={loading || signingOut}
            >
              <Ionicons
                name={showConfirmPassword ? "eye-off" : "eye"}
                size={18}
                color={SUB}
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={() => {
              console.log("🔥 TOUCHABLE PRESSED");
              void updatePassword();
            }}
            disabled={false}
            style={[
              styles.button,
              (loading || signingOut) && { opacity: 0.6 },
            ]}
          >
            {loading ? (
              <ActivityIndicator color={BG} />
            ) : (
              <Text style={styles.buttonText}>UPDATE PASSWORD</Text>
            )}
          </TouchableOpacity>

          {!!status && <Text style={styles.status}>{status}</Text>}

          {!sessionReady && !status && (
            <Text style={styles.error}>
              Waiting for valid reset link. You can still press Update Password
              to retry.
            </Text>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  back: { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  backText: { marginLeft: 6, color: SUB, fontSize: 15 },
  card: {
    backgroundColor: CARD,
    padding: 26,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
  },
  title: {
    fontSize: 22,
    color: TEXT,
    textAlign: "center",
    fontWeight: "800",
    marginBottom: 4,
  },
  passwordHint: {
  color: SUB,
  textAlign: "center",
  fontSize: 13,
  lineHeight: 18,
  marginBottom: 18,
},
  subtitle: { color: SUB, textAlign: "center", marginBottom: 18 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  input: { flex: 1, marginLeft: 10, color: TEXT, fontSize: 15 },
  button: {
    backgroundColor: GOLD,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonText: { color: BG, fontWeight: "900", fontSize: 15 },
  error: { color: "red", marginTop: 10, textAlign: "center", lineHeight: 18 },
  status: { color: SUB, marginTop: 10, textAlign: "center", lineHeight: 18 },
});