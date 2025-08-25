// app/navigation/ChatsStack.tsx
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ChatsScreen from '../screens/ChatsScreen';
import ChatRoomScreen from '../screens/ChatRoom';

// Align types with how you actually navigate
export type ChatsStackParamList = {
  ChatsMain: undefined;
  ChatRoom: { conversation?: any; conversationId?: string };
};

const Stack = createNativeStackNavigator<ChatsStackParamList>();

export default function ChatsStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="ChatsMain"
        component={ChatsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ChatRoom"
        component={ChatRoomScreen}
        // Let ChatRoom set its own title via useLayoutEffect
        options={{ headerTitleAlign: 'center' }}
      />
    </Stack.Navigator>
  );
}
