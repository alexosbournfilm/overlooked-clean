// app/navigation/ChatsStack.tsx
import React from 'react';
import { Platform } from 'react-native';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';

import ChatsScreen from '../screens/ChatsScreen';
import ChatRoomScreen from '../screens/ChatRoom';

export type ChatsStackParamList = {
  ChatsHome: undefined;
  ChatRoom: {
    conversation?: any;
    conversationId?: string;
    peerUser?: any;
  };
};

const Stack = createStackNavigator<ChatsStackParamList>();

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
        headerStyle: { backgroundColor: DARK_BG, shadowColor: 'transparent', elevation: 0 },
        headerTintColor: TEXT_IVORY,
        headerTitleStyle: {
          color: TEXT_IVORY,
          fontFamily: SYSTEM_SANS,
          fontSize: 14,
          fontWeight: '900',
        },
        headerTitleAlign: 'center',
        cardStyle: { backgroundColor: DARK_BG },
        gestureEnabled: true,
        ...(Platform.OS === 'ios'
          ? {
              cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
              transitionSpec: {
                open: {
                  animation: 'timing',
                  config: { duration: 220 },
                },
                close: {
                  animation: 'timing',
                  config: { duration: 220 },
                },
              },
            }
          : {
              cardStyleInterpolator: CardStyleInterpolators.forFadeFromBottomAndroid,
              transitionSpec: {
                open: {
                  animation: 'timing',
                  config: { duration: 220 },
                },
                close: {
                  animation: 'timing',
                  config: { duration: 220 },
                },
              },
            }),
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