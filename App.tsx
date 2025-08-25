import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Linking } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as SplashScreen from 'expo-splash-screen';
import { Provider as PaperProvider } from 'react-native-paper';
import AppNavigator from './app/navigation/AppNavigator';
import { supabase } from './app/lib/supabase';
import { AppErrorBoundary } from './components/AppErrorBoundary';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const [appIsReady, setAppIsReady] = useState(false);
  const [initialAuthRouteName, setInitialAuthRouteName] =
    useState<'SignIn' | 'CreateProfile'>('SignIn');

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        // 1) Restore session
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) console.error('Session error:', sessionError.message);

        const session = sessionData?.session ?? null;

        if (session) {
          // Persist for native; supabase-js already handles web via localStorage
          try {
            await SecureStore.setItemAsync('supabaseSession', JSON.stringify(session));
          } catch {}

          // 2) Check profile completeness
          const { data: userData, error: userError } = await supabase
            .from('users')
            .select('id, full_name, main_role_id, city_id')
            .eq('id', session.user.id)
            .single();

          if (
            userError ||
            !userData ||
            !userData.full_name ||
            !userData.main_role_id ||
            !userData.city_id
          ) {
            setInitialAuthRouteName('CreateProfile');
          } else {
            setInitialAuthRouteName('SignIn');
          }
        }

        // 3) Handle initial deep link
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl) await handleDeepLink({ url: initialUrl });

        // 4) Subscribe to future deep links
        const sub = Linking.addEventListener('url', handleDeepLink);

        if (mounted) {
          setAppIsReady(true);
          SplashScreen.hideAsync().catch(() => {});
        }

        // Cleanup listener
        return () => {
          sub.remove();
        };
      } catch (e) {
        console.error('App init error:', e);
        if (mounted) setAppIsReady(true);
        SplashScreen.hideAsync().catch(() => {});
      }
    };

    init();

    return () => {
      mounted = false;
    };
  }, []);

  const handleDeepLink = async ({ url }: { url: string }) => {
    try {
      const isConfirmationLink = url.includes('code=') || url.includes('access_token=');
      if (!isConfirmationLink) return;

      const { error } = await supabase.auth.exchangeCodeForSession(url);
      if (error) {
        console.error('Exchange error:', error.message);
        return;
      }

      // After confirming via email, ensure user completes profile
      setInitialAuthRouteName('CreateProfile');
    } catch (err) {
      console.error('Deep link handling failed:', err);
    }
  };

  if (!appIsReady) return null;

  return (
    <AppErrorBoundary>
      <PaperProvider>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <AppNavigator initialAuthRouteName={initialAuthRouteName} />
        </SafeAreaProvider>
      </PaperProvider>
    </AppErrorBoundary>
  );
}
