// app/navigation/AuthStack.tsx

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import SignInScreen from '../screens/SignInScreen';
import SignUpScreen from '../screens/SignUpScreen';
import ForgotPasswordScreen from '../screens/ForgotPassword';
import CreateProfileScreen from '../screens/CreateProfileScreen';
import NewPasswordScreen from '../screens/NewPassword';   // ✅ ADD THIS

const Stack = createNativeStackNavigator();

type AuthStackProps = {
  initialRouteName: 'SignIn' | 'CreateProfile';
};

export default function AuthStack({ initialRouteName }: AuthStackProps) {
  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={{ headerShown: false }}
    >
      {/* AUTH ENTRY */}
      <Stack.Screen name="SignIn" component={SignInScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />

      {/* PASSWORD RESET REQUEST */}
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />

      {/* ⭐ PASSWORD RESET HANDLING SCREEN */}
      <Stack.Screen name="NewPassword" component={NewPasswordScreen} />

      {/* PROFILE CREATION */}
      <Stack.Screen name="CreateProfile" component={CreateProfileScreen} />
    </Stack.Navigator>
  );
}
