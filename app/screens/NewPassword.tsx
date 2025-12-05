// app/screens/NewPassword.tsx
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import * as Linking from "expo-linking";
import { supabase } from "../lib/supabase";

const DARK_BG = "#000";
const CARD_BG = "#0B0B0B";
const GOLD = "#C6A664";
const TEXT = "#F5F3EF";
const SUB = "#A9A7A3";
const BORDER = "#262626";

export default function NewPassword() {
  const navigation = useNavigation<any>();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [tokenHash, setTokenHash] = useState<string | null>(null);

  // Parse token_hash from URL
  const parseTokenHash = (url: string | null) => {
    if (!url) return null;

    const parsed = Linking.parse(url);
    let params: Record<string, any> = {};

    // Web: token arrives in ?token_hash=
    if (Platform.OS === "web") {
      const search = new URLSearchParams(window.location.search);
      search.forEach((v, k) => (params[k] = v));
    }

    // Mobile: token arrives in queryParams
    if (parsed?.queryParams) {
      params = { ...params, ...parsed.queryParams };
    }

    return params["token_hash"] ?? null;
  };

  // Restore recovery session using Supabase verifyOtp
  const restoreSession = async (url: string | null) => {
    const hash = parseTokenHash(url);
    if (!hash) return;

    setTokenHash(hash);
    console.log("🔐 Token hash received:", hash);

    const { data, error } = await supabase.auth.verifyOtp({
      type: "recovery",
      token_hash: hash,
    });

    if (error) {
      console.log("❌ verifyOtp failed:", error.message);
      return;
    }

    console.log("✔ Recovery session verified");
    setSessionReady(true);
  };

  useEffect(() => {
    const init = async () => {
      if (Platform.OS === "web") {
        await restoreSession(window.location.href);
      } else {
        const initial = await Linking.getInitialURL();
        await restoreSession(initial);
      }

      const sub = Linking.addEventListener("url", async (event) => {
        await restoreSession(event.url);
      });

      return () => sub.remove();
    };

    init();
  }, []);

  // Redirect back to sign in
  const goToSignIn = () => {
    if (Platform.OS === "web") {
      window.location.replace("/signin");
      return;
    }
    navigation.reset({ index: 0, routes: [{ name: "SignIn" }] });
  };

  // Update password
  const handleUpdatePassword = async () => {
    if (!sessionReady) {
      return Alert.alert(
        "Session Not Ready",
        "Your reset link is invalid or expired. Please open the link again."
      );
    }

    if (!password || !confirm)
      return Alert.alert("Missing Fields", "Please fill both fields.");

    if (password !== confirm)
      return Alert.alert("Error", "Passwords do not match.");

    if (password.length < 6)
      return Alert.alert("Error", "Password must be at least 6 characters.");

    setLoading(true);

    const { error } = await supabase.auth.updateUser({
      password: password.trim(),
    });

    if (error) {
      setLoading(false);
      return Alert.alert("Error", error.message);
    }

    // Must sign out after password update
    await supabase.auth.signOut();

    setLoading(false);
    Alert.alert("Success", "Your password has been updated.");
    goToSignIn();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DARK_BG }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.wrapper}>
          <TouchableOpacity onPress={goToSignIn} style={styles.back}>
            <Ionicons name="chevron-back" size={18} color={SUB} />
            <Text style={styles.backLabel}>Back to Sign In</Text>
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
              onPress={handleUpdatePassword}
              disabled={loading}
              style={[styles.button, loading && { opacity: 0.6 }]}
            >
              {loading ? (
                <ActivityIndicator color={DARK_BG} />
              ) : (
                <Text style={styles.buttonText}>UPDATE PASSWORD</Text>
              )}
            </TouchableOpacity>

            {!sessionReady && (
              <Text
                style={{
                  color: "red",
                  marginTop: 10,
                  textAlign: "center",
                }}
              >
                Waiting for recovery session…
              </Text>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, padding: 24 },
  back: { flexDirection: "row", alignItems: "center", marginBottom: 25 },
  backLabel: { marginLeft: 6, fontSize: 15, color: SUB },
  card: {
    backgroundColor: CARD_BG,
    padding: 26,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
  },
  title: {
    fontSize: 22,
    color: TEXT,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 4,
  },
  subtitle: {
    color: SUB,
    textAlign: "center",
    marginBottom: 18,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    backgroundColor: "#0A0A0A",
  },
  input: {
    flex: 1,
    marginLeft: 10,
    color: TEXT,
    fontSize: 15,
  },
  button: {
    backgroundColor: GOLD,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonText: {
    color: DARK_BG,
    fontSize: 15,
    fontWeight: "900",
  },
});
