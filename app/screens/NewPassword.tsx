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
  Alert,
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

  const [email, setEmail] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const goToSignIn = () => {
    if (Platform.OS === "web") {
      window.location.replace("/signin");
    } else {
      navigation.reset({ index: 0, routes: [{ name: "SignIn" }] });
    }
  };

  const handleUpdatePassword = async () => {
    if (!email || !tempPassword || !newPassword || !confirm) {
      return Alert.alert("Missing Fields", "Please fill all fields.");
    }

    if (newPassword !== confirm) {
      return Alert.alert("Error", "Passwords do not match.");
    }

    if (newPassword.length < 6) {
      return Alert.alert("Error", "Password must be at least 6 characters.");
    }

    setLoading(true);

    // 1️⃣ SIGN USER IN WITH TEMP PASSWORD
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: tempPassword,
    });

    if (signInError) {
      setLoading(false);
      return Alert.alert("Error", "Temporary password incorrect.");
    }

    // 2️⃣ UPDATE PASSWORD NOW THAT A SESSION EXISTS
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      setLoading(false);
      return Alert.alert("Error", updateError.message);
    }

    // 3️⃣ SIGN OUT
    await supabase.auth.signOut();

    setLoading(false);
    Alert.alert("Success", "Password updated. Please sign in.");

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
            <Text style={styles.title}>Reset Your Password</Text>

            {/* EMAIL */}
            <View style={styles.inputRow}>
              <Ionicons name="mail" size={16} color={SUB} />
              <TextInput
                placeholder="Email"
                placeholderTextColor={SUB}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                style={styles.input}
              />
            </View>

            {/* TEMP PASSWORD */}
            <View style={styles.inputRow}>
              <Ionicons name="key" size={16} color={SUB} />
              <TextInput
                secureTextEntry
                placeholder="Temporary password from email"
                placeholderTextColor={SUB}
                value={tempPassword}
                onChangeText={setTempPassword}
                style={styles.input}
              />
            </View>

            {/* NEW PW */}
            <View style={styles.inputRow}>
              <Ionicons name="lock-closed" size={16} color={SUB} />
              <TextInput
                secureTextEntry
                placeholder="New password"
                placeholderTextColor={SUB}
                value={newPassword}
                onChangeText={setNewPassword}
                style={styles.input}
              />
            </View>

            {/* CONFIRM */}
            <View style={styles.inputRow}>
              <Ionicons name="shield-checkmark" size={16} color={SUB} />
              <TextInput
                secureTextEntry
                placeholder="Confirm new password"
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
    marginTop: 10,
  },
  buttonText: {
    color: DARK_BG,
    fontSize: 15,
    fontWeight: "900",
  },
});
