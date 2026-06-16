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
        <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
          <View style={styles.brandMark}>
            <Text style={styles.brandText}>OVERLOOKED</Text>
          </View>
          <View style={styles.panel}>
            <Text style={styles.eyebrow}>Playback paused</Text>
            <Text style={styles.title}>Something went wrong.</Text>
            {route ? <Text style={styles.sub}>Route: {route}</Text> : null}
            <Text style={styles.message}>{error.name}: {error.message}</Text>
          </View>
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
  screen: {
    flex: 1,
    backgroundColor: '#050505',
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 56,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#050505',
    gap: 14,
  },
  brandMark: {
    marginBottom: 6,
  },
  brandText: {
    color: '#F4F1EA',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 5,
  },
  panel: {
    width: '100%',
    maxWidth: 720,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(198,166,100,0.28)',
    backgroundColor: '#0B0B0B',
    paddingHorizontal: 22,
    paddingVertical: 20,
    alignItems: 'center',
  },
  eyebrow: {
    color: '#C6A664',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F4F1EA',
    textAlign: 'center',
  },
  sub: {
    fontSize: 12,
    color: 'rgba(244,241,234,0.64)',
    marginTop: 8,
  },
  message: {
    fontSize: 14,
    color: 'rgba(244,241,234,0.82)',
    textAlign: 'center',
    marginTop: 12,
    maxWidth: 900,
  },
  stack: {
    width: '100%',
    maxWidth: 980,
    fontSize: 12,
    color: 'rgba(244,241,234,0.76)',
    lineHeight: 16,
    backgroundColor: '#101010',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 12,
  },
  button: {
    marginTop: 6,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: '#C6A664',
  },
  buttonText: {
    color: '#050505',
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  hint: {
    fontSize: 12,
    color: 'rgba(244,241,234,0.56)',
    marginTop: 2,
    textAlign: 'center',
  },
});
