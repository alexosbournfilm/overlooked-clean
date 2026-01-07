// app/screens/ForgotPassword.tsx
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
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { supabase } from "../lib/supabase";

const BG = "#0D0D0D";
const CARD = "#121212";
const TEXT = "#EFEFEF";
const SUB = "#A8A8A8";
const GOLD = "#C6A664";
const BORDER = "#2A2A2A";

export default function ForgotPassword() {
  const navigation = useNavigation<any>();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");

  const handleReset = async () => {
    const trimmed = email.trim();

    if (!trimmed) {
      setMessage("Please enter your email.");
      return;
    }

    // light validation (prevents accidental blanks/spaces)
    if (!trimmed.includes("@") || !trimmed.includes(".")) {
      setMessage("Please enter a valid email address.");
      return;
    }

    setSending(true);
    setMessage("");

    // ✅ IMPORTANT:
    // This MUST match the route that actually renders NewPassword.tsx on web,
    // and your deep link route on native.
    const redirectTo = Platform.select({
      web: "https://overlooked.cloud/reset-password",
      default: "overlooked://reset-password",
    });

    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo,
    });

    setSending(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Check your email for the reset link.");
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.container}>
          <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={20} color={SUB} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <View style={styles.card}>
            <Text style={styles.title}>Reset Your Password</Text>
            <Text style={styles.subtitle}>Enter the email linked to your account.</Text>

            <View style={styles.inputRow}>
              <Ionicons name="mail" size={16} color={SUB} />
              <TextInput
                placeholder="Email"
                placeholderTextColor={SUB}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                style={styles.input}
              />
            </View>

            <TouchableOpacity
              onPress={handleReset}
              disabled={sending}
              style={[styles.button, sending && { opacity: 0.7 }]}
            >
              {sending ? (
                <ActivityIndicator color={BG} />
              ) : (
                <Text style={styles.buttonText}>SEND RESET EMAIL</Text>
              )}
            </TouchableOpacity>

            {!!message && <Text style={styles.message}>{message}</Text>}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, alignItems: "center" },
  back: { flexDirection: "row", alignSelf: "flex-start", marginBottom: 16 },
  backText: { color: SUB, marginLeft: 4, fontSize: 15 },
  card: {
    width: "100%",
    maxWidth: 420,
    padding: 24,
    borderRadius: 16,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  title: {
    textAlign: "center",
    color: TEXT,
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 6,
  },
  subtitle: {
    textAlign: "center",
    color: SUB,
    marginBottom: 20,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  input: { flex: 1, color: TEXT, fontSize: 15 },
  button: {
    paddingVertical: 14,
    backgroundColor: GOLD,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonText: {
    color: BG,
    fontWeight: "900",
    fontSize: 15,
  },
  message: {
    marginTop: 16,
    color: SUB,
    textAlign: "center",
  },
});
