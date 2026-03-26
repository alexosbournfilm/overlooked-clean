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

const DARK_BG = '#0D0D0D';
const TEXT_IVORY = '#EDEBE6';

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
      <Stack.Screen
        name="Chats"
        component={ChatsScreen}
        options={{ headerShown: false }}
      />

      <Stack.Screen
        name="ChatRoom"
        component={ChatRoomScreen}
        options={{
          headerShown: true,
          title: '',
          headerBackTitleVisible: false,
          headerStyle: {
            backgroundColor: DARK_BG,
          },
          headerShadowVisible: false,
          headerTintColor: TEXT_IVORY,
          headerTitleAlign: 'center',
        }}
      />
    </Stack.Navigator>
  );
}