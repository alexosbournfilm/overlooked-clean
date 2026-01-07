// app/screens/NewPassword.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Modal,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { CommonActions, useNavigation } from "@react-navigation/native";
import * as Linking from "expo-linking";
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
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);

  const [status, setStatus] = useState("Waiting for valid reset link…");

  const [successVisible, setSuccessVisible] = useState(false);
  const [errorVisible, setErrorVisible] = useState(false);
  const [errorText, setErrorText] = useState("Something went wrong.");

  const lastAttemptedPasswordRef = useRef<string>("");

  const showError = (msg: string) => {
    setErrorText(msg);
    setErrorVisible(true);
  };

  const hardGoToSignInWeb = () => {
    if (Platform.OS === "web") window.location.assign("/signin");
  };

  const resetToSignInNative = () => {
    // If your root route is just "SignIn", keep this.
    // If your app uses Auth stack, change to:
    // routes: [{ name: "Auth", params: { screen: "SignIn" } }],
    const action = CommonActions.reset({
      index: 0,
      routes: [{ name: "SignIn" }],
    });

    if (navigationRef.isReady()) navigationRef.dispatch(action);
    else navigation.dispatch(action);
  };

  const goToSignIn = async () => {
    try {
      await supabase.auth.signOut();
    } catch {}

    if (Platform.OS === "web") hardGoToSignInWeb();
    else resetToSignInNative();
  };

  // Parses hash + query params on web
  const parseWebParams = (url: string) => {
    const u = new URL(url);
    const params: Record<string, string> = {};

    // query
    u.searchParams.forEach((v, k) => (params[k] = v));

    // hash can contain tokens
    const hash = (u.hash || "").replace(/^#/, "");
    if (hash) {
      const h = new URLSearchParams(hash);
      h.forEach((v, k) => (params[k] = v));
    }

    return params;
  };

  const establishRecoverySessionFromUrl = async (url: string) => {
    try {
      // --- 1) PKCE: ?code=... ---
      if (url.includes("code=")) {
        const { error } = await supabase.auth.exchangeCodeForSession(url);
        if (error) {
          console.log("exchangeCodeForSession error:", error);
          setSessionReady(false);
          setStatus("Reset link expired or invalid.");
          return false;
        }

        setSessionReady(true);
        setStatus("Ready to reset password");
        return true;
      }

      // --- 2) token_hash + email fallback ---
      if (Platform.OS === "web") {
        const params = parseWebParams(url);

        const token_hash = params["token_hash"];
        const email = params["email"];
        const type = params["type"]; // should be recovery

        // Guard: only accept recovery
        if (type && type !== "recovery") {
          setSessionReady(false);
          setStatus("Invalid link type.");
          return false;
        }

        if (token_hash && email) {
          const { error } = await supabase.auth.verifyOtp({
            type: "recovery",
            token_hash,
            email,
          });

          if (error) {
            console.log("verifyOtp error:", error);
            setSessionReady(false);

            const msg = (error.message || "").toLowerCase();
            if (msg.includes("expired") || msg.includes("otp_expired")) {
              setStatus("Reset link expired or invalid.");
            } else {
              setStatus("Reset link invalid.");
            }
            return false;
          }

          setSessionReady(true);
          setStatus("Ready to reset password");
          return true;
        }
      }

      // If we got here, we didn't have usable params
      setSessionReady(false);
      setStatus("Reset link expired or invalid.");
      return false;
    } catch (e) {
      console.log("establishRecoverySessionFromUrl exception:", e);
      setSessionReady(false);
      setStatus("Reset link expired or invalid.");
      return false;
    }
  };

  // On mount: check initial URL (native) or window URL (web), and listen for deep links
  useEffect(() => {
    let mounted = true;

    const run = async () => {
      setChecking(true);

      try {
        let url = "";

        if (Platform.OS === "web" && typeof window !== "undefined") {
          url = window.location.href;
        } else {
          const initial = await Linking.getInitialURL();
          url = initial || "";
        }

        if (url) {
          const ok = await establishRecoverySessionFromUrl(url);

          // Clean URL on web AFTER session established attempt (don’t wipe tokens too early)
          if (Platform.OS === "web" && typeof window !== "undefined") {
            const clean = window.location.origin + window.location.pathname;
            window.history.replaceState({}, document.title, clean);
          }

          if (!ok) {
            // keep screen visible with message
          }
        } else {
          setStatus("Reset link expired or invalid.");
        }
      } finally {
        if (mounted) setChecking(false);
      }
    };

    run();

    // Listener for native deep links
    const sub = Linking.addEventListener("url", async (event) => {
      await establishRecoverySessionFromUrl(event.url);
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const updatePassword = async () => {
    if (!sessionReady) {
      showError("This reset link is invalid or expired. Please request a new one from Sign In.");
      return;
    }

    if (!password || !confirm) {
      showError("Please fill in both fields.");
      return;
    }

    if (password !== confirm) {
      showError("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      showError("Password must be at least 6 characters.");
      return;
    }

    // Local best-effort guard (prevents immediate same attempt)
    if (lastAttemptedPasswordRef.current && lastAttemptedPasswordRef.current === password) {
      showError("You can’t change your password to the same password. Choose a new one.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    setLoading(false);

    if (error) {
      const msg = (error.message || "").toLowerCase();

      if (
        msg.includes("different") ||
        msg.includes("same password") ||
        msg.includes("same as") ||
        msg.includes("must not be the same")
      ) {
        showError("You can’t change your password to the same password. Choose a new one.");
        return;
      }

      showError(error.message);
      return;
    }

    lastAttemptedPasswordRef.current = password;
    setSuccessVisible(true);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }}>
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>Set a New Password</Text>
          <Text style={styles.subtitle}>
            {checking ? "Validating reset link…" : status}
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
              editable={!loading}
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
              editable={!loading}
            />
          </View>

          <TouchableOpacity
            onPress={updatePassword}
            disabled={loading || !sessionReady}
            style={[
              styles.button,
              (loading || !sessionReady) && { opacity: 0.6 },
            ]}
          >
            {loading ? (
              <ActivityIndicator color={BG} />
            ) : (
              <Text style={styles.buttonText}>UPDATE PASSWORD</Text>
            )}
          </TouchableOpacity>

          {!sessionReady && !checking && (
            <TouchableOpacity style={styles.linkBtn} onPress={goToSignIn}>
              <Text style={styles.linkText}>Go to Sign In</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ✅ SUCCESS MODAL */}
      <Modal transparent visible={successVisible} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Password changed ✅</Text>
              <Pressable onPress={() => setSuccessVisible(false)} hitSlop={10}>
                <Ionicons name="close" size={20} color={SUB} />
              </Pressable>
            </View>

            <Text style={styles.modalText}>
              Your password has been updated successfully.
            </Text>

            <TouchableOpacity
              style={styles.modalPrimary}
              onPress={async () => {
                setSuccessVisible(false);
                await goToSignIn();
              }}
            >
              <Text style={styles.modalPrimaryText}>Go to Sign In</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalSecondary}
              onPress={() => setSuccessVisible(false)}
            >
              <Text style={styles.modalSecondaryText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ✅ ERROR MODAL */}
      <Modal transparent visible={errorVisible} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Can’t update password</Text>
              <Pressable onPress={() => setErrorVisible(false)} hitSlop={10}>
                <Ionicons name="close" size={20} color={SUB} />
              </Pressable>
            </View>

            <Text style={styles.modalText}>{errorText}</Text>

            <TouchableOpacity style={styles.modalPrimary} onPress={() => setErrorVisible(false)}>
              <Text style={styles.modalPrimaryText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: "center" },
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

  linkBtn: { marginTop: 14, alignItems: "center" },
  linkText: { color: GOLD, fontWeight: "800", textDecorationLine: "underline" },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    alignItems: "center",
    padding: 18,
  },
  modalCard: {
    width: "100%",
    maxWidth: 460,
    backgroundColor: "#0C0C0C",
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER,
  },
  modalHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  modalTitle: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  modalText: {
    color: SUB,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 14,
  },
  modalPrimary: {
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 4,
  },
  modalPrimaryText: {
    color: BG,
    fontWeight: "900",
    fontSize: 14,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  modalSecondary: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 10,
  },
  modalSecondaryText: {
    color: TEXT,
    fontWeight: "800",
    fontSize: 13,
  },
});
