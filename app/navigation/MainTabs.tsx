import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons, MaterialIcons, FontAwesome5 } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native';

import FeaturedScreen from '../screens/FeaturedScreen';
import JobsScreen from '../screens/JobsScreen';
import ChallengeScreen from '../screens/ChallengeScreen';
import LocationScreen from '../screens/LocationScreen';
import ChatsStackNavigator from './ChatsStack';
import ProfileScreen from '../screens/ProfileScreen';
import { COLORS } from '../theme/colors';

const Tab = createBottomTabNavigator();

function withSafeArea(Component: React.ComponentType) {
  return () => (
    <SafeAreaView style={styles.safeArea}>
      <Component />
    </SafeAreaView>
  );
}

export default function MainTabs({ navigation }: any) {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textSecondary,
        tabBarStyle: {
          backgroundColor: COLORS.background,
          borderTopWidth: 0.5,
          borderTopColor: '#ccc',
        },
        tabBarIcon: ({ color, size }) => {
          switch (route.name) {
            case 'Featured':
              return <FontAwesome5 name="star" size={size} color={color} />;
            case 'Jobs':
              return <MaterialIcons name="work-outline" size={size} color={color} />;
            case 'Challenge':
              return <Ionicons name="film-outline" size={size} color={color} />;
            case 'Location':
              return <Ionicons name="location-outline" size={size} color={color} />;
            case 'Chats':
              return <Ionicons name="chatbubble-ellipses-outline" size={size} color={color} />;
            case 'Profile':
              return <Ionicons name="person-outline" size={size} color={color} />;
            default:
              return null;
          }
        },
      })}
    >
      <Tab.Screen name="Featured" component={withSafeArea(FeaturedScreen)} />
      <Tab.Screen name="Jobs" component={withSafeArea(JobsScreen)} />
      <Tab.Screen name="Challenge" component={withSafeArea(ChallengeScreen)} />
      <Tab.Screen name="Location" component={withSafeArea(LocationScreen)} />
      <Tab.Screen name="Chats" component={withSafeArea(ChatsStackNavigator)} />
      <Tab.Screen
        name="Profile"
        component={withSafeArea(ProfileScreen)}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            // Prevent default so we can control navigation
            e.preventDefault();
            // Always navigate to own profile (no params)
            navigation.navigate('Profile', undefined);
          },
        })}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
});
