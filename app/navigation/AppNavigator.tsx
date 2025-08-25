// app/navigation/AppNavigator.tsx
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AuthStack from './AuthStack';
import MainTabs from './MainTabs';
import { navigationRef } from './navigationRef';

const Stack = createNativeStackNavigator();

type Props = {
  initialAuthRouteName: 'SignIn' | 'CreateProfile';
};

export default function AppNavigator({ initialAuthRouteName }: Props) {
  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {/* Pass initialRouteName to AuthStack */}
        <Stack.Screen
          name="Auth"
          options={{ headerShown: false }}
        >
          {() => <AuthStack initialRouteName={initialAuthRouteName} />}
        </Stack.Screen>

        <Stack.Screen name="Main" component={MainTabs} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}