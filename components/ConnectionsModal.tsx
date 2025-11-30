// app/components/ConnectionsModal.tsx

import React, { useEffect, useState, useCallback } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../app/lib/supabase";

/* --------------------- UI palette --------------------- */
const DARK_BG = "#0D0D0D";
const DARK_ELEVATED = "#171717";
const TEXT_IVORY = "#EDEBE6";
const TEXT_MUTED = "#A7A6A2";
const GOLD = "#C6A664";
const DIVIDER = "#2A2A2A";

/* ------------------------- fonts ----------------------- */
const SYSTEM_SANS = Platform.select({
  ios: "System",
  android: "Roboto",
  web: undefined,
});

/* ---------------------- Props ------------------------- */
type ConnectionsModalProps = {
  visible: boolean;
  onClose: () => void;
  userId: string;
  profileOwnerName: string;       // NEW
  onSelectUser?: (id: string) => void;
};

export const ConnectionsModal: React.FC<ConnectionsModalProps> = ({
  visible,
  onClose,
  userId,
  profileOwnerName,
  onSelectUser,
}) => {
  const [activeTab, setActiveTab] =
    useState<"supporters" | "supporting">("supporters");

  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<any[]>([]);

  /* ------------------------------------------------------
     LOAD SUPPORTERS / SUPPORTING
  ------------------------------------------------------ */
  const load = useCallback(async () => {
    if (!visible || !userId) return;

    setLoading(true);

    try {
      if (activeTab === "supporters") {
        const { data } = await supabase
          .from("user_supporters")
          .select("other_user_id, full_name, avatar_url, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        setEntries(
          (data || []).map((row) => ({
            id: row.other_user_id,
            full_name: row.full_name,
            avatar_url: row.avatar_url,
            created_at: row.created_at,
            relation: "supports_you",
          }))
        );
      }

      if (activeTab === "supporting") {
        const { data } = await supabase
          .from("user_supporting")
          .select("other_user_id, full_name, avatar_url, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        setEntries(
          (data || []).map((row) => ({
            id: row.other_user_id,
            full_name: row.full_name,
            avatar_url: row.avatar_url,
            created_at: row.created_at,
            relation: "you_support",
          }))
        );
      }
    } catch (err) {
      console.log("ConnectionsModal load error:", err);
      setEntries([]);
    }

    setLoading(false);
  }, [visible, activeTab, userId]);

  useEffect(() => {
    if (visible) load();
  }, [visible, activeTab]);

  /* ------------------------------------------------------
     RENDER ENTRY ROW
  ------------------------------------------------------ */
  const renderRow = (person: any) => {
    const initials = person.full_name
      ? person.full_name
          .split(" ")
          .map((p: string) => p[0])
          .join("")
          .toUpperCase()
      : "??";

    /* Dynamic relation text */
    let relationText = "";
    if (person.relation === "supports_you") {
      relationText =
        profileOwnerName === "You"
          ? "Supports you"
          : `Supports ${profileOwnerName}`;
    } else if (person.relation === "you_support") {
      relationText =
        profileOwnerName === "You"
          ? "You support"
          : `${profileOwnerName} supports`;
    }

    return (
      <TouchableOpacity
        key={person.id}
        style={styles.row}
        onPress={() => onSelectUser && onSelectUser(person.id)}
        activeOpacity={0.8}
      >
        {/* avatar */}
        <View style={styles.avatarWrap}>
          {person.avatar_url ? (
            <Image source={{ uri: person.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarFallbackText}>{initials}</Text>
            </View>
          )}
        </View>

        {/* name + relation */}
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{person.full_name}</Text>
          <Text style={styles.meta}>{relationText}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  /* ------------------------------------------------------
     EMPTY STATE TEXT (Dynamic)
  ------------------------------------------------------ */
  const emptyMsg =
    activeTab === "supporters"
      ? profileOwnerName === "You"
        ? "You have no supporters yet."
        : `${profileOwnerName} has no supporters yet.`
      : profileOwnerName === "You"
      ? "You are not supporting anyone."
      : `${profileOwnerName} is not supporting anyone.`;

  /* ------------------------------------------------------
     UI
  ------------------------------------------------------ */
  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Support</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color={TEXT_MUTED} />
            </Pressable>
          </View>

          {/* Tabs */}
          <View style={styles.tabs}>
            {[
              ["supporters", "Supporters"],
              ["supporting", "Supporting"],
            ].map(([key, label]) => (
              <Pressable
                key={key}
                style={[
                  styles.tab,
                  activeTab === key && styles.tabActive,
                ]}
                onPress={() => setActiveTab(key as any)}
              >
                <Text
                  style={[
                    styles.tabText,
                    activeTab === key && styles.tabTextActive,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* List */}
          <View style={{ flex: 1 }}>
            {loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={GOLD} />
              </View>
            ) : entries.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>{emptyMsg}</Text>
              </View>
            ) : (
              <ScrollView>{entries.map(renderRow)}</ScrollView>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

/* ------------------- styles ------------------- */

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  card: {
    maxHeight: "82%",
    borderRadius: 18,
    backgroundColor: DARK_BG,
    padding: 14,
    borderWidth: 1,
    borderColor: DIVIDER,
  },
  header: {
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.8,
    color: TEXT_IVORY,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
  },
  closeBtn: {
    position: "absolute",
    right: 4,
    padding: 6,
  },
  tabs: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 10,
    marginBottom: 10,
  },
  tab: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: DARK_ELEVATED,
  },
  tabActive: {
    backgroundColor: GOLD,
  },
  tabText: {
    fontSize: 11,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },
  tabTextActive: {
    color: "#000",
    fontWeight: "700",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: DIVIDER,
  },
  avatarWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    overflow: "hidden",
    backgroundColor: "#222",
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  avatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#333",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "800",
  },
  name: {
    color: TEXT_IVORY,
    fontSize: 13,
    fontWeight: "800",
  },
  meta: {
    color: TEXT_MUTED,
    fontSize: 10,
    marginTop: 2,
  },
  loadingWrap: {
    paddingVertical: 30,
    alignItems: "center",
  },
  emptyWrap: {
    paddingVertical: 30,
    alignItems: "center",
  },
  emptyText: {
    color: TEXT_MUTED,
    fontSize: 11,
    textAlign: "center",
  },
});

export default ConnectionsModal;
