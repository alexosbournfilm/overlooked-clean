// app/navigation/ChatsStack.tsx
import React from 'react';
import { Platform } from 'react-native';
import { createStackNavigator } from '@react-navigation/stack';

import ChatsScreen from '../screens/ChatsScreen';
import ChatRoomScreen from '../screens/ChatRoom';
import { useAppTheme } from '../context/ThemeContext';
import { getOverlookedStackScreenOptions } from './transitions';

export type ChatsStackParamList = {
  ChatsHome: undefined;
  ChatRoom: {
    conversation?: any;
    conversationId?: string;
    peerUser?: any;
    currentUserId?: string | null;
  };
};

const Stack = createStackNavigator<ChatsStackParamList>();

const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});

export default function ChatsStack() {
  const { colors } = useAppTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        ...getOverlookedStackScreenOptions(colors.background),
        headerStyle: { backgroundColor: colors.background, shadowColor: 'transparent', elevation: 0 },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: {
          color: colors.textPrimary,
          fontFamily: SYSTEM_SANS,
          fontSize: 14,
          fontWeight: '900',
        },
        headerTitleAlign: 'center',
        animationEnabled: true,
      }}
    >
      <Stack.Screen
  name="ChatsHome"
  component={ChatsScreen}
  options={{
    headerShown: false,
  }}
/>

      <Stack.Screen
        name="ChatRoom"
        component={ChatRoomScreen}
        options={{
          headerShown: true,
          title: '',
          headerBackTitleVisible: false,
        }}
      />
    </Stack.Navigator>
  );
}
