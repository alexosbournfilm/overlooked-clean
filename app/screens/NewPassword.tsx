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

  // ✅ NEW: success modal
  const [successOpen, setSuccessOpen] = useState(false);

  // ✅ NEW: inline status
  const [status, setStatus] = useState<string>("");

  // EXACT SAME TOKEN PARSER USED IN SIGNUP
  const parseTokensFromUrl = () => {
    let params: Record<string, any> = {};

    // 1) Read HASH fragment (Safari + Supabase use this)
    if (Platform.OS === "web") {
      const hash = window.location.hash?.replace(/^#/, "") ?? "";
      const hashParams = new URLSearchParams(hash);
      hashParams.forEach((v, k) => (params[k] = v));
    }

    // 2) Read query params (?token_hash=...)
    const search = Platform.OS === "web" ? window.location.search : "";
    const searchParams = new URLSearchParams(search);
    searchParams.forEach((v, k) => (params[k] = v));

    return {
      access_token: params["access_token"],
      refresh_token: params["refresh_token"],
      token_hash: params["token_hash"],
      email: params["email"],
      type: params["type"],
      error: params["error"],
      error_code: params["error_code"],
      error_description: params["error_description"],
    };
  };

  const hardGoToSignInWeb = () => {
    if (Platform.OS === "web") {
      window.location.assign("/signin");
    }
  };

  const resetToSignInNative = () => {
    // NOTE: keep your original structure — if your root routes differ, update here.
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

  const establishSession = async () => {
    const {
      access_token,
      refresh_token,
      token_hash,
      email,
      type,
      error_description,
      error_code,
    } = parseTokensFromUrl();

    console.log("Parsed Tokens:", {
      access_token: !!access_token,
      refresh_token: !!refresh_token,
      token_hash: !!token_hash,
      email,
      type,
      error_code,
      error_description,
    });

    // Only allow recovery links
    if (type && type !== "recovery") {
      console.log(`🔁 Not a recovery link (type=${type}). Redirecting to Sign In.`);
      await goToSignIn();
      return false;
    }

    if (error_code === "otp_expired" || error_description) {
      Alert.alert(
        "Link expired",
        "That password reset link is invalid or has expired. Please request a new one from Sign In.",
        [{ text: "OK", onPress: () => goToSignIn() }]
      );
      return false;
    }

    // CASE 1: hash contains full session tokens (most common)
    if (access_token && refresh_token) {
      console.log("✔ Using full access_token session (recovery)");
      const { error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });
      if (!error) return true;
    }

    // CASE 2: token_hash + email (older flow)
    if (token_hash && email) {
      console.log("✔ Using token_hash to verify recovery session");
      const { error } = await supabase.auth.verifyOtp({
        type: "recovery",
        token_hash,
        email,
      });
      if (!error) return true;
    }

    console.log("❌ No valid recovery session could be created");
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
        console.log("✔ Recovery session established");
        setSessionReady(true);
        setStatus("");

        // ✅ IMPORTANT:
        // Do NOT clean URL until AFTER the session is established.
        if (Platform.OS === "web") {
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

    if (error) {
      const msg = (error.message || "").toLowerCase();

      // ✅ Your custom “same password” messaging
      if (msg.includes("different") || msg.includes("same") || msg.includes("old password")) {
        Alert.alert(
          "Choose a different password",
          "You can’t change your password to the same password as before. Please choose a new one."
        );
        setStatus("");
        return;
      }

      Alert.alert("Error", error.message);
      setStatus("");
      return;
    }

    // ✅ Success UI (in-app)
    setStatus("");
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

          {/* ✅ clearer status messaging */}
          {!!status && <Text style={styles.status}>{status}</Text>}

          {!sessionReady && !status && (
            <Text style={styles.error}>Waiting for valid reset link…</Text>
          )}
        </View>
      </View>

      {/* ✅ SUCCESS POPUP */}
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
