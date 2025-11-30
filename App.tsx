import './app/polyfills'; // must stay first
import React, { useEffect, useState, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Linking } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import * as SecureStore from 'expo-secure-store';
import { Provider as PaperProvider } from 'react-native-paper';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import AppNavigator from './app/navigation/AppNavigator';
import { supabase } from './app/lib/supabase';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { AuthProvider } from './app/context/AuthProvider';
import { GamificationProvider } from './app/context/GamificationContext';
import { navigate } from './app/navigation/navigationRef';

// Fonts
import {
  useFonts as useCourierFonts,
  CourierPrime_400Regular,
  CourierPrime_700Bold,
} from '@expo-google-fonts/courier-prime';

import {
  useFonts as useCinzelFonts,
  Cinzel_400Regular,
  Cinzel_700Bold,
  Cinzel_900Black,
} from '@expo-google-fonts/cinzel';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const [appIsReady, setAppIsReady] = useState(false);
  const [initialAuthRouteName, setInitialAuthRouteName] =
    useState<'SignIn' | 'CreateProfile'>('SignIn');

  const [courierLoaded] = useCourierFonts({
    CourierPrime_400Regular,
    CourierPrime_700Bold,
  });

  const [cinzelLoaded] = useCinzelFonts({
    Cinzel_400Regular,
    Cinzel_700Bold,
    Cinzel_900Black,
  });

  const fontsLoaded = courierLoaded && cinzelLoaded;

  const handleDeepLink = useCallback(async (url: string) => {
    if (!url) return;

    const isSupabaseLink =
      url.includes('access_token=') ||
      url.includes('refresh_token=') ||
      url.includes('type=recovery') ||
      url.includes('code=');

    if (!isSupabaseLink) return;

    const { error } = await supabase.auth.exchangeCodeForSession(url);
    if (error) {
      console.error('exchangeCodeForSession error:', error.message);
      return;
    }

    console.log('Session restored via deep link');
    setInitialAuthRouteName('CreateProfile');
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        console.log('PASSWORD_RECOVERY → navigating to NewPassword');
        navigate('NewPassword');
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData?.session ?? null;

        if (session) {
          await SecureStore.setItemAsync(
            'supabaseSession',
            JSON.stringify(session)
          );

          const { data: profile } = await supabase
            .from('users')
            .select('id, full_name, main_role_id, city_id')
            .eq('id', session.user.id)
            .single();

          setInitialAuthRouteName('CreateProfile');
        }

        const initialUrl = await Linking.getInitialURL();
        if (initialUrl) await handleDeepLink(initialUrl);

        const sub = Linking.addEventListener('url', (e) =>
          handleDeepLink(e.url)
        );

        if (mounted) setAppIsReady(true);

        return () => sub.remove();
      } catch (e) {
        console.error('App init error:', e);
        if (mounted) setAppIsReady(true);
      }
    };

    init();

    return () => {
      mounted = false;
    };
  }, [handleDeepLink]);

  useEffect(() => {
    if (appIsReady && fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [appIsReady, fontsLoaded]);

  if (!appIsReady || !fontsLoaded) return null;

  return (
    <AppErrorBoundary>
      <PaperProvider>
        <SafeAreaProvider>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <StatusBar style="dark" />
            <AuthProvider>
              <GamificationProvider>
                <AppNavigator initialAuthRouteName={initialAuthRouteName} />
              </GamificationProvider>
            </AuthProvider>
          </GestureHandlerRootView>
        </SafeAreaProvider>
      </PaperProvider>
    </AppErrorBoundary>
  );
}
