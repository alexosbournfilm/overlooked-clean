// screens/CreateProfileScreen.tsx
import React, { useEffect, useState, useCallback, useRef } from 'react';
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
  Image,
  useWindowDimensions,
} from 'react-native';

const Toast = Platform.OS === 'android' ? require('react-native').ToastAndroid : null;

import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { CommonActions } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { navigationRef } from '../navigation/navigationRef';
import { useAuth } from '../context/AuthProvider';
import { useGamification } from '../context/GamificationContext';
import AvatarCropper from '../../components/AvatarCropper';

// ---------------- THEME ----------------
const DARK_BG = '#000000';
const CARD = '#0A0A0A';
const ELEVATED = '#111111';
const TEXT_IVORY = '#F5F2EA';
const TEXT_MUTED = '#A7A6A2';
const BORDER = 'rgba(255,255,255,0.10)';
const BORDER_SOFT = 'rgba(255,255,255,0.06)';
const GOLD = '#C6A664';

const SYSTEM_SANS = Platform.select({
  ios: 'Avenir Next',
  android: 'sans-serif',
  web: undefined,
  default: undefined,
});

type DropdownOption = {
  label: string;
  value: number;
  country?: string;
};

const showToast = (msg: string) => {
  if (Platform.OS === 'android' && Toast) {
    Toast.show(msg, Toast.SHORT);
  } else {
    Alert.alert(msg);
  }
};

async function uploadBlobToBucket(opts: {
  bucket: string;
  path: string;
  blob: Blob;
  contentType?: string;
}) {
  const { bucket, path, blob, contentType } = opts;

  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    contentType: contentType || blob.type || undefined,
    upsert: true,
  });

  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('Could not get public URL');

  return data.publicUrl;
}

const normalizeText = (text: string) => text.trim().toLowerCase();

const rankMatch = (candidate: string, query: string) => {
  const c = normalizeText(candidate);
  const q = normalizeText(query);

  if (!q) return 999;

  if (c === q) return 0;
  if (c.startsWith(q)) return 1;

  const words = c.split(/\s+/);
  if (words.includes(q)) return 2;
  if (words.some((word) => word.startsWith(q))) return 3;

  if (c.includes(q)) return 4;

  return 999;
};

export default function CreateProfileScreen() {
  const { width } = useWindowDimensions();
  const { profileComplete, refreshProfile } = useAuth();
  const { refresh: refreshGamification } = useGamification();

  const isMobile = width < 768;

  const roleSearchReq = useRef(0);
  const citySearchReq = useRef(0);

  const [fullName, setFullName] = useState('');

  const [image, setImage] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);

  const [mainRole, setMainRole] = useState<number | null>(null);
  const [mainRoleLabel, setMainRoleLabel] = useState<string | null>(null);

  const [cityId, setCityId] = useState<number | null>(null);
  const [cityLabel, setCityLabel] = useState<string | null>(null);

  const [roleSearchModalVisible, setRoleSearchModalVisible] = useState(false);
  const [roleSearchTerm, setRoleSearchTerm] = useState('');
  const [roleItems, setRoleItems] = useState<DropdownOption[]>([]);
  const [roleSearchItems, setRoleSearchItems] = useState<DropdownOption[]>([]);
  const [isSearchingRoles, setIsSearchingRoles] = useState(false);

  const [citySearchModalVisible, setCitySearchModalVisible] = useState(false);
  const [citySearchTerm, setCitySearchTerm] = useState('');
  const [cityItems, setCityItems] = useState<DropdownOption[]>([]);
  const [isSearchingCities, setIsSearchingCities] = useState(false);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchCreativeRoles();
  }, []);

  const fetchCreativeRoles = async () => {
    const { data, error } = await supabase
      .from('creative_roles')
      .select('id, name')
      .order('name');

    if (error) {
      console.error('Error fetching roles:', error.message);
      return;
    }

    if (data) {
      setRoleItems(data.map((r) => ({ label: r.name, value: r.id })));
    }
  };

  const fetchSearchRoles = useCallback(async (text: string) => {
    const q = text.trim();
    const reqId = ++roleSearchReq.current;

    if (!q) {
      setRoleSearchItems([]);
      setIsSearchingRoles(false);
      return;
    }

    setIsSearchingRoles(true);

    try {
      const { data, error } = await supabase
        .from('creative_roles')
        .select('id, name')
        .ilike('name', `%${q}%`)
        .limit(100);

      if (reqId !== roleSearchReq.current) return;

      if (error) {
        console.error('Role fetch error:', error.message);
        setRoleSearchItems([]);
        return;
      }

      const mapped = (data || []).map((r) => ({
        label: r.name,
        value: r.id,
      }));

      const ordered = mapped.sort((a, b) => {
        const aRank = rankMatch(a.label, q);
        const bRank = rankMatch(b.label, q);

        if (aRank !== bRank) return aRank - bRank;

        return a.label.localeCompare(b.label);
      });

      setRoleSearchItems(ordered);
    } catch (e) {
      console.error('Role fetch fatal:', e);
      if (reqId === roleSearchReq.current) setRoleSearchItems([]);
    } finally {
      if (reqId === roleSearchReq.current) setIsSearchingRoles(false);
    }
  }, []);

  const getFlag = (countryCode: string) => {
    return countryCode
      .toUpperCase()
      .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
  };

  const fetchCities = useCallback(async (text: string) => {
    const q = text.trim();
    const reqId = ++citySearchReq.current;

    if (!q) {
      setCityItems([]);
      setIsSearchingCities(false);
      return;
    }

    setIsSearchingCities(true);

    try {
      const { data, error } = await supabase
        .from('cities')
        .select('id, name, country_code')
        .ilike('name', `%${q}%`)
        .limit(100);

      if (reqId !== citySearchReq.current) return;

      if (error) {
        console.error('City fetch error:', error.message);
        setCityItems([]);
        return;
      }

      const mapped = (data || []).map((c: any) => ({
        label: `${getFlag(c.country_code)} ${c.name}, ${c.country_code}`,
        value: c.id,
        country: c.country_code,
        rawName: c.name,
      }));

      const ordered = mapped
        .sort((a: any, b: any) => {
          const aRank = rankMatch(a.rawName, q);
          const bRank = rankMatch(b.rawName, q);

          if (aRank !== bRank) return aRank - bRank;

          return a.rawName.localeCompare(b.rawName);
        })
        .map(({ rawName, ...rest }: any) => rest);

      setCityItems(ordered);
    } catch (e) {
      console.error('City fetch fatal:', e);
      if (reqId === citySearchReq.current) setCityItems([]);
    } finally {
      if (reqId === citySearchReq.current) setIsSearchingCities(false);
    }
  }, []);

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Please allow access to your photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      base64: false,
    });

    if (result.canceled || !result.assets.length) return;

    const asset = result.assets[0];
    setCropSource(asset.uri);
    setCropperOpen(true);
  };

  const handleAvatarCropped = async (croppedUri: string) => {
    try {
      setUploadingImage(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.id) throw new Error('User not authenticated');

      const fileName = `${Date.now()}_avatar.jpg`;
      const path = `user_${user.id}/${fileName}`;

      const response = await fetch(croppedUri);
      const blob = await response.blob();

      const publicUrl = await uploadBlobToBucket({
        bucket: 'avatars',
        path,
        blob,
        contentType: 'image/jpeg',
      });

      setImage(croppedUri);
      setImageUrl(publicUrl);
    } catch (err: any) {
      Alert.alert('Upload Error', err?.message ?? 'Could not upload image.');
    } finally {
      setUploadingImage(false);
      setCropperOpen(false);
      setCropSource(null);
    }
  };

  const handleSubmit = async () => {
    if (!fullName.trim() || !mainRole || !cityId) {
      Alert.alert('Missing Info', 'Please fill in your name, main role, and city.');
      return;
    }

    if (!imageUrl) {
      Alert.alert('Profile image required', 'Please add a profile image before continuing.');
      return;
    }

    setSaving(true);

    try {
      const { data: sessionData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;

      const userId = sessionData.user?.id;
      if (!userId) throw new Error('User not authenticated');

      const { data: upserted, error } = await supabase
        .from('users')
        .upsert(
          {
            id: userId,
            full_name: fullName.trim(),
            main_role_id: mainRole,
            city_id: cityId,
            avatar_url: imageUrl,
          },
          { onConflict: 'id' }
        )
        .select('id, full_name, main_role_id, city_id')
        .maybeSingle();

      if (error) throw error;

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

      showToast('Welcome to Overlooked!');

      if (gate && navigationRef.isReady()) {
        navigationRef.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'MainTabs', state: { index: 0, routes: [{ name: 'Featured' }] } }],
          })
        );
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not create profile.');
    } finally {
      setSaving(false);
    }
  };

  const loading = saving || uploadingImage;

  const searchInputWebFix =
    Platform.OS === 'web'
      ? ({
          outlineWidth: 0,
          outlineStyle: 'none',
          boxShadow: 'none',
          borderColor: BORDER,
        } as any)
      : null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: DARK_BG }}
    >
      <LinearGradient
        colors={['#000000', '#080808', '#0B0B0B']}
        style={StyleSheet.absoluteFillObject}
      />

      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, !isMobile && styles.cardDesktop]}>
          <Text style={styles.eyebrow}>Join Overlooked</Text>
          <Text style={styles.title}>Create Your Profile</Text>
          <Text style={styles.subtitle}>
            Make a strong first impression. Add your image, choose your role, and start building
            your creative presence.
          </Text>

          <View style={styles.heroAvatarWrap}>
            <TouchableOpacity
              onPress={pickImage}
              activeOpacity={0.9}
              style={styles.avatarButton}
              disabled={uploadingImage || saving}
            >
              {image ? (
                <Image source={{ uri: image }} style={styles.avatarImage} resizeMode="cover" />
              ) : (
                <View style={styles.avatarFallback}>
                  <Ionicons name="camera-outline" size={28} color={GOLD} />
                  <Text style={styles.avatarFallbackText}>Add Profile Image</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={pickImage}
              style={styles.avatarChangeBtn}
              activeOpacity={0.85}
              disabled={uploadingImage || saving}
            >
              {uploadingImage ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <Text style={styles.avatarChangeBtnText}>
                  {image ? 'Change Profile Image' : 'Upload Profile Image'}
                </Text>
              )}
            </TouchableOpacity>

            <Text style={styles.requiredLabel}>Required</Text>
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              placeholder="Your full name"
              value={fullName}
              onChangeText={setFullName}
              style={[styles.input, searchInputWebFix]}
              placeholderTextColor={TEXT_MUTED}
            />
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Main Role</Text>
            <TouchableOpacity
              style={styles.selectButton}
              onPress={() => {
                setRoleSearchModalVisible(true);
                setRoleSearchTerm('');
                setRoleSearchItems([]);
                setIsSearchingRoles(false);
              }}
              activeOpacity={0.9}
            >
              <Text style={styles.selectButtonText}>
                {mainRoleLabel ?? 'Search your main creative role'}
              </Text>
              <Ionicons name="search" size={16} color={TEXT_MUTED} />
            </TouchableOpacity>
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>City</Text>
            <TouchableOpacity
              style={styles.selectButton}
              onPress={() => {
                setCitySearchModalVisible(true);
                setCitySearchTerm('');
                setCityItems([]);
                setIsSearchingCities(false);
              }}
              activeOpacity={0.9}
            >
              <Text style={styles.selectButtonText}>
                {cityLabel ?? 'Search for your city'}
              </Text>
              <Ionicons name="location-outline" size={16} color={TEXT_MUTED} />
            </TouchableOpacity>
          </View>

          <View style={styles.infoBox}>
            <Text style={styles.infoBoxTitle}>Showreels and portfolio</Text>
            <Text style={styles.infoBoxText}>
              You can add showreels, thumbnails, and more portfolio content once your account is created from your Profile page.
            </Text>
          </View>

          <TouchableOpacity
            onPress={handleSubmit}
            style={[styles.submitButton, loading && { opacity: 0.6 }]}
            disabled={loading}
            activeOpacity={0.9}
          >
            {loading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.submitText}>Finish</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal
        visible={citySearchModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCitySearchModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCardFixed}>
            <Text style={styles.modalTitle}>Select City</Text>

            <TextInput
              placeholder="Start typing your city..."
              placeholderTextColor={TEXT_MUTED}
              value={citySearchTerm}
              onChangeText={(text) => {
                setCitySearchTerm(text);
                fetchCities(text);
              }}
              style={[styles.searchInput, searchInputWebFix]}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
            />

            <View style={styles.modalResultsArea}>
              {isSearchingCities ? (
                <View style={styles.modalLoadingWrap}>
                  <ActivityIndicator color={GOLD} />
                </View>
              ) : (
                <FlatList
                  data={cityItems}
                  keyExtractor={(item) => item.value.toString()}
                  style={styles.resultsList}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.listItem}
                      onPress={() => {
                        setCityId(item.value);
                        setCityLabel(item.label);
                        setCitySearchModalVisible(false);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.listItemText}>{item.label}</Text>
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    <Text style={styles.emptyText}>
                      No cities found yet. Try a broader search like “Rome” or “Lon”.
                    </Text>
                  }
                />
              )}
            </View>

            <TouchableOpacity
              onPress={() => setCitySearchModalVisible(false)}
              style={styles.closeModalButton}
              activeOpacity={0.8}
            >
              <Text style={styles.closeModalText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={roleSearchModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRoleSearchModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCardFixed}>
            <Text style={styles.modalTitle}>Select Main Role</Text>

            <TextInput
              placeholder="Start typing a role..."
              placeholderTextColor={TEXT_MUTED}
              value={roleSearchTerm}
              onChangeText={(text) => {
                setRoleSearchTerm(text);
                fetchSearchRoles(text);
              }}
              style={[styles.searchInput, searchInputWebFix]}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
            />

            <View style={styles.modalResultsArea}>
              {isSearchingRoles ? (
                <View style={styles.modalLoadingWrap}>
                  <ActivityIndicator color={GOLD} />
                </View>
              ) : (
                <FlatList
                  data={roleSearchTerm.trim().length > 0 ? roleSearchItems : roleItems}
                  keyExtractor={(item) => item.value.toString()}
                  style={styles.resultsList}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.listItem}
                      onPress={() => {
                        setMainRole(item.value);
                        setMainRoleLabel(item.label);
                        setRoleSearchModalVisible(false);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.listItemText}>{item.label}</Text>
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    <Text style={styles.emptyText}>Start typing to search roles.</Text>
                  }
                />
              )}
            </View>

            <TouchableOpacity
              onPress={() => setRoleSearchModalVisible(false)}
              style={styles.closeModalButton}
              activeOpacity={0.8}
            >
              <Text style={styles.closeModalText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <AvatarCropper
        visible={cropperOpen}
        imageUri={cropSource || undefined}
        onCancel={() => {
          setCropperOpen(false);
          setCropSource(null);
        }}
        onCropped={handleAvatarCropped}
        fullName={fullName || ''}
        mainRoleName={mainRoleLabel || ''}
        cityName={cityLabel || ''}
        level={1}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 18,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: DARK_BG,
  },

  card: {
    width: '100%',
    maxWidth: 620,
    backgroundColor: CARD,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: BORDER_SOFT,
    padding: 22,
  },

  cardDesktop: {
    padding: 28,
  },

  eyebrow: {
    color: GOLD,
    textAlign: 'center',
    fontSize: 12,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    marginBottom: 8,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },

  title: {
    fontSize: 28,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 10,
    letterSpacing: 0.6,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },

  subtitle: {
    color: TEXT_MUTED,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 22,
    fontFamily: SYSTEM_SANS,
  },

  heroAvatarWrap: {
    alignItems: 'center',
    marginBottom: 20,
  },

  avatarButton: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: ELEVATED,
    borderWidth: 1.5,
    borderColor: 'rgba(198,166,100,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  avatarImage: {
    width: '100%',
    height: '100%',
  },

  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },

  avatarFallbackText: {
    color: TEXT_IVORY,
    marginTop: 8,
    fontSize: 12,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },

  avatarChangeBtn: {
    marginTop: 12,
    backgroundColor: GOLD,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  avatarChangeBtnText: {
    color: '#000',
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  requiredLabel: {
    marginTop: 10,
    color: GOLD,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
  },

  fieldBlock: {
    marginBottom: 16,
  },

  fieldLabel: {
    color: TEXT_MUTED,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    marginBottom: 8,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },

  input: {
    width: '100%',
    backgroundColor: ELEVATED,
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 16,
    color: TEXT_IVORY,
    borderWidth: 1,
    borderColor: BORDER,
    fontFamily: SYSTEM_SANS,
    fontSize: 15,
  },

  selectButton: {
    width: '100%',
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: ELEVATED,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  selectButtonText: {
    color: TEXT_IVORY,
    fontSize: 15,
    fontFamily: SYSTEM_SANS,
    flex: 1,
    paddingRight: 12,
  },

  infoBox: {
    marginTop: 4,
    marginBottom: 18,
    backgroundColor: ELEVATED,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },

  infoBoxTitle: {
    color: GOLD,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.3,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    marginBottom: 8,
  },

  infoBoxText: {
    color: TEXT_MUTED,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: SYSTEM_SANS,
  },

  submitButton: {
    backgroundColor: GOLD,
    width: '100%',
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 4,
  },

  submitText: {
    color: DARK_BG,
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 16,
    letterSpacing: 0.4,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: '#000000CC',
    justifyContent: 'center',
    padding: 18,
  },

  modalCardFixed: {
    width: '100%',
    maxWidth: 620,
    height: 460,
    alignSelf: 'center',
    backgroundColor: CARD,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
  },

  modalTitle: {
    fontSize: 19,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 14,
    textAlign: 'center',
    letterSpacing: 0.8,
    fontFamily: SYSTEM_SANS,
    textTransform: 'uppercase',
  },

  searchInput: {
    backgroundColor: ELEVATED,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: BORDER,
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
    fontSize: 15,
  },

  modalResultsArea: {
    flex: 1,
    minHeight: 0,
    marginTop: 10,
  },

  modalLoadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  resultsList: {
    width: '100%',
    flex: 1,
  },

  listItem: {
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderColor: BORDER_SOFT,
  },

  listItemText: {
    fontSize: 15,
    color: TEXT_IVORY,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },

  emptyText: {
    marginTop: 24,
    textAlign: 'center',
    color: TEXT_MUTED,
    fontSize: 13,
    fontFamily: SYSTEM_SANS,
    lineHeight: 18,
  },

  closeModalButton: {
    marginTop: 16,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: ELEVATED,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },

  closeModalText: {
    fontSize: 14,
    color: TEXT_MUTED,
    fontWeight: '700',
    fontFamily: SYSTEM_SANS,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
});