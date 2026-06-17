import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import PrivacyPolicyModal from '../../components/PrivacyPolicyModal';
import { useAppTheme } from '../context/ThemeContext';

export default function PrivacyPolicyScreen() {
  const navigation = useNavigation<any>();
  const { colors } = useAppTheme();

  const closePrivacyPolicy = useCallback(() => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }

    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Auth', state: { routes: [{ name: 'SignIn' }] } }],
      })
    );
  }, [navigation]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <PrivacyPolicyModal visible onClose={closePrivacyPolicy} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
