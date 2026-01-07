// app/screens/NewPassword.tsx
import React, { useEffect, useState } from "react";
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

export default function NewPassword() {
  const navigation = useNavigation<any>();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [successOpen, setSuccessOpen] = useState(false);
  const [status, setStatus] = useState("");

  // ---------------------------------------------------------
  // Parse auth params from current URL (web)
  // Supports:
  // - PKCE: ?code=...
  // - legacy: #access_token=...&refresh_token=...
  // - fallback: ?token=...&token_hash=...
  // ---------------------------------------------------------
  const parseTokensFromUrl = () => {
    const out: Record<string, string> = {};

    if (Platform.OS === "web" && typeof window !== "undefined") {
      // query (?code=..., ?error_description=...)
      const searchParams = new URLSearchParams(window.location.search || "");
      searchParams.forEach((v, k) => (out[k] = v));

      // hash (#access_token=..., #type=recovery)
      const hash = (window.location.hash || "").replace(/^#/, "");
      const hashParams = new URLSearchParams(hash);
      hashParams.forEach((v, k) => (out[k] = v));
    }

    return {
      code: out["code"] || null,
      access_token: out["access_token"] || null,
      refresh_token: out["refresh_token"] || null,
      type: out["type"] || null,

      token: out["token"] || null,
      token_hash: out["token_hash"] || null,
      email: out["email"] || null,

      error: out["error"] || null,
      error_code: out["error_code"] || null,
      error_description: out["error_description"] || null,
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

  // ---------------------------------------------------------
  // Establish recovery session
  // ---------------------------------------------------------
  const establishSession = async () => {
    const {
      code,
      access_token,
      refresh_token,
      type,
      token,
      token_hash,
      email,
      error_description,
      error_code,
    } = parseTokensFromUrl();

    console.log("NewPassword URL params:", {
      hasCode: !!code,
      hasLegacyTokens: !!access_token || !!refresh_token,
      type,
      hasToken: !!token,
      hasTokenHash: !!token_hash,
      email,
      error_code,
      error_description,
    });

    // Must be recovery if type is present
    if (type && type !== "recovery") {
      console.log(`Not a recovery link (type=${type}) → go sign in`);
      await goToSignIn();
      return false;
    }

    // Expired/invalid
    if (error_code === "otp_expired" || error_description) {
      Alert.alert(
        "Link expired",
        "That password reset link is invalid or has expired. Please request a new one from Sign In.",
        [{ text: "OK", onPress: () => goToSignIn() }]
      );
      return false;
    }

    // ✅ BEST CASE: PKCE flow (?code=...)
    if (Platform.OS === "web" && code && typeof window !== "undefined") {
      console.log("Using PKCE code → exchangeCodeForSession");
      const { error } = await supabase.auth.exchangeCodeForSession(
        window.location.href
      );

      if (!error) return true;

      console.log("exchangeCodeForSession error:", error.message);
      Alert.alert(
        "Invalid link",
        "This password reset link is invalid. Please request a new one from Sign In.",
        [{ text: "OK", onPress: () => goToSignIn() }]
      );
      return false;
    }

    // ✅ Legacy hash tokens (#access_token=...&refresh_token=...)
    if (access_token && refresh_token) {
      console.log("Using legacy access_token/refresh_token → setSession");
      const { error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });

      if (!error) return true;
      console.log("setSession error:", error.message);
    }

    // ✅ Fallback: token / token_hash direct verifyOtp
    // (This is NOT the preferred email flow, but we still support it.)
    if (token && email) {
      console.log("Fallback verifyOtp with token + email");
      const { error } = await supabase.auth.verifyOtp({
        type: "recovery",
        token,
        email,
      } as any);

      if (!error) return true;
      console.log("verifyOtp(token) error:", error.message);
    }

    if (token_hash) {
      console.log("Fallback verifyOtp with token_hash");
      const { error } = await supabase.auth.verifyOtp({
        type: "recovery",
        token_hash,
        ...(email ? { email } : {}),
      } as any);

      if (!error) return true;
      console.log("verifyOtp(token_hash) error:", error.message);
    }

    // Final: check if session exists anyway
    const { data } = await supabase.auth.getSession();
    if (data?.session) return true;

    Alert.alert(
      "Invalid link",
      "This password reset link is invalid. Please request a new one from Sign In.",
      [{ text: "OK", onPress: () => goToSignIn() }]
    );
    return false;
  };

  useEffect(() => {
    const run = async () => {
      setStatus("Validating reset link...");
      const ok = await establishSession();

      if (ok) {
        setSessionReady(true);
        setStatus("");

        // Clean URL (prevents re-processing)
        if (Platform.OS === "web" && typeof window !== "undefined") {
          const clean = window.location.origin + window.location.pathname;
          window.history.replaceState({}, document.title, clean);
        }
      } else {
        setStatus("");
      }
    };

    run();
  }, []);

  const updatePassword = async () => {
    if (!sessionReady) {
      Alert.alert("Invalid Link", "Please open the reset link again.");
      return;
    }

    if (!password || !confirm) return Alert.alert("Error", "Fill in both fields.");
    if (password !== confirm) return Alert.alert("Error", "Passwords do not match.");
    if (password.length < 6)
      return Alert.alert("Error", "Password must be at least 6 characters.");

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

    // ✅ Success popup
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
              secureTextEntry
              placeholder="New password"
              placeholderTextColor={SUB}
              value={password}
              onChangeText={setPassword}
              style={styles.input}
            />
          </View>

          <View style={styles.inputRow}>
            <Ionicons name="shield-checkmark" size={16} color={SUB} />
            <TextInput
              secureTextEntry
              placeholder="Confirm password"
              placeholderTextColor={SUB}
              value={confirm}
              onChangeText={setConfirm}
              style={styles.input}
            />
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
              onPress={async () => {
                setSuccessOpen(false);
                await goToSignIn();
              }}
            >
              <Text style={styles.modalPrimaryText}>Go to Sign In</Text>
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
