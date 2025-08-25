import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ToastAndroid,
  ScrollView,
  Modal,
  FlatList,
} from 'react-native';
// Removed DropDownPicker (replaced with searchable modal)
// import DropDownPicker from 'react-native-dropdown-picker';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../lib/supabase';
import COLORS from '../theme/colors';
import { navigationRef } from '../navigation/navigationRef';
import { CommonActions } from '@react-navigation/native';

type DropdownOption = {
  label: string;
  value: number;
  country?: string;
};

export default function CreateProfileScreen() {
  // Form fields
  const [fullName, setFullName] = useState('');
  const [portfolioUrl, setPortfolioUrl] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // Role picker (updated to searchable modal)
  const [mainRole, setMainRole] = useState<number | null>(null);
  const [mainRoleLabel, setMainRoleLabel] = useState<string | null>(null);

  // Role search modal state (like Jobs role filter)
  const [roleSearchModalVisible, setRoleSearchModalVisible] = useState(false);
  const [roleSearchTerm, setRoleSearchTerm] = useState('');
  const [roleItems, setRoleItems] = useState<DropdownOption[]>([]); // initial full list (optional)
  const [roleSearchItems, setRoleSearchItems] = useState<DropdownOption[]>([]);
  const [isSearchingRoles, setIsSearchingRoles] = useState(false);

  // City state (custom modal like LocationScreen)
  const [cityId, setCityId] = useState<number | null>(null);
  const [cityLabel, setCityLabel] = useState<string | null>(null);
  const [cityItems, setCityItems] = useState<DropdownOption[]>([]);
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [citySearchTerm, setCitySearchTerm] = useState('');
  const [isSearchingCities, setIsSearchingCities] = useState(false);

  // Loading flags
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingForm, setUploadingForm] = useState(false);

  useEffect(() => {
    fetchCreativeRoles(); // optional initial list to show something before searching
  }, []);

  const fetchCreativeRoles = async () => {
    const { data, error } = await supabase
      .from('creative_roles')
      .select('id, name')
      .order('name');
    if (error) console.error('Error fetching roles:', error.message);
    if (data) {
      const items = data.map((role) => ({ label: role.name, value: role.id }));
      setRoleItems(items);
    }
  };

  // On-demand role search (mirrors Jobs filter)
  const fetchSearchRoles = useCallback(async (text: string) => {
    if (!text || text.trim().length < 1) {
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
      setRoleSearchItems([]);
      return;
    }

    setRoleSearchItems(
      (data || []).map((r) => ({
        label: r.name,
        value: r.id,
      }))
    );
  }, []);

  const getFlag = (countryCode: string) => {
    // Same emoji flag trick as LocationScreen
    return countryCode
      .toUpperCase()
      .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
  };

  const fetchCities = useCallback(async (text: string) => {
    if (!text || text.trim().length < 2) return;
    setIsSearchingCities(true);

    const { data, error } = await supabase
      .from('cities')
      .select('id, name, country_code')
      .ilike('name', `%${text.trim()}%`)
      .limit(30);

    setIsSearchingCities(false);

    if (error) {
      console.error('City fetch error:', error.message);
      return;
    }

    if (data) {
      const formatted = data.map((c) => ({
        label: `${getFlag(c.country_code)} ${c.name}, ${c.country_code}`,
        value: c.id,
        country: c.country_code,
      }));
      setCityItems(formatted);
    }
  }, []);

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

      let fileExt = uri.split('.').pop();
      if (!fileExt || fileExt.length > 5) fileExt = 'jpg';

      const fileName = `${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, decode(base64), {
          contentType: 'image/*',
        });

      if (uploadError) {
        Alert.alert('Upload Error', uploadError.message);
        setUploadingImage(false);
        return;
      }

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);

      if (!urlData?.publicUrl) {
        Alert.alert('Upload Error', 'Failed to retrieve uploaded image URL.');
        setUploadingImage(false);
        return;
      }

      setImage(uri);
      setImageUrl(urlData.publicUrl);
      setUploadingImage(false);
    }
  };

  const showToast = (message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } else {
      Alert.alert(message);
    }
  };

  const handleSubmit = async () => {
    if (!fullName || !mainRole || !cityId) {
      Alert.alert('Missing Info', 'Please fill in all required fields.');
      return;
    }

    setUploadingForm(true);

    const { data: sessionData } = await supabase.auth.getUser();
    const userId = sessionData.user?.id;

    if (!userId) {
      Alert.alert('Error', 'User not authenticated.');
      setUploadingForm(false);
      return;
    }

    const { error } = await supabase.from('users').upsert({
      id: userId,
      full_name: fullName,
      main_role_id: mainRole,
      city_id: cityId,
      avatar_url: imageUrl,
      portfolio_url: portfolioUrl || null,
    });

    setUploadingForm(false);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      showToast('Welcome to Overlooked!');
      if (navigationRef.isReady()) {
        navigationRef.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [
              {
                name: 'Main',
                state: {
                  index: 0,
                  routes: [{ name: 'Featured' }],
                },
              },
            ],
          })
        );
      }
    }
  };

  // ——— UI ———

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        <Text style={styles.title}>Create Your Profile</Text>

        <TextInput
          placeholder="Full Name"
          value={fullName}
          onChangeText={setFullName}
          style={styles.input}
          placeholderTextColor="#999"
        />

        {/* Main Role — searchable modal trigger (like Jobs role filter) */}
        <TouchableOpacity
          style={styles.roleSelectButton}
          onPress={() => {
            setRoleSearchModalVisible(true);
            setRoleSearchTerm('');
            setRoleSearchItems([]); // clear previous search
          }}
          activeOpacity={0.9}
        >
          <Text style={styles.roleSelectButtonText}>
            {mainRoleLabel ? mainRoleLabel : 'Search your main creative role'}
          </Text>
        </TouchableOpacity>

        {/* City selector — matches LocationScreen look & behavior */}
        <TouchableOpacity
          style={styles.citySelectButton}
          onPress={() => setSearchModalVisible(true)}
          activeOpacity={0.9}
        >
          <Text style={styles.citySelectButtonText}>
            {cityLabel ? cityLabel : 'Spell your city correctly, e.g. Skyros / Skýros'}
          </Text>
        </TouchableOpacity>

        <TextInput
          placeholder="YouTube Portfolio URL (optional)"
          value={portfolioUrl}
          onChangeText={setPortfolioUrl}
          style={styles.input}
          placeholderTextColor="#999"
        />

        <TouchableOpacity onPress={pickImage} style={styles.imageButton} activeOpacity={0.9}>
          <Text style={styles.imageButtonText}>
            {uploadingImage
              ? 'Uploading...'
              : image
              ? 'Change Profile Picture'
              : 'Upload Profile Picture'}
          </Text>
        </TouchableOpacity>

        {image && <Image source={{ uri: image }} style={styles.avatar} />}

        <TouchableOpacity
          onPress={handleSubmit}
          style={styles.submitButton}
          disabled={uploadingForm || uploadingImage}
          activeOpacity={0.9}
        >
          {uploadingForm ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Finish</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* City Search Modal — cloned style from LocationScreen */}
      <Modal
        visible={searchModalVisible}
        animationType="slide"
        onRequestClose={() => setSearchModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Search for your city</Text>

          <TextInput
            placeholder="Start typing..."
            placeholderTextColor="#aaa"
            value={citySearchTerm}
            onChangeText={(text) => {
              setCitySearchTerm(text);
              fetchCities(text);
            }}
            style={styles.searchInput}
          />

          {isSearchingCities ? (
            <ActivityIndicator style={{ marginTop: 20 }} />
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
                  activeOpacity={0.85}
                >
                  <Text style={styles.cityItemText}>{item.label}</Text>
                </TouchableOpacity>
              )}
              keyboardShouldPersistTaps="handled"
            />
          )}

          <TouchableOpacity
            onPress={() => setSearchModalVisible(false)}
            style={styles.closeModalButton}
            activeOpacity={0.9}
          >
            <Text style={styles.closeModalText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Role Search Modal — same UX as Jobs filter */}
      <Modal
        visible={roleSearchModalVisible}
        animationType="slide"
        onRequestClose={() => setRoleSearchModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Search your main role</Text>

          <TextInput
            placeholder="Start typing a role…"
            placeholderTextColor="#aaa"
            value={roleSearchTerm}
            onChangeText={(text) => {
              setRoleSearchTerm(text);
              fetchSearchRoles(text);
            }}
            style={styles.searchInput}
            autoFocus
          />

          {isSearchingRoles ? (
            <ActivityIndicator style={{ marginTop: 20 }} />
          ) : (
            <FlatList
              data={roleSearchItems.length > 0 ? roleSearchItems : roleItems /* fallback to initial list */}
              keyExtractor={(item) => item.value.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.cityItem}
                  onPress={() => {
                    setMainRole(item.value);
                    setMainRoleLabel(item.label);
                    setRoleSearchModalVisible(false);
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.cityItemText}>{item.label}</Text>
                </TouchableOpacity>
              )}
              keyboardShouldPersistTaps="handled"
            />
          )}

          <TouchableOpacity
            onPress={() => setRoleSearchModalVisible(false)}
            style={styles.closeModalButton}
            activeOpacity={0.9}
          >
            <Text style={styles.closeModalText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: COLORS.background,
    flexGrow: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  // Role select button (replaces dropdown)
  roleSelectButton: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    backgroundColor: COLORS.card,
    marginBottom: 12,
  },
  roleSelectButtonText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    textAlign: 'center',
  },

  // City select button — matches LocationScreen
  citySelectButton: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    backgroundColor: COLORS.card,
    marginBottom: 12,
  },
  citySelectButtonText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    textAlign: 'center',
  },

  imageButton: {
    backgroundColor: COLORS.mutedCard,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  imageButtonText: {
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignSelf: 'center',
    marginBottom: 20,
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  submitText: {
    color: COLORS.textOnPrimary,
    fontWeight: '600',
  },

  // Modal styles (from LocationScreen)
  modalContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 16,
    textAlign: 'center',
  },
  searchInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.card,
  },
  cityItem: {
    padding: 14,
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
  },
  cityItemText: {
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  closeModalButton: {
    marginTop: 20,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: COLORS.mutedCard,
  },
  closeModalText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
});
