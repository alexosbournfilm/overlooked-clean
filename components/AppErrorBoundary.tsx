// components/AppErrorBoundary.tsx
import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform, ScrollView } from 'react-native';
import { navigationRef } from '../app/navigation/navigationRef';

type Props = { children: React.ReactNode };
type State = { error?: Error; info?: string; route?: string };

function getActiveRouteName(state: any): string | undefined {
  try {
    const r = state?.routes?.[state.index ?? 0];
    if (!r) return undefined;
    if (r.state) return getActiveRouteName(r.state);
    return r.name;
  } catch {
    return undefined;
  }
}

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: undefined, info: undefined, route: undefined };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: any) {
    // Capture the current route if possible
    const route = getActiveRouteName(navigationRef.getRootState?.());
    const details =
      typeof info?.componentStack === 'string' ? info.componentStack : JSON.stringify(info ?? {});
    this.setState({ info: details, route });
    // Always log to console for browser devtools (even in prod)
    console.error('[AppErrorBoundary] Crash on route:', route, error, info);
  }

  private handleReload = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
    } else {
      this.setState({ error: undefined, info: undefined });
    }
  };

  render() {
    if (this.state.error) {
      const { error, info, route } = this.state;
      return (
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>Something went wrong.</Text>
          {route ? <Text style={styles.sub}>Route: {route}</Text> : null}
          <Text style={styles.message}>{error.name}: {error.message}</Text>
          {Platform.OS === 'web' && error.stack ? (
            <Text selectable style={styles.stack}>{error.stack}</Text>
          ) : null}
          {info ? (
            <Text selectable style={styles.stack}>{info}</Text>
          ) : null}
          <Pressable onPress={this.handleReload} style={styles.button}>
            <Text style={styles.buttonText}>
              {Platform.OS === 'web' ? 'Reload' : 'Dismiss'}
            </Text>
          </Pressable>
          <Text style={styles.hint}>
            Open the browser console for more details. This screen only appears on a crash.
          </Text>
        </ScrollView>
      );
    }
    return this.props.children as any;
  }
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 64,
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: '#FFFFFF',
    gap: 8,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#1E1E1E' },
  sub: { fontSize: 12, opacity: 0.8, color: '#1E1E1E', marginBottom: 8 },
  message: {
    fontSize: 14, color: '#1E1E1E', textAlign: 'center', marginBottom: 8, maxWidth: 900,
  },
  stack: {
    fontSize: 12, color: '#333', opacity: 0.85, maxWidth: 1000, lineHeight: 16,
    backgroundColor: '#f7f7f7', borderRadius: 8, padding: 12,
  },
  button: {
    marginTop: 12, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: '#F8A998',
  },
  buttonText: { color: '#fff', fontWeight: '600' },
  hint: { fontSize: 12, opacity: 0.7, marginTop: 6, textAlign: 'center' },
});
