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
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, CommonActions } from "@react-navigation/native";
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
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Waiting for valid reset link…");

  // ✅ Keep the last known “current” password the user typed earlier in this session
  // (Best-effort only. We can’t truly know their old password unless they entered it.)
  const lastAttemptedPasswordRef = useRef<string>("");

  // ✅ Success modal
  const [successVisible, setSuccessVisible] = useState(false);

  // ✅ Error modal (for in-app indication)
  const [errorVisible, setErrorVisible] = useState(false);
  const [errorText, setErrorText] = useState("Something went wrong.");

  const showInlineError = (msg: string) => {
    // Web fallback (optional)
    if (Platform.OS === "web" && typeof window !== "undefined") {
      try {
        // still show in-app modal too, but this helps debugging on web
        // window.alert(msg);
      } catch {}
    }
    setErrorText(msg);
    setErrorVisible(true);
  };

  const goToSignIn = async () => {
    try {
      await supabase.auth.signOut();
    } catch {}

    if (Platform.OS === "web") {
      window.location.assign("/signin");
      return;
    }

    // Your app may have SignIn directly in root, or inside Auth stack.
    // We keep it simple (direct SignIn). If your navigator uses Auth stack,
    // change route to: { name: "Auth", params: { screen: "SignIn" } }
    const action = CommonActions.reset({
      index: 0,
      routes: [{ name: "SignIn" }],
    });

    if (navigationRef.isReady()) navigationRef.dispatch(action);
    else navigation.dispatch(action);
  };

  // ------------------------------------------------------------
  // 🔑 HANDLE PKCE PASSWORD RECOVERY
  // ------------------------------------------------------------
  useEffect(() => {
    const handleUrl = async (url: string) => {
      try {
        if (!url.includes("code=")) return;

        const { error } = await supabase.auth.exchangeCodeForSession(url);

        if (error) {
          setStatus("Reset link expired or invalid.");
          setSessionReady(false);
          return;
        }

        setSessionReady(true);
        setStatus("Ready to reset password");

        // Clean URL (web)
        if (Platform.OS === "web") {
          const clean = window.location.origin + window.location.pathname;
          window.history.replaceState({}, document.title, clean);
        }
      } catch (e) {
        console.log("Recovery exchange error:", e);
        setStatus("Invalid reset link.");
        setSessionReady(false);
      }
    };

    // Web initial
    if (Platform.OS === "web" && typeof window !== "undefined") {
      handleUrl(window.location.href);
    }

    // Native deep link listener
    const sub = Linking.addEventListener("url", (event) => handleUrl(event.url));

    return () => sub.remove();
  }, []);

  // ------------------------------------------------------------
  // UPDATE PASSWORD (with in-app indication)
  // ------------------------------------------------------------
  const updatePassword = async () => {
    if (!sessionReady) {
      showInlineError("This reset link is invalid. Please request a new one from Sign In.");
      return;
    }

    if (!password || !confirm) {
      showInlineError("Please fill in both fields.");
      return;
    }

    if (password !== confirm) {
      showInlineError("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      showInlineError("Password must be at least 6 characters.");
      return;
    }

    // ✅ Best-effort “same password” guard:
    // If the user just tried this same password in this reset session already, block it.
    // (We can't know their real old password — but this catches the common "I hit update twice" / same value issue.)
    if (lastAttemptedPasswordRef.current && lastAttemptedPasswordRef.current === password) {
      showInlineError("You can’t change your password to the same password. Choose a new one.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    setLoading(false);

    if (error) {
      const msg = (error.message || "").toLowerCase();

      // ✅ Some providers return messages like:
      // "New password should be different from the old password"
      // or "same password" etc.
      if (
        msg.includes("different") ||
        msg.includes("same password") ||
        msg.includes("same as") ||
        msg.includes("must not be the same")
      ) {
        showInlineError("You can’t change your password to the same password. Choose a new one.");
        return;
      }

      showInlineError(error.message);
      return;
    }

    // record last attempted password in this reset session
    lastAttemptedPasswordRef.current = password;

    // ✅ Show success popup
    setSuccessVisible(true);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }}>
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>Set a New Password</Text>
          <Text style={styles.subtitle}>{status}</Text>

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
            disabled={loading}
            style={[styles.button, loading && { opacity: 0.6 }]}
          >
            {loading ? (
              <ActivityIndicator color={BG} />
            ) : (
              <Text style={styles.buttonText}>UPDATE PASSWORD</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* ✅ SUCCESS POPUP MODAL */}
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

      {/* ✅ ERROR POPUP MODAL */}
      <Modal transparent visible={errorVisible} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Something went wrong</Text>
              <Pressable onPress={() => setErrorVisible(false)} hitSlop={10}>
                <Ionicons name="close" size={20} color={SUB} />
              </Pressable>
            </View>

            <Text style={styles.modalText}>{errorText}</Text>

            <TouchableOpacity
              style={styles.modalPrimary}
              onPress={() => setErrorVisible(false)}
            >
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

  // Modals
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
