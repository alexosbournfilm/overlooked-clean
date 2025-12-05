// app/screens/NewPassword.tsx
import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";

const DARK = "#000";
const CARD = "#0B0B0B";
const GOLD = "#C6A664";
const TEXT = "#F5F3EF";
const SUB = "#A9A7A3";
const BORDER = "#262626";

export default function NewPassword({ navigation }: any) {
  const [email, setEmail] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const handleReset = async () => {
    if (!email || !tempPassword || !newPassword || !confirm) {
      return Alert.alert("Missing Fields", "Fill in all fields.");
    }

    if (newPassword !== confirm) {
      return Alert.alert("Error", "Passwords do not match.");
    }

    setLoading(true);

    // 1️⃣ Sign user in with TEMP password
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: tempPassword,
    });

    if (signInError) {
      setLoading(false);
      return Alert.alert("Login Failed", "Temp password is incorrect.");
    }

    // 2️⃣ Update to the NEW password
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      setLoading(false);
      return Alert.alert("Error", updateError.message);
    }

    // 3️⃣ Sign out and send to login
    await supabase.auth.signOut();

    setLoading(false);
    Alert.alert("Success", "Your password has been updated.");

    navigation.reset({
      index: 0,
      routes: [{ name: "SignIn" }],
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DARK }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.wrapper}>
          <View style={styles.card}>
            <Text style={styles.title}>Reset Your Password</Text>

            <Text style={styles.label}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="your@email.com"
              placeholderTextColor={SUB}
              style={styles.input}
            />

            <Text style={styles.label}>Temporary Password</Text>
            <TextInput
              value={tempPassword}
              onChangeText={setTempPassword}
              placeholder="Temp password from email"
              placeholderTextColor={SUB}
              secureTextEntry
              style={styles.input}
            />

            <Text style={styles.label}>New Password</Text>
            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="New password"
              placeholderTextColor={SUB}
              secureTextEntry
              style={styles.input}
            />

            <Text style={styles.label}>Confirm Password</Text>
            <TextInput
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Confirm new password"
              placeholderTextColor={SUB}
              secureTextEntry
              style={styles.input}
            />

            <TouchableOpacity
              onPress={handleReset}
              disabled={loading}
              style={styles.button}
            >
              {loading ? (
                <ActivityIndicator color={DARK} />
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
  card: {
    backgroundColor: CARD,
    padding: 24,
    borderRadius: 16,
    borderColor: BORDER,
    borderWidth: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: TEXT,
    marginBottom: 20,
    textAlign: "center",
  },
  label: {
    color: SUB,
    marginBottom: 4,
    marginTop: 10,
  },
  input: {
    color: TEXT,
    backgroundColor: "#0A0A0A",
    borderRadius: 10,
    padding: 12,
    borderColor: BORDER,
    borderWidth: 1,
  },
  button: {
    backgroundColor: GOLD,
    padding: 14,
    borderRadius: 10,
    marginTop: 22,
    alignItems: "center",
  },
  buttonText: {
    color: DARK,
    fontWeight: "800",
    fontSize: 16,
  },
});
