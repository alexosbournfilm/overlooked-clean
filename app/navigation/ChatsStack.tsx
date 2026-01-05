// app/navigation/ChatsStack.tsx
import React from 'react';
import { Platform } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import ChatsScreen from '../screens/ChatsScreen';
import ChatRoomScreen from '../screens/ChatRoom';

export type ChatsStackParamList = {
  Chats: undefined;
  ChatRoom: { conversation?: any; conversationId?: string };
};

const Stack = createNativeStackNavigator<ChatsStackParamList>();

/* ------------------------------- palette ------------------------------- */
const DARK_BG = '#0D0D0D';
const TEXT_IVORY = '#EDEBE6';

/* ------------------------------- fonts --------------------------------- */
const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});

export default function ChatsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: DARK_BG },
        headerShadowVisible: false,
        headerTintColor: TEXT_IVORY,

        // ✅ FIX: keep this minimal — some native-stack typings reject letterSpacing/textTransform
        headerTitleStyle: {
          color: TEXT_IVORY,
          fontFamily: SYSTEM_SANS,
          fontSize: 14,
          fontWeight: '900',
        },

        headerTitleAlign: 'center',
        headerBackTitleVisible: false,
      }}
    >
      {/* ✅ MainTabs provides the global TopBar, so Chats list should NOT render a native header */}
      <Stack.Screen name="Chats" component={ChatsScreen} options={{ headerShown: false }} />

      {/* ✅ Keep a lightweight native header here for back navigation (sits UNDER the global TopBar) */}
      <Stack.Screen
        name="ChatRoom"
        component={ChatRoomScreen}
        options={{
          title: 'Chat',
          headerShown: true,
        }}
      />
    </Stack.Navigator>
  );
}