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
import * as Linking from "expo-linking";
import { useNavigation } from "@react-navigation/native";
import { supabase } from "../lib/supabase";

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

  // Extract ALL possible recovery parameters
  const extractRecoveryParams = (url: string | null) => {
    try {
      const parsed = Linking.parse(url ?? "");

      const params: any = parsed?.queryParams || {};

      return {
        token_hash:
          params["token_hash"] ??
          params["access_token"] ?? // fallback Supabase param on web
          null,
        email: params["email"] ?? null,
        type: params["type"] ?? null,
      };
    } catch {
      return { token_hash: null, email: null, type: null };
    }
  };

  useEffect(() => {
    const handle = async () => {
      const initial = Platform.OS === "web"
        ? window.location.href
        : await Linking.getInitialURL();

      const { token_hash, email, type } = extractRecoveryParams(initial);

      if (!token_hash || !email) {
        console.log("❌ Missing token or email from URL");
        return;
      }

      console.log("🔎 Extracted:", { token_hash, email, type });

      // ALWAYS use type "recovery" here
      const { error } = await supabase.auth.verifyOtp({
        type: "recovery",
        token_hash,
        email,
      });

      if (!error) {
        console.log("✔ Recovery session established");
        setSessionReady(true);
      } else {
        console.log("❌ verifyOtp error:", error.message);
      }
    };

    handle();
  }, []);

  const goToSignIn = () => {
    Platform.OS === "web"
      ? (window.location.href = "/signin")
      : navigation.reset({ index: 0, routes: [{ name: "SignIn" }] });
  };

  const updatePassword = async () => {
    if (!sessionReady)
      return Alert.alert("Invalid Link", "Please open the link from your email.");

    if (!password || !confirm)
      return Alert.alert("Error", "Fill in both fields.");

    if (password !== confirm)
      return Alert.alert("Error", "Passwords do not match.");

    if (password.length < 6)
      return Alert.alert("Error", "Password must be at least 6 characters.");

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    setLoading(false);

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    await supabase.auth.signOut();

    Alert.alert("Success", "Password updated!");
    goToSignIn();
  };

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
});
