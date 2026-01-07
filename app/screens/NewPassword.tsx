// app/screens/NewPassword.tsx
import React, { useEffect, useMemo, useState } from "react";
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

  // ✅ Success modal
  const [successOpen, setSuccessOpen] = useState(false);

  // ✅ Error banner text (instead of silent failure)
  const [linkStatus, setLinkStatus] = useState<"checking" | "ready" | "invalid">(
    "checking"
  );
  const statusText = useMemo(() => {
    if (linkStatus === "checking") return "Waiting for valid reset link…";
    if (linkStatus === "invalid") return "Reset link expired or invalid.";
    return "";
  }, [linkStatus]);

  // ---------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------
  const hardGoToSignInWeb = () => {
    if (Platform.OS === "web") {
      window.location.assign("/signin");
    }
  };

  const resetToSignInNative = () => {
    // If your stack route is not "Auth", change this to your real route name.
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
  // Parse URL (WEB)
  // - Supports:
  //   1) ?code=...  (PKCE)
  //   2) #access_token=...&refresh_token=... (legacy)
  //   3) ?token_hash=...&type=recovery&email=...
  // ---------------------------------------------------------
  const parseWebUrlParams = () => {
    let params: Record<string, any> = {};

    // Hash fragment
    const hash = Platform.OS === "web" ? window.location.hash?.replace(/^#/, "") ?? "" : "";
    if (hash) {
      const hp = new URLSearchParams(hash);
      hp.forEach((v, k) => (params[k] = v));
    }

    // Query string
    const search = Platform.OS === "web" ? window.location.search ?? "" : "";
    if (search) {
      const sp = new URLSearchParams(search);
      sp.forEach((v, k) => (params[k] = v));
    }

    return {
      code: params["code"],

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

  const cleanWebUrl = () => {
    if (Platform.OS !== "web") return;
    const clean = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, clean);
  };

  // ---------------------------------------------------------
  // Establish Recovery Session
  // ✅ Accept PKCE code flow (MOST COMMON)
  // ✅ Accept legacy hash access_token flow
  // ✅ Accept token_hash verifyOtp flow
  // ---------------------------------------------------------
  const establishSession = async () => {
    try {
      if (Platform.OS !== "web") {
        // On native, Supabase usually triggers PASSWORD_RECOVERY event from the deep link.
        // We still try to see if a session already exists.
        const { data } = await supabase.auth.getSession();
        if (data?.session) {
          setSessionReady(true);
          setLinkStatus("ready");
          return true;
        }
        // If no session, keep waiting (don’t auto-kick)
        setLinkStatus("invalid");
        return false;
      }

      const p = parseWebUrlParams();

      // Supabase sometimes sets error info
      if (p.error_code === "otp_expired" || p.error_description) {
        setLinkStatus("invalid");
        return false;
      }

      // ✅ CASE 1: PKCE code in query string (modern reset)
      if (p.code) {
        const fullUrl = window.location.href;
        const { error } = await supabase.auth.exchangeCodeForSession(fullUrl);

        if (error) {
          console.log("exchangeCodeForSession error:", error);
          setLinkStatus("invalid");
          return false;
        }

        setSessionReady(true);
        setLinkStatus("ready");
        cleanWebUrl();
        return true;
      }

      // ✅ CASE 2: legacy access_token in hash
      if (p.access_token && p.refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token: p.access_token,
          refresh_token: p.refresh_token,
        });

        if (error) {
          console.log("setSession error:", error);
          setLinkStatus("invalid");
          return false;
        }

        setSessionReady(true);
        setLinkStatus("ready");
        cleanWebUrl();
        return true;
      }

      // ✅ CASE 3: token_hash verifyOtp (only if present)
      if (p.token_hash && p.email) {
        // Only if type is recovery or missing
        const { error } = await supabase.auth.verifyOtp({
          type: "recovery",
          token_hash: p.token_hash,
          email: p.email,
        });

        if (error) {
          console.log("verifyOtp error:", error);
          setLinkStatus("invalid");
          return false;
        }

        setSessionReady(true);
        setLinkStatus("ready");
        cleanWebUrl();
        return true;
      }

      // Nothing we can use
      setLinkStatus("invalid");
      return false;
    } catch (e) {
      console.log("establishSession exception:", e);
      setLinkStatus("invalid");
      return false;
    }
  };

  useEffect(() => {
    const run = async () => {
      setLinkStatus("checking");
      await establishSession();
    };
    run();
  }, []);

  // Also listen for native recovery events (and web fallback)
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        // Supabase says recovery flow is active
        setSessionReady(true);
        setLinkStatus("ready");
        return;
      }

      // If a session appears, allow update password
      if (event === "SIGNED_IN" && session) {
        setSessionReady(true);
        setLinkStatus("ready");
      }
    });

    return () => {
      listener.subscription.unsubscribe();
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

    const { error } = await supabase.auth.updateUser({ password });

    setLoading(false);

    if (error) {
      const msg = (error.message || "").toLowerCase();

      // Friendly message for same-password attempts
      if (
        msg.includes("same") ||
        msg.includes("different") ||
        msg.includes("new password") ||
        msg.includes("should be different")
      ) {
        Alert.alert(
          "Choose a new password",
          "You can’t change your password to the same password as before. Please choose a different one."
        );
        return;
      }

      Alert.alert("Error", error.message);
      return;
    }

    // ✅ In-app success modal with “Go to sign in”
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
          <Text style={styles.subtitle}>
            {linkStatus === "invalid"
              ? "Reset link expired or invalid."
              : "Enter your new password below."}
          </Text>

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
            disabled={loading || signingOut || linkStatus !== "ready"}
            style={[
              styles.button,
              (loading || signingOut || linkStatus !== "ready") && { opacity: 0.6 },
            ]}
          >
            {loading ? (
              <ActivityIndicator color={BG} />
            ) : (
              <Text style={styles.buttonText}>UPDATE PASSWORD</Text>
            )}
          </TouchableOpacity>

          {linkStatus !== "ready" && (
            <Text style={styles.error}>{statusText}</Text>
          )}
        </View>
      </View>

      {/* ✅ SUCCESS POPUP MODAL */}
      <Modal
        visible={successOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSuccessOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Password updated ✅</Text>
            <Text style={styles.modalText}>
              Your password has been changed successfully.
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

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER,
  },
  modalTitle: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 10,
  },
  modalText: {
    color: SUB,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 14,
  },
  modalPrimary: {
    backgroundColor: GOLD,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 10,
  },
  modalPrimaryText: { color: BG, fontWeight: "900", fontSize: 15 },
  modalSecondary: {
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  modalSecondaryText: { color: TEXT, fontWeight: "800", fontSize: 14 },
});
