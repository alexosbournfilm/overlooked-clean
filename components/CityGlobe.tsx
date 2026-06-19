import React, { useMemo } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export type CityGlobeUser = {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  level?: number | null;
  cityName?: string | null;
  countryCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type CityGlobeLocation = {
  name: string;
  countryCode: string;
  latitude: number;
  longitude: number;
};

export type CityGlobeProps = {
  city: CityGlobeLocation | null;
  users: CityGlobeUser[];
  searched: boolean;
  onUserPress: (user: CityGlobeUser) => void;
  backgroundColor: string;
  surfaceColor: string;
  surfaceAltColor: string;
  borderColor: string;
  textColor: string;
  mutedTextColor: string;
  accentColor: string;
};

const clampLatitude = (latitude: number) => Math.max(-84, Math.min(84, latitude));

const getCoordinate = (user: CityGlobeUser, fallbackCity: CityGlobeLocation | null) => {
  if (user.latitude != null && user.longitude != null) {
    const latitude = Number(user.latitude);
    const longitude = Number(user.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) return { latitude, longitude };
  }

  if (fallbackCity) return fallbackCity;
  return null;
};

const projectCoordinate = (coordinate: Pick<CityGlobeLocation, 'latitude' | 'longitude'>) => ({
  left: `${((coordinate.longitude + 180) / 360) * 100}%` as any,
  top: `${((90 - clampLatitude(coordinate.latitude)) / 180) * 100}%` as any,
});

const getInitials = (name: string) => {
  const parts = (name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  return parts.map((part) => part[0]?.toUpperCase()).join('') || 'OL';
};

export default function CityGlobe({
  city,
  users,
  searched,
  onUserPress,
  surfaceColor,
  surfaceAltColor,
  borderColor,
  textColor,
  mutedTextColor,
  accentColor,
}: CityGlobeProps) {
  const visibleUsers = useMemo(
    () =>
      users
        .map((user) => {
          const coordinate = getCoordinate(user, city);
          return coordinate ? { user, position: projectCoordinate(coordinate) } : null;
        })
        .filter((item): item is { user: CityGlobeUser; position: ReturnType<typeof projectCoordinate> } => !!item)
        .slice(0, 40),
    [city, users]
  );
  const statusText = city
    ? searched
      ? `${users.length} ${users.length === 1 ? 'profile' : 'profiles'}`
      : 'City selected'
    : `${users.length} located ${users.length === 1 ? 'profile' : 'profiles'}`;

  return (
    <View style={styles.shell}>
      <View
        style={[
          styles.globe,
          {
            backgroundColor: surfaceColor,
            borderColor,
            shadowColor: accentColor,
          },
        ]}
      >
        <View style={[styles.gridLine, styles.gridLineVertical, { backgroundColor: borderColor }]} />
        <View style={[styles.gridLine, styles.gridLineHorizontal, { backgroundColor: borderColor }]} />
        <View style={[styles.landMass, styles.landMassOne, { backgroundColor: accentColor }]} />
        <View style={[styles.landMass, styles.landMassTwo, { backgroundColor: accentColor }]} />
        <View style={[styles.landMass, styles.landMassThree, { backgroundColor: accentColor }]} />

        {city ? (
          <View
            style={[
              styles.cityDot,
              projectCoordinate(city),
              { borderColor: accentColor, backgroundColor: surfaceAltColor },
            ]}
          >
            <Text style={[styles.cityDotText, { color: textColor }]} numberOfLines={1}>
              {city.countryCode}
            </Text>
          </View>
        ) : null}

        {visibleUsers.map(({ user, position }) => {
          return (
            <TouchableOpacity
              key={user.id}
              activeOpacity={0.84}
              onPress={() => onUserPress(user)}
              style={[
                styles.profilePin,
                position,
                {
                  borderColor: accentColor,
                  backgroundColor: surfaceAltColor,
                },
              ]}
            >
              {user.avatar_url ? (
                <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
              ) : (
                <Text style={[styles.initials, { color: textColor }]}>{getInitials(user.full_name)}</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={[styles.hud, { backgroundColor: surfaceColor, borderColor }]}>
        <Text style={[styles.hudTitle, { color: textColor }]} numberOfLines={1}>
          {city ? `${city.name}, ${city.countryCode}` : 'Worldwide'}
        </Text>
        <Text style={[styles.hudMeta, { color: mutedTextColor }]} numberOfLines={1}>
          {statusText}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    width: '100%',
    minHeight: 340,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  globe: {
    width: 280,
    height: 280,
    borderRadius: 140,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  gridLine: {
    position: 'absolute',
    opacity: 0.65,
  },
  gridLineVertical: {
    width: 1,
    height: '100%',
    left: '50%',
  },
  gridLineHorizontal: {
    width: '100%',
    height: 1,
    top: '50%',
  },
  landMass: {
    position: 'absolute',
    opacity: 0.28,
  },
  landMassOne: {
    width: 86,
    height: 56,
    borderRadius: 28,
    left: 48,
    top: 72,
    transform: [{ rotate: '-18deg' }],
  },
  landMassTwo: {
    width: 98,
    height: 70,
    borderRadius: 35,
    right: 46,
    top: 74,
    transform: [{ rotate: '12deg' }],
  },
  landMassThree: {
    width: 68,
    height: 94,
    borderRadius: 34,
    left: 112,
    bottom: 42,
    transform: [{ rotate: '18deg' }],
  },
  cityDot: {
    position: 'absolute',
    width: 48,
    height: 34,
    marginLeft: -24,
    marginTop: -17,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cityDotText: {
    fontSize: 11,
    fontWeight: '900',
  },
  profilePin: {
    position: 'absolute',
    width: 42,
    height: 42,
    marginLeft: -21,
    marginTop: -21,
    borderRadius: 21,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  initials: {
    fontSize: 12,
    fontWeight: '900',
  },
  hud: {
    minWidth: 190,
    maxWidth: '86%',
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  hudTitle: {
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
  hudMeta: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
});
