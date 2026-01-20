// screens/CreateProfileScreen.tsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
  FlatList,
} from 'react-native';

// 👉 ONLY import ToastAndroid conditionally (Android only)
const Toast = Platform.OS === 'android' ? require('react-native').ToastAndroid : null;

import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../lib/supabase';
import { navigationRef } from '../navigation/navigationRef';
import { CommonActions } from '@react-navigation/native';
import { useAuth } from '../context/AuthProvider';
import { useGamification } from '../context/GamificationContext';
import COLORS from '../theme/colors';

// ---------------- THEME ----------------
const DARK_BG = '#0D0D0D';
const ELEVATED = '#171717';
const TEXT_IVORY = '#EDEBE6';
const TEXT_MUTED = '#A7A6A2';
const BORDER = '#2A2A2A';
const GOLD = '#C6A664';

const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});

type DropdownOption = {
  label: string;
  value: number;
  country?: string;
};

export default function CreateProfileScreen() {
  const { profileComplete, refreshProfile } = useAuth();
  const { refresh: refreshGamification } = useGamification();

  // ---------------- FORM STATE ----------------
  const [fullName, setFullName] = useState('');

  // ✅ keep state (no logic changes), but UI will no longer show it
  const [portfolioUrl, setPortfolioUrl] = useState('');

  // ✅ keep state (no logic changes), but UI will no longer show it
  const [image, setImage] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const [mainRole, setMainRole] = useState<number | null>(null);
  const [mainRoleLabel, setMainRoleLabel] = useState<string | null>(null);

  const [roleSearchModalVisible, setRoleSearchModalVisible] = useState(false);
  const [roleSearchTerm, setRoleSearchTerm] = useState('');
  const [roleItems, setRoleItems] = useState<DropdownOption[]>([]);
  const [roleSearchItems, setRoleSearchItems] = useState<DropdownOption[]>([]);
  const [isSearchingRoles, setIsSearchingRoles] = useState(false);

  const [cityId, setCityId] = useState<number | null>(null);
  const [cityLabel, setCityLabel] = useState<string | null>(null);
  const [cityItems, setCityItems] = useState<DropdownOption[]>([]);
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [citySearchTerm, setCitySearchTerm] = useState('');
  const [isSearchingCities, setIsSearchingCities] = useState(false);

  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);

  // ---------------------------------------------------------
  // FETCH CREATIVE ROLES
  // ---------------------------------------------------------
  useEffect(() => {
    fetchCreativeRoles();
  }, []);

  const fetchCreativeRoles = async () => {
    const { data, error } = await supabase
      .from('creative_roles')
      .select('id, name')
      .order('name');

    if (error) return console.error('Error fetching roles:', error.message);

    if (data) {
      setRoleItems(data.map((r) => ({ label: r.name, value: r.id })));
    }
  };

  // ---------------------------------------------------------
  // ROLE SEARCH
  // ---------------------------------------------------------
  const fetchSearchRoles = useCallback(async (text: string) => {
    if (!text.trim()) {
      setRoleSearchItems([]);
      return;
    }
    setIsSearchingRoles(true);

    const { data, error } = await supabase
      .from('creative_roles')
      .select('id, name')
      .ilike('name', `%${text.trim()}%`)
      .order('name')
      .limit(50);

    setIsSearchingRoles(false);

    if (error) {
      console.error('Role fetch error:', error.message);
      return setRoleSearchItems([]);
    }

    setRoleSearchItems((data || []).map((r) => ({ label: r.name, value: r.id })));
  }, []);

  // ---------------------------------------------------------
  // FLAG UTILS
  // ---------------------------------------------------------
  const getFlag = (countryCode: string) => {
    return countryCode
      .toUpperCase()
      .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
  };

  // ---------------------------------------------------------
  // CITY SEARCH
  // ---------------------------------------------------------
  const fetchCities = useCallback(async (text: string) => {
    if (!text || text.trim().length < 1) return;

    setIsSearchingCities(true);

    const query = text.trim();

    const { data, error } = await supabase
      .from('cities')
      .select('id, name, country_code')
      .ilike('name', `%${query}%`)
      .limit(80);

    setIsSearchingCities(false);

    if (error) {
      console.error('City fetch error:', error.message);
      return;
    }

    if (!data) return;

    const exactMatches = data.filter((c) => c.name.toLowerCase() === query.toLowerCase());
    const prefixMatches = data.filter(
      (c) =>
        c.name.toLowerCase().startsWith(query.toLowerCase()) &&
        c.name.toLowerCase() !== query.toLowerCase()
    );
    const containsMatches = data.filter(
      (c) =>
        c.name.toLowerCase().includes(query.toLowerCase()) &&
        !c.name.toLowerCase().startsWith(query.toLowerCase()) &&
        c.name.toLowerCase() !== query.toLowerCase()
    );

    const ordered = [...exactMatches, ...prefixMatches, ...containsMatches];

    setCityItems(
      ordered.map((c) => ({
        label: `${getFlag(c.country_code)} ${c.name}, ${c.country_code}`,
        value: c.id,
        country: c.country_code,
      }))
    );
  }, []);

  // ---------------------------------------------------------
  // IMAGE UPLOAD
  // ---------------------------------------------------------
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
    });

    if (!result.canceled && result.assets.length > 0) {
      const base64 = result.assets[0].base64;
      const uri = result.assets[0].uri;

      if (!base64) return;

      setUploadingImage(true);

      let ext = uri.split('.').pop();
      if (!ext || ext.length > 5) ext = 'jpg';

      const fileName = `${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, decode(base64), { contentType: 'image/*' });

      if (uploadError) {
        setUploadingImage(false);
        return Alert.alert('Upload Error', uploadError.message);
      }

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);

      if (!urlData?.publicUrl) {
        setUploadingImage(false);
        return Alert.alert('Upload Error', 'Could not get URL');
      }

      setImage(uri);
      setImageUrl(urlData.publicUrl);
      setUploadingImage(false);
    }
  };

  // ---------------------------------------------------------
  // REPLACE ToastAndroid WITH SAFE CROSS-PLATFORM TOAST
  // ---------------------------------------------------------
  const showToast = (msg: string) => {
    if (Platform.OS === 'android' && Toast) {
      Toast.show(msg, Toast.SHORT);
    } else {
      Alert.alert(msg);
    }
  };

  // ---------------------------------------------------------
  // SUBMIT PROFILE
  // ---------------------------------------------------------
  const handleSubmit = async () => {
    if (!fullName || !mainRole || !cityId) {
      Alert.alert('Missing Info', 'Please fill in all required fields.');
      return;
    }

    setSaving(true);

    const { data: sessionData, error: userErr } = await supabase.auth.getUser();
    if (userErr) {
      setSaving(false);
      return Alert.alert('Error', userErr.message);
    }

    const userId = sessionData.user?.id;
    if (!userId) {
      setSaving(false);
      return Alert.alert('Error', 'User not authenticated');
    }

    const { data: existingUser } = await supabase
      .from('users')
      .select('id, full_name, main_role_id, city_id')
      .eq('id', userId)
      .maybeSingle();

    const beforeComplete = !!(
      existingUser?.full_name &&
      existingUser?.main_role_id &&
      existingUser?.city_id
    );

    const { data: upserted, error } = await supabase
      .from('users')
      .upsert(
        {
          id: userId,
          full_name: fullName,
          main_role_id: mainRole,
          city_id: cityId,
          avatar_url: imageUrl,
          portfolio_url: portfolioUrl || null,
        },
        { onConflict: 'id' }
      )
      .select('id, full_name, main_role_id, city_id')
      .maybeSingle();

    if (error) {
      setSaving(false);
      return Alert.alert('Error', error.message);
    }

    const afterComplete = !!(upserted?.full_name && upserted?.main_role_id && upserted?.city_id);

    await refreshProfile();
    await refreshGamification();

    const start = Date.now();
    let gate =
      profileComplete ||
      Boolean(upserted?.full_name && upserted?.main_role_id && upserted?.city_id);

    while (!gate && Date.now() - start < 2500) {
      await new Promise((r) => setTimeout(r, 150));
      await refreshProfile();
      gate =
        profileComplete ||
        Boolean(upserted?.full_name && upserted?.main_role_id && upserted?.city_id);
    }

    setSaving(false);
    showToast('Welcome to Overlooked!');

    if (gate && navigationRef.isReady()) {
      navigationRef.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'MainTabs', state: { index: 0, routes: [{ name: 'Featured' }] } }],
        })
      );
    }
  };

  // ---------------------------------------------------------
  // UI
  // ---------------------------------------------------------
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>CREATE YOUR PROFILE</Text>

        {/* FULL NAME */}
        <TextInput
          placeholder="Full Name"
          value={fullName}
          onChangeText={setFullName}
          style={styles.input}
          placeholderTextColor={TEXT_MUTED}
        />

        {/* ROLE SELECT */}
        <TouchableOpacity
          style={styles.selectButton}
          onPress={() => {
            setRoleSearchModalVisible(true);
            setRoleSearchTerm('');
            setRoleSearchItems([]);
          }}
          activeOpacity={0.9}
        >
          <Text style={styles.selectButtonText}>
            {mainRoleLabel ?? 'Search your main creative role'}
          </Text>
        </TouchableOpacity>

        {/* CITY SELECT */}
        <TouchableOpacity
          style={styles.selectButton}
          onPress={() => setSearchModalVisible(true)}
          activeOpacity={0.9}
        >
          <Text style={styles.selectButtonText}>
            {cityLabel ?? 'Spell your city correctly (e.g., Skyros / Skýros)'}
          </Text>
        </TouchableOpacity>

        {/* ✅ NOTE TEXT (new) */}
        <Text style={styles.helperText}>
          You can build on your profile later — add more details, credits, and media anytime from your Profile page.
        </Text>

        {/* ✅ SUBMIT (unchanged logic) */}
        <TouchableOpacity
          onPress={handleSubmit}
          style={[styles.submitButton, (saving || uploadingImage) && { opacity: 0.6 }]}
          disabled={saving || uploadingImage}
          activeOpacity={0.9}
        >
          {saving ? <ActivityIndicator color={TEXT_IVORY} /> : <Text style={styles.submitText}>Finish</Text>}
        </TouchableOpacity>
      </ScrollView>

      {/* ---------------- CITY MODAL ---------------- */}
      <Modal
        visible={searchModalVisible}
        animationType="slide"
        onRequestClose={() => setSearchModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>SEARCH FOR YOUR CITY</Text>

          <TextInput
            placeholder="Start typing..."
            placeholderTextColor={TEXT_MUTED}
            value={citySearchTerm}
            onChangeText={(text) => {
              setCitySearchTerm(text);
              fetchCities(text);
            }}
            style={styles.searchInput}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
          />

          {isSearchingCities ? (
            <ActivityIndicator style={{ marginTop: 20 }} color={GOLD} />
          ) : (
            <FlatList
              data={cityItems}
              keyExtractor={(item) => item.value.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.cityItem}
                  onPress={() => {
                    setCityId(item.value);
                    setCityLabel(item.label);
                    setSearchModalVisible(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.cityItemText}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
          )}

          <TouchableOpacity
            onPress={() => setSearchModalVisible(false)}
            style={styles.closeModalButton}
            activeOpacity={0.8}
          >
            <Text style={styles.closeModalText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ---------------- ROLE MODAL ---------------- */}
      <Modal
        visible={roleSearchModalVisible}
        animationType="slide"
        onRequestClose={() => setRoleSearchModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>SEARCH YOUR MAIN ROLE</Text>

          <TextInput
            placeholder="Start typing a role..."
            placeholderTextColor={TEXT_MUTED}
            value={roleSearchTerm}
            onChangeText={(text) => {
              setRoleSearchTerm(text);
              fetchSearchRoles(text);
            }}
            style={styles.searchInput}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
          />

          {isSearchingRoles ? (
            <ActivityIndicator style={{ marginTop: 20 }} color={GOLD} />
          ) : (
            <FlatList
              data={roleSearchItems.length > 0 ? roleSearchItems : roleItems}
              keyExtractor={(item) => item.value.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.cityItem}
                  onPress={() => {
                    setMainRole(item.value);
                    setMainRoleLabel(item.label);
                    setRoleSearchModalVisible(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.cityItemText}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
          )}

          <TouchableOpacity
            onPress={() => setRoleSearchModalVisible(false)}
            style={styles.closeModalButton}
            activeOpacity={0.8}
          >
            <Text style={styles.closeModalText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------
// STYLES
// ---------------------------------------------------------
const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    backgroundColor: DARK_BG,
    alignItems: 'center',
  },

  title: {
    fontSize: 22,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 24,
    letterSpacing: 1.3,
    fontFamily: SYSTEM_SANS,
    textTransform: 'uppercase',
  },

  input: {
    width: '100%',
    backgroundColor: ELEVATED,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    color: TEXT_IVORY,
    borderWidth: 1,
    borderColor: BORDER,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },

  selectButton: {
    width: '100%',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: ELEVATED,
    marginBottom: 14,
    alignItems: 'center',
  },

  selectButtonText: {
    color: TEXT_IVORY,
    fontSize: 15,
    fontFamily: SYSTEM_SANS,
  },

  helperText: {
    width: '100%',
    textAlign: 'center',
    color: TEXT_MUTED,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 14,
    fontFamily: SYSTEM_SANS,
  },

  submitButton: {
    backgroundColor: GOLD,
    width: '100%',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },

  submitText: {
    color: DARK_BG,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    fontSize: 16,
  },

  modalContainer: {
    flex: 1,
    backgroundColor: DARK_BG,
    padding: 22,
    paddingTop: Platform.OS === 'ios' ? 70 : 40,
  },

  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 18,
    textAlign: 'center',
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },

  searchInput: {
    backgroundColor: ELEVATED,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 10,
  },

  cityItem: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: BORDER,
  },

  cityItemText: {
    fontSize: 15,
    color: TEXT_IVORY,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },

  closeModalButton: {
    marginTop: 24,
    padding: 12,
    borderRadius: 12,
    backgroundColor: ELEVATED,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },

  closeModalText: {
    fontSize: 15,
    color: TEXT_MUTED,
    fontWeight: '700',
    fontFamily: SYSTEM_SANS,
  },
});
