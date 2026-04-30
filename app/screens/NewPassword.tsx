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
  Modal,
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
  error?: string;
  error_code?: string;
  error_description?: string;
  rawUrl?: string | null;
};

export default function NewPassword() {
  const navigation = useNavigation<any>();
  const latestNativeUrlRef = useRef<string | null>(null);
  const hasTriedSessionRef = useRef(false);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [status, setStatus] = useState("");

  const collectParamsFromUrl = (url?: string | null) => {
    const params: Record<string, string> = {};
    if (!url) return params;

    try {
      const queryPart = url.includes("?") ? url.split("?")[1]?.split("#")[0] : "";
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
      error: params["error"],
      error_code: params["error_code"],
      error_description: params["error_description"],
      rawUrl,
    };
  };

  const hardGoToSignInWeb = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.assign("/signin");
    }
  };

  const resetToSignInNative = () => {
    const action = CommonActions.reset({
      index: 0,
      routes: [{ name: "Auth", params: { screen: "SignIn" } }],
    });

    if (navigationRef.isReady()) navigationRef.dispatch(action);
    else navigation.dispatch(action);
  };

  const goToSignIn = async () => {
    if (signingOut) return;

    (globalThis as any).__OVERLOOKED_FORCE_NEW_PASSWORD__ = false;
    (globalThis as any).__OVERLOOKED_RECOVERY__ = false;

    setSigningOut(true);

    try {
      await supabase.auth.signOut();

      if (Platform.OS === "web") {
        hardGoToSignInWeb();
        return;
      }

      resetToSignInNative();
    } catch (e) {
      console.log("goToSignIn error:", e);
      if (Platform.OS === "web") hardGoToSignInWeb();
      else resetToSignInNative();
    } finally {
      setSigningOut(false);
    }
  };

  const establishSession = async () => {
    const {
      code,
      access_token,
      refresh_token,
      token_hash,
      type,
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
      type,
      error_code,
      error_description,
    });

    if (error_code === "otp_expired" || error_description) {
      Alert.alert(
        "Link expired",
        "That password reset link is invalid or has expired. Please request a new one from Sign In.",
        [{ text: "OK", onPress: () => goToSignIn() }]
      );
      return false;
    }

    if (type && type !== "recovery") {
      console.log(`🔁 Not a recovery link (type=${type}). Redirecting to Sign In.`);
      await goToSignIn();
      return false;
    }

    if (code) {
      console.log("✔ Using PKCE code to exchange recovery session");
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error) return true;

      console.log("❌ exchangeCodeForSession error:", error.message);
    }

    if (access_token && refresh_token) {
      console.log("✔ Using access_token + refresh_token recovery session");
      const { error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });

      if (!error) return true;

      console.log("❌ setSession error:", error.message);
    }

    if (token_hash) {
      console.log("✔ Using token_hash to verify recovery session");

      const { error } = await supabase.auth.verifyOtp({
        type: "recovery",
        token_hash,
      });

      if (!error) return true;

      console.log("❌ verifyOtp error:", error.message);
    }

    const { data: existing } = await supabase.auth.getSession();

    if (existing?.session) {
      console.log("✅ Existing session found — recovery is ready");
      return true;
    }

    console.log("❌ No valid recovery session could be created");
    return false;
  };

  useEffect(() => {
    const linkingSub = Linking.addEventListener("url", ({ url }) => {
      latestNativeUrlRef.current = url;
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "PASSWORD_RECOVERY" && session) {
          console.log("✅ PASSWORD_RECOVERY session ready inside NewPassword");
          setSessionReady(true);
          setStatus("");
        }
      }
    );

    const run = async () => {
      if (hasTriedSessionRef.current) return;
      hasTriedSessionRef.current = true;

      setStatus("Validating reset link...");

      const ok = await Promise.race([
        establishSession(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10000)),
      ]);

      if (ok) {
        setSessionReady(true);
        setStatus("");

        if (Platform.OS === "web" && typeof window !== "undefined") {
          const clean = window.location.origin + window.location.pathname;
          window.history.replaceState({}, document.title, clean);
        }
      } else {
        setStatus("");
        Alert.alert(
          "Reset link problem",
          "The reset link opened, but the recovery session could not be created. Please request a new password reset email and open the newest link."
        );
      }
    };

    run();

    return () => {
      try {
        linkingSub.remove();
      } catch {}

      authListener?.subscription?.unsubscribe?.();
    };
  }, []);

  const updatePassword = async () => {
    if (!sessionReady) {
      Alert.alert("Invalid Link", "Please open the reset link again.");
      return;
    }

    if (!password || !confirm) {
      Alert.alert("Error", "Fill in both fields.");
      return;
    }

    if (password !== confirm) {
      Alert.alert("Error", "Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    setStatus("Updating password...");

    const { error } = await supabase.auth.updateUser({ password });

    setLoading(false);
    setStatus("");

    if (error) {
      const msg = (error.message || "").toLowerCase();

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

      Alert.alert("Error", error.message);
      return;
    }

    setSuccessOpen(true);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }}>
      <View style={styles.container}>
        <TouchableOpacity
          onPress={() => goToSignIn()}
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

          <View style={styles.inputRow}>
            <Ionicons name="lock-closed" size={16} color={SUB} />
            <TextInput
              secureTextEntry={!showPassword}
              placeholder="New password"
              placeholderTextColor={SUB}
              value={password}
              onChangeText={setPassword}
              style={styles.input}
            />
            <TouchableOpacity
              onPress={() => setShowPassword((prev) => !prev)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
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
            />
            <TouchableOpacity
              onPress={() => setShowConfirmPassword((prev) => !prev)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name={showConfirmPassword ? "eye-off" : "eye"}
                size={18}
                color={SUB}
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={updatePassword}
            disabled={loading || signingOut || !sessionReady}
            style={[
              styles.button,
              (loading || signingOut || !sessionReady) && { opacity: 0.6 },
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
            <Text style={styles.error}>Waiting for valid reset link…</Text>
          )}
        </View>
      </View>

      <Modal
        visible={successOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSuccessOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Password changed ✅</Text>
            <Text style={styles.modalText}>
              Your password has been updated successfully.
            </Text>

            <TouchableOpacity
  style={styles.modalPrimary}
  onPress={() => {
    setSuccessOpen(false);
  }}
>
  <Text style={styles.modalPrimaryText}>Continue</Text>
</TouchableOpacity>

            <TouchableOpacity
              style={styles.modalSecondary}
              onPress={() => setSuccessOpen(false)}
            >
              <Text style={styles.modalSecondaryText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  error: { color: "red", marginTop: 10, textAlign: "center" },
  status: { color: SUB, marginTop: 10, textAlign: "center" },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    padding: 18,
  },
  modalCard: {
    backgroundColor: "#111",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
  },
  modalTitle: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 8,
  },
  modalText: {
    color: SUB,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 14,
  },
  modalPrimary: {
    backgroundColor: GOLD,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  modalPrimaryText: { color: BG, fontWeight: "900", fontSize: 15 },
  modalSecondary: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  modalSecondaryText: { color: TEXT, fontWeight: "800" },
});