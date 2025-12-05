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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import * as Linking from "expo-linking";
import { supabase } from "../lib/supabase";

const BG = "#000";
const CARD = "#0B0B0B";
const TEXT = "#F5F3EF";
const SUB = "#A9A7A3";
const GOLD = "#C6A664";
const BORDER = "#262626";

declare global {
  interface Window {
    __didReloadForReset?: boolean;
  }
}

export default function NewPassword() {
  const navigation = useNavigation<any>();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState(false); // show success UI

  // -------------------------------------------------------
  // SAFARI FIX: ONE-TIME FORCED RELOAD TO RESTORE QUERY PARAMS
  // -------------------------------------------------------
  useEffect(() => {
    if (Platform.OS === "web") {
      const hasTokens =
        window.location.search.includes("token") ||
        window.location.search.includes("access_token") ||
        window.location.search.includes("refresh_token") ||
        window.location.hash.includes("token");

      if (hasTokens && !window.__didReloadForReset) {
        window.__didReloadForReset = true;

        // ONE-TIME real reload - NO infinite loop
        const url = window.location.href;
        setTimeout(() => {
          window.location.href = url;
        }, 50);

        return; // stop here on first load
      }
    }
  }, []);

  // -------------------------------------------------------
  // TOKEN PARSER (WORKS FOR ALL SUPABASE FLOWS)
  // -------------------------------------------------------
  const parseTokens = () => {
    let params: Record<string, any> = {};

    // Hash tokens (#access_token=)
    if (Platform.OS === "web") {
      const hash = window.location.hash?.replace(/^#/, "") ?? "";
      const hashParams = new URLSearchParams(hash);
      hashParams.forEach((v, k) => (params[k] = v));
    }

    // Query params (?token_hash=)
    const query = new URLSearchParams(window.location.search);
    query.forEach((v, k) => (params[k] = v));

    return {
      access_token: params["access_token"] || null,
      refresh_token: params["refresh_token"] || null,
      token_hash: params["token_hash"] || null,
      email: params["email"] || null,
      type: params["type"] || null,
    };
  };

  // -------------------------------------------------------
  // ESTABLISH RECOVERY SESSION
  // -------------------------------------------------------
  const establishSession = async () => {
    const { access_token, refresh_token, token_hash, email } = parseTokens();

    console.log("Parsed reset tokens:", {
      access_token,
      refresh_token,
      token_hash,
      email,
    });

    // CASE 1: Full session from hash
    if (access_token && refresh_token) {
      const { error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });
      if (!error) return true;
    }

    // CASE 2: Standard password recovery
    if (token_hash && email) {
      const { error } = await supabase.auth.verifyOtp({
        type: "recovery",
        token_hash,
        email,
      });
      if (!error) return true;
    }

    console.log("❌ Failed to establish recovery session");
    return false;
  };

  useEffect(() => {
    const run = async () => {
      const ok = await establishSession();
      if (ok) {
        setSessionReady(true);
        console.log("✔ Recovery session established");

        // Clean URL
        if (Platform.OS === "web") {
          const clean = window.location.origin + window.location.pathname;
          window.history.replaceState({}, document.title, clean);
        }
      }
    };
    run();
  }, []);

  // -------------------------------------------------------
  // UPDATE PASSWORD
  // -------------------------------------------------------
  const updatePassword = async () => {
    if (!sessionReady) {
      Alert.alert(
        "Invalid link",
        "Open the password reset link directly from your email."
      );
      return;
    }

    if (!password || !confirm)
      return Alert.alert("Missing Fields", "Enter both fields.");
    if (password !== confirm)
      return Alert.alert("Mismatch", "Passwords do not match.");
    if (password.length < 6)
      return Alert.alert("Weak Password", "Minimum 6 characters.");

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    setLoading(false);

    if (error) {
      Alert.alert("Update Failed", error.message);
      return;
    }

    console.log("✔ Password updated!");

    // Show checkmark success
    setUpdated(true);

    await supabase.auth.signOut();

    setTimeout(() => {
      Alert.alert("Success", "Your password has been updated!");
      goToSignIn();
    }, 1200);
  };

  const goToSignIn = () => {
    if (Platform.OS === "web") {
      window.location.href = "/signin";
    } else {
      navigation.reset({ index: 0, routes: [{ name: "SignIn" }] });
    }
  };

  // -------------------------------------------------------
  // UI
  // -------------------------------------------------------
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }}>
      <View style={styles.container}>
        <TouchableOpacity onPress={goToSignIn} style={styles.back}>
          <Ionicons name="chevron-back" size={18} color={SUB} />
          <Text style={styles.backText}>Back to Sign In</Text>
        </TouchableOpacity>

        <View style={styles.card}>
          <Text style={styles.title}>Set a New Password</Text>
          <Text style={styles.subtitle}>Enter your new password below.</Text>

          {/* SUCCESS CHECKMARK */}
          {updated && (
            <View style={styles.successBox}>
              <Ionicons name="checkmark-circle" size={42} color={GOLD} />
              <Text style={styles.successText}>Password Updated!</Text>
            </View>
          )}

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
            style={[styles.button, loading && { opacity: 0.5 }]}
          >
            {loading ? (
              <ActivityIndicator color={BG} />
            ) : (
              <Text style={styles.buttonText}>UPDATE PASSWORD</Text>
            )}
          </TouchableOpacity>

          {!sessionReady && (
            <Text style={styles.error}>Waiting for valid reset link…</Text>
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
  successBox: {
    alignItems: "center",
    marginBottom: 18,
  },
  successText: {
    color: GOLD,
    marginTop: 6,
    fontSize: 16,
    fontWeight: "700",
  },
});
