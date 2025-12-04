// app/screens/NewPassword.tsx
import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
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

  /* ------------------------------------------------------------------
     After password update → AuthProvider (USER_UPDATED) handles redirect.
     This screen should ONLY update the password. Nothing else.
  ------------------------------------------------------------------ */
  const handleUpdatePassword = async () => {
    if (!password || !confirm) return alert("Fill both fields.");
    if (password !== confirm) return alert("Passwords do not match.");
    if (password.length < 6) return alert("Password too short.");

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: password.trim(),
      });

      if (error) {
        alert(error.message);
        setLoading(false);
        return;
      }

      // ⚡ DO NOT navigate manually here
      // AuthProvider listens for USER_UPDATED and handles the redirect.
      alert("Password updated! Redirecting…");

    } catch (err) {
      console.log("Unexpected error:", err);
      alert("Unexpected error");
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    navigation.goBack();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DARK_BG }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.wrapper}>
          <TouchableOpacity onPress={goBack} style={styles.back}>
            <Ionicons name="chevron-back" size={18} color={SUB} />
            <Text style={styles.backLabel}>Back</Text>
          </TouchableOpacity>

          <View style={styles.card}>
            <Text style={styles.title}>Set a New Password</Text>
            <Text style={styles.subtitle}>Enter and confirm your password.</Text>

            <View style={styles.inputRow}>
              <Ionicons name="lock-closed" size={16} color={SUB} />
              <TextInput
                placeholder="New password"
                placeholderTextColor={SUB}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                style={styles.input}
              />
            </View>

            <View style={styles.inputRow}>
              <Ionicons name="shield-checkmark" size={16} color={SUB} />
              <TextInput
                placeholder="Confirm password"
                placeholderTextColor={SUB}
                secureTextEntry
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
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    padding: 24,
  },
  back: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 25,
  },
  backLabel: {
    marginLeft: 6,
    fontSize: 15,
    color: SUB,
  },
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
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    backgroundColor: "#0A0A0A",
  },
  input: {
    flex: 1,
    marginLeft: 10,
    fontSize: 15,
    color: TEXT,
  },
  button: {
    backgroundColor: GOLD,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 6,
  },
  buttonText: {
    color: DARK_BG,
    fontSize: 15,
    fontWeight: "900",
  },
});
