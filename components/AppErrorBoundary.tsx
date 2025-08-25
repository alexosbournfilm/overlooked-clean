// components/AppErrorBoundary.tsx
import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';

type Props = { children: React.ReactNode };
type State = { error?: Error };

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: undefined };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: any) {
    console.error('App crashed:', error, info);
  }

  private handleReload = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
    } else {
      // On native, just clear the error so the user can keep using the app.
      this.setState({ error: undefined });
    }
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong.</Text>
          <Text style={styles.message}>{this.state.error.message}</Text>
          <Pressable onPress={this.handleReload} style={styles.button}>
            <Text style={styles.buttonText}>
              {Platform.OS === 'web' ? 'Reload' : 'Dismiss'}
            </Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children as any;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    paddingTop: 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 8, color: '#1E1E1E' },
  message: {
    fontSize: 14,
    opacity: 0.8,
    marginBottom: 16,
    color: '#1E1E1E',
    textAlign: 'center',
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F8A998', // your primary coral
  },
  buttonText: { color: '#fff', fontWeight: '600' },
});
