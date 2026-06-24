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
const normalizeLongitude = (longitude: number) => ((((longitude + 180) % 360) + 360) % 360) - 180;
const MAX_CITY_PROFILE_PINS = 18;
const MAX_WORLD_PROFILE_PINS = 48;

type UserPlot = {
  user: CityGlobeUser;
  coordinate: {
    latitude: number;
    longitude: number;
  };
};

const getCoordinate = (user: CityGlobeUser, fallbackCity: CityGlobeLocation | null) => {
  if (user.latitude != null && user.longitude != null) {
    const latitude = Number(user.latitude);
    const longitude = Number(user.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude: clampLatitude(latitude), longitude: normalizeLongitude(longitude) };
    }
  }

  if (fallbackCity && Number.isFinite(fallbackCity.latitude) && Number.isFinite(fallbackCity.longitude)) {
    return {
      latitude: clampLatitude(fallbackCity.latitude),
      longitude: normalizeLongitude(fallbackCity.longitude),
    };
  }

  return null;
};

const projectCoordinate = (coordinate: Pick<CityGlobeLocation, 'latitude' | 'longitude'>) => ({
  left: `${((normalizeLongitude(coordinate.longitude) + 180) / 360) * 100}%` as any,
  top: `${((90 - clampLatitude(coordinate.latitude)) / 180) * 100}%` as any,
});

const coordinateKey = (coordinate: Pick<CityGlobeLocation, 'latitude' | 'longitude'>) =>
  `${coordinate.latitude.toFixed(3)}:${coordinate.longitude.toFixed(3)}`;

const isNearCity = (
  coordinate: Pick<CityGlobeLocation, 'latitude' | 'longitude'>,
  city: CityGlobeLocation | null
) => {
  if (!city) return false;
  const latitudeDelta = Math.abs(coordinate.latitude - city.latitude);
  const longitudeDelta = Math.abs(coordinate.longitude - city.longitude);
  return latitudeDelta <= 0.08 && longitudeDelta <= 0.08;
};

const scatterCoordinate = (
  coordinate: Pick<CityGlobeLocation, 'latitude' | 'longitude'>,
  index: number,
  total: number,
  mode: 'city' | 'world'
) => {
  if (total <= 1) {
    return {
      latitude: clampLatitude(coordinate.latitude),
      longitude: normalizeLongitude(coordinate.longitude),
    };
  }

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const angle = mode === 'city' ? index * goldenAngle : (index / Math.max(total, 1)) * Math.PI * 2;
  const baseRing = mode === 'city' ? 0.46 : 0.42;
  const ringStep = mode === 'city' ? 0.24 : 0.18;
  const ringSize = mode === 'city' ? 8 : 12;
  const ring = baseRing + Math.floor(index / ringSize) * ringStep;
  const latOffset = Math.sin(angle) * ring;
  const lonScale = Math.max(0.35, Math.cos((coordinate.latitude * Math.PI) / 180));
  const lonOffset = (Math.cos(angle) * ring) / lonScale;

  return {
    latitude: clampLatitude(coordinate.latitude + latOffset),
    longitude: normalizeLongitude(coordinate.longitude + lonOffset),
  };
};

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
  const plottedUsers = useMemo(
    () =>
      users
        .map((user) => {
          const coordinate = getCoordinate(user, city);
          return coordinate ? { user, coordinate } : null;
        })
        .filter((item): item is UserPlot => !!item),
    [city, users]
  );

  const cityUsers = useMemo(
    () => (city ? plottedUsers.filter(({ coordinate }) => isNearCity(coordinate, city)) : []),
    [city, plottedUsers]
  );

  const visibleCityUsers = useMemo(
    () =>
      cityUsers
        .slice()
        .sort((a, b) => Number(Boolean(b.user.avatar_url)) - Number(Boolean(a.user.avatar_url)))
        .slice(0, MAX_CITY_PROFILE_PINS),
    [cityUsers]
  );

  const worldProfilePins = useMemo(() => {
    const locationMap = new Map<string, UserPlot[]>();

    plottedUsers.forEach(({ user, coordinate }) => {
      if (city && isNearCity(coordinate, city)) return;

      const key = coordinateKey(coordinate);
      const existing = locationMap.get(key);
      if (existing) existing.push({ user, coordinate });
      else locationMap.set(key, [{ user, coordinate }]);
    });

    const pins: UserPlot[] = [];
    const locationGroups = Array.from(locationMap.values())
      .map((locationUsers) =>
        locationUsers
          .slice()
          .sort((a, b) => Number(Boolean(b.user.avatar_url)) - Number(Boolean(a.user.avatar_url)))
      )
      .sort((a, b) => {
        const aCoordinate = a[0]?.coordinate;
        const bCoordinate = b[0]?.coordinate;
        if (!aCoordinate || !bCoordinate) return 0;
        const aSpread = ((aCoordinate.longitude + 180) / 360 + 0.61803398875) % 1;
        const bSpread = ((bCoordinate.longitude + 180) / 360 + 0.61803398875) % 1;
        return aSpread - bSpread || aCoordinate.latitude - bCoordinate.latitude;
      });

    for (let pass = 0; pins.length < MAX_WORLD_PROFILE_PINS; pass += 1) {
      let added = false;

      locationGroups.forEach((locationUsers) => {
        if (pins.length >= MAX_WORLD_PROFILE_PINS) return;
        const plot = locationUsers[pass];
        if (!plot) return;

        pins.push({
          user: plot.user,
          coordinate: scatterCoordinate(plot.coordinate, pass, locationUsers.length, 'world'),
        });
        added = true;
      });

      if (!added) break;
    }

    return pins;
  }, [city, plottedUsers]);

  const visiblePins = useMemo(() => {
    const locationCounts = new Map<string, number>();
    visibleCityUsers.forEach(({ coordinate }) => {
      const key = coordinateKey(coordinate);
      locationCounts.set(key, (locationCounts.get(key) ?? 0) + 1);
    });

    const locationIndexes = new Map<string, number>();
    const cityPins = visibleCityUsers.map(({ user, coordinate }) => {
      const key = coordinateKey(coordinate);
      const index = locationIndexes.get(key) ?? 0;
      const total = locationCounts.get(key) ?? 1;
      locationIndexes.set(key, index + 1);

      return {
        user,
        mode: 'city' as const,
        position: projectCoordinate(scatterCoordinate(coordinate, index, total, city ? 'city' : 'world')),
      };
    });

    const worldPins = worldProfilePins.map(({ user, coordinate }) => ({
      user,
      mode: 'world' as const,
      position: projectCoordinate(coordinate),
    }));

    return [...cityPins, ...worldPins];
  }, [city, visibleCityUsers, worldProfilePins]);

  const profileCount = city && searched ? cityUsers.length : users.length;
  const statusText = city
    ? searched
      ? `${profileCount} ${profileCount === 1 ? 'profile' : 'profiles'}`
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

        {city && visibleCityUsers.length === 0 ? (
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

        {visiblePins.map(({ user, position, mode }, index) => {
          return (
            <TouchableOpacity
              key={`${mode}-${user.id}-${index}`}
              activeOpacity={0.84}
              onPress={() => onUserPress(user)}
              style={[
                styles.profilePin,
                mode === 'city' ? styles.profilePinCity : styles.profilePinWorld,
                position,
                {
                  borderColor: accentColor,
                  backgroundColor: surfaceAltColor,
                  zIndex: mode === 'city' ? 20 + index : 10 + index,
                },
              ]}
            >
              {user.avatar_url ? (
                <Image
                  source={{ uri: user.avatar_url }}
                  style={[styles.avatar, mode === 'city' ? styles.avatarCity : styles.avatarWorld]}
                />
              ) : (
                <Text
                  style={[
                    styles.initials,
                    mode === 'city' ? styles.initialsCity : styles.initialsWorld,
                    { color: textColor },
                  ]}
                >
                  {getInitials(user.full_name)}
                </Text>
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
  profilePinCity: {
    width: 36,
    height: 36,
    marginLeft: -18,
    marginTop: -18,
    borderRadius: 18,
  },
  profilePinWorld: {
    width: 30,
    height: 30,
    marginLeft: -15,
    marginTop: -15,
    borderRadius: 15,
    borderWidth: 1.5,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  avatarCity: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarWorld: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  initials: {
    fontSize: 12,
    fontWeight: '900',
  },
  initialsCity: {
    fontSize: 11,
  },
  initialsWorld: {
    fontSize: 8,
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
