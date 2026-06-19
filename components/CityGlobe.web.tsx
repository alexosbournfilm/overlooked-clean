import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

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

type GlobeRuntime = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  labelRenderer: CSS2DRenderer;
  controls: OrbitControls;
  globeGroup: THREE.Group;
  renderNow: () => void;
  dispose: () => void;
};

type PinRecord = {
  object: CSS2DObject;
  marker: THREE.Object3D | null;
  element: HTMLElement;
  normal: THREE.Vector3;
  visible: boolean;
  dispose: () => void;
};

type UserPlot = {
  user: CityGlobeUser;
  coordinate: {
    latitude: number;
    longitude: number;
  };
};

const GLOBE_RADIUS = 1.55;
const PIN_RADIUS = GLOBE_RADIUS + 0.055;
const FIXED_CAMERA_DISTANCE = 6.15;
const MAX_CITY_PROFILE_PINS = 18;
const MAX_WORLD_PROFILE_PINS = 48;
const DEFAULT_GLOBE_GOLD = '#C6A664';
const COUNTRY_TOPOLOGY_URL = '/globe-assets/countries-10m.json';

type TopologyArc = [number, number][];

type CountryTopology = {
  type: 'Topology';
  transform?: {
    scale: [number, number];
    translate: [number, number];
  };
  arcs: TopologyArc[];
  objects: {
    countries?: {
      type: 'GeometryCollection';
      geometries: TopologyGeometry[];
    };
  };
};

type TopologyGeometry = {
  type: 'Polygon' | 'MultiPolygon';
  arcs: number[][] | number[][][];
};

const clampLatitude = (latitude: number) => Math.max(-84, Math.min(84, latitude));

const latLonToVector = (latitude: number, longitude: number, radius = GLOBE_RADIUS) => {
  const lat = THREE.MathUtils.degToRad(clampLatitude(latitude));
  const lon = THREE.MathUtils.degToRad(longitude + 180);
  const theta = THREE.MathUtils.degToRad(90) - lat;

  return new THREE.Vector3(
    -radius * Math.cos(lon) * Math.sin(theta),
    radius * Math.cos(theta),
    radius * Math.sin(lon) * Math.sin(theta)
  );
};

const isFiniteCoordinate = (value: number) => Number.isFinite(value);

const getUserCoordinate = (user: CityGlobeUser, fallbackCity: CityGlobeLocation | null) => {
  if (user.latitude == null || user.longitude == null) {
    if (fallbackCity && isFiniteCoordinate(fallbackCity.latitude) && isFiniteCoordinate(fallbackCity.longitude)) {
      return {
        latitude: fallbackCity.latitude,
        longitude: fallbackCity.longitude,
      };
    }

    return null;
  }

  const userLatitude = Number(user.latitude);
  const userLongitude = Number(user.longitude);

  if (Number.isFinite(userLatitude) && Number.isFinite(userLongitude)) {
    return {
      latitude: userLatitude,
      longitude: userLongitude,
    };
  }

  if (fallbackCity && isFiniteCoordinate(fallbackCity.latitude) && isFiniteCoordinate(fallbackCity.longitude)) {
    return {
      latitude: fallbackCity.latitude,
      longitude: fallbackCity.longitude,
    };
  }

  return null;
};

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

const cityKey = (city: CityGlobeLocation | null) =>
  city ? `${city.name}:${city.countryCode}:${city.latitude}:${city.longitude}` : 'worldwide';

const getInitials = (name: string) => {
  const parts = (name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  return parts.map((part) => part[0]?.toUpperCase()).join('') || 'OL';
};

const css = `
.overlooked-city-globe {
  position: relative;
  width: 100%;
  height: clamp(350px, 48vw, 520px);
  min-height: 350px;
  overflow: hidden;
  isolation: isolate;
}

.overlooked-city-globe::before {
  display: none;
}

.overlooked-city-globe::after {
  display: none;
}

.overlooked-city-globe-stage {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.overlooked-city-globe canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
  touch-action: pan-y;
}

.overlooked-city-globe-labels {
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  contain: layout paint style;
}

.city-globe-profile-pin,
.city-globe-location-pin {
  position: relative;
  display: grid;
  place-items: center;
  pointer-events: auto;
  border: 0;
  padding: 0;
  font: inherit;
  cursor: pointer;
  user-select: none;
  contain: layout paint style;
  transition: opacity 120ms ease;
}

.city-globe-profile-pin {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: #050505;
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--globe-accent) 82%, white),
    0 0 7px color-mix(in srgb, var(--globe-accent) 18%, transparent),
    0 4px 10px rgba(0, 0, 0, 0.3);
}

.city-globe-profile-pin-world {
  width: 27px;
  height: 27px;
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--globe-accent) 74%, white),
    0 0 6px color-mix(in srgb, var(--globe-accent) 14%, transparent),
    0 3px 8px rgba(0, 0, 0, 0.24);
}

.city-globe-profile-pin-city {
  width: 34px;
  height: 34px;
}

.city-globe-profile-pin:hover {
  filter: brightness(1.08);
}

.city-globe-avatar,
.city-globe-initials {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  overflow: hidden;
}

.city-globe-profile-pin-world .city-globe-avatar,
.city-globe-profile-pin-world .city-globe-initials {
  width: 23px;
  height: 23px;
}

.city-globe-profile-pin-city .city-globe-avatar,
.city-globe-profile-pin-city .city-globe-initials {
  width: 30px;
  height: 30px;
}

.city-globe-avatar {
  object-fit: cover;
  background: var(--globe-surface-alt);
}

.city-globe-initials {
  display: grid;
  place-items: center;
  color: var(--globe-text);
  background: linear-gradient(145deg, color-mix(in srgb, var(--globe-accent) 14%, #202020), #050505);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0;
}

.city-globe-profile-pin-world .city-globe-initials {
  font-size: 8px;
}

.city-globe-profile-pin-city .city-globe-initials {
  font-size: 11px;
}

.city-globe-location-pin {
  width: 12px;
  height: 12px;
  border: 1px solid color-mix(in srgb, var(--globe-accent) 92%, white);
  border-radius: 50%;
  background: color-mix(in srgb, var(--globe-accent) 34%, transparent);
  box-shadow:
    0 0 0 6px color-mix(in srgb, var(--globe-accent) 10%, transparent),
    0 8px 18px rgba(0, 0, 0, 0.28);
  cursor: default;
}

.city-globe-location-pin::after {
  content: "";
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--globe-text);
}

@media (max-width: 700px) {
  .overlooked-city-globe {
    height: 380px;
    min-height: 380px;
  }

  .city-globe-profile-pin {
    width: 32px;
    height: 32px;
  }

  .city-globe-profile-pin-city {
    width: 34px;
    height: 34px;
  }

  .city-globe-avatar,
  .city-globe-initials {
    width: 28px;
    height: 28px;
  }

  .city-globe-profile-pin-city .city-globe-avatar,
  .city-globe-profile-pin-city .city-globe-initials {
    width: 30px;
    height: 30px;
  }

  .city-globe-profile-pin-world {
    width: 28px;
    height: 28px;
  }

  .city-globe-profile-pin-world .city-globe-avatar,
  .city-globe-profile-pin-world .city-globe-initials {
    width: 24px;
    height: 24px;
  }
}
`;

const projectTopologyPoint = (longitude: number, latitude: number, width: number, height: number) => ({
  x: ((longitude + 180) / 360) * width,
  y: ((90 - latitude) / 180) * height,
});

const createArcDecoder = (topology: CountryTopology) => {
  const scale = topology.transform?.scale ?? [1, 1];
  const translate = topology.transform?.translate ?? [0, 0];
  const cache = new Map<number, [number, number][]>();

  const decodeForwardArc = (arcIndex: number) => {
    const cached = cache.get(arcIndex);
    if (cached) return cached;

    let x = 0;
    let y = 0;
    const decoded = (topology.arcs[arcIndex] ?? []).map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]] as [number, number];
    });

    cache.set(arcIndex, decoded);
    return decoded;
  };

  return (arcIndex: number) => {
    const positiveArcIndex = arcIndex < 0 ? ~arcIndex : arcIndex;
    const decoded = decodeForwardArc(positiveArcIndex);
    return arcIndex < 0 ? decoded.slice().reverse() : decoded;
  };
};

const getUnwrappedRingPoints = (
  ring: number[],
  decodeArc: (arcIndex: number) => [number, number][]
) => {
  const ringPoints: [number, number][] = [];
  let longitudeOffset = 0;
  let previousLongitude: number | null = null;

  ring.forEach((arcIndex, arcPosition) => {
    const points = decodeArc(arcIndex);
    points.forEach(([longitude, latitude], pointIndex) => {
      if (arcPosition > 0 && pointIndex === 0) return;

      if (previousLongitude != null) {
        const delta = longitude + longitudeOffset - previousLongitude;
        if (delta > 180) longitudeOffset -= 360;
        if (delta < -180) longitudeOffset += 360;
      }

      const unwrappedLongitude = longitude + longitudeOffset;
      ringPoints.push([unwrappedLongitude, latitude]);
      previousLongitude = unwrappedLongitude;
    });
  });

  return ringPoints;
};

const drawRingPoints = (
  context: CanvasRenderingContext2D,
  ringPoints: [number, number][],
  horizontalShift: number
) => {
  const { width, height } = context.canvas;
  let didMove = false;

  ringPoints.forEach(([longitude, latitude]) => {
    const point = projectTopologyPoint(longitude, latitude, width, height);
    const x = point.x + horizontalShift;

    if (!didMove) {
      context.moveTo(x, point.y);
      didMove = true;
    } else {
      context.lineTo(x, point.y);
    }
  });

  if (didMove) context.closePath();
};

const drawTopologyPolygon = (
  context: CanvasRenderingContext2D,
  polygon: number[][],
  decodeArc: (arcIndex: number) => [number, number][],
  fillColor: string
) => {
  context.beginPath();
  polygon.forEach((ring) => {
    const ringPoints = getUnwrappedRingPoints(ring, decodeArc);
    drawRingPoints(context, ringPoints, -context.canvas.width);
    drawRingPoints(context, ringPoints, 0);
    drawRingPoints(context, ringPoints, context.canvas.width);
  });
  context.fillStyle = fillColor;
  context.fill('evenodd');
};

const drawCountryTexture = (
  context: CanvasRenderingContext2D,
  topology?: CountryTopology,
  accentColor = DEFAULT_GLOBE_GOLD
) => {
  const { width, height } = context.canvas;
  const fillColor = accentColor || DEFAULT_GLOBE_GOLD;

  context.clearRect(0, 0, width, height);

  if (!topology?.objects?.countries?.geometries?.length) return;

  context.save();
  context.lineJoin = 'round';
  context.lineCap = 'round';

  const decodeArc = createArcDecoder(topology);

  topology.objects.countries.geometries.forEach((geometry) => {
    if (geometry.type === 'Polygon') {
      drawTopologyPolygon(context, geometry.arcs as number[][], decodeArc, fillColor);
      return;
    }

    (geometry.arcs as number[][][]).forEach((polygon) => {
      drawTopologyPolygon(context, polygon, decodeArc, fillColor);
    });
  });

  context.restore();
};

const createCountryTexture = (
  renderer: THREE.WebGLRenderer,
  accentColor: string,
  onUpdate: () => void
) => {
  const canvas = document.createElement('canvas');
  canvas.width = 8192;
  canvas.height = 4096;

  const context = canvas.getContext('2d');
  if (context) {
    drawCountryTexture(context, undefined, accentColor);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());

  if (context) {
    fetch(COUNTRY_TOPOLOGY_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load globe topology: ${response.status}`);
        return response.json() as Promise<CountryTopology>;
      })
      .then((topology) => {
        drawCountryTexture(context, topology, accentColor);
        texture.needsUpdate = true;
        onUpdate();
      })
      .catch((error) => {
        console.warn('City globe topology load failed:', error);
      });
  }

  return texture;
};

const scatterCoordinate = (
  coordinate: Pick<CityGlobeLocation, 'latitude' | 'longitude'>,
  index: number,
  total: number,
  mode: 'city' | 'world'
) => {
  if (total <= 1) return { latitude: coordinate.latitude, longitude: coordinate.longitude };

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const angle = mode === 'city' ? index * goldenAngle : (index / Math.max(total, 1)) * Math.PI * 2;
  const baseRing = mode === 'city' ? 0.46 : 0.42;
  const ringStep = mode === 'city' ? 0.24 : 0.18;
  const ringSize = mode === 'city' ? 8 : 12;
  const ring = baseRing + Math.floor(index / ringSize) * ringStep;
  const latOffset = Math.sin(angle) * ring;
  const lonScale = Math.max(0.35, Math.cos(THREE.MathUtils.degToRad(coordinate.latitude)));
  const lonOffset = (Math.cos(angle) * ring) / lonScale;

  return {
    latitude: clampLatitude(coordinate.latitude + latOffset),
    longitude: coordinate.longitude + lonOffset,
  };
};

const clearPins = (pins: React.MutableRefObject<PinRecord[]>, group: THREE.Group | null) => {
  pins.current.forEach((pin) => {
    pin.dispose();
    pin.object.removeFromParent();
    pin.marker?.removeFromParent();
  });
  pins.current = [];

  if (group) {
    group.children
      .filter((child) => child.userData?.kind === 'pin-marker')
      .forEach((child) => child.removeFromParent());
  }
};

const createProfilePinElement = (
  user: CityGlobeUser,
  onUserPress: (user: CityGlobeUser) => void,
  mode: 'city' | 'world'
) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `city-globe-profile-pin city-globe-profile-pin-${mode}`;
  button.title = user.cityName
    ? `${user.full_name || 'Profile'} - ${user.cityName}${user.countryCode ? `, ${user.countryCode}` : ''}`
    : user.full_name || 'Profile';
  button.setAttribute('aria-label', `Open ${user.full_name || 'profile'}`);

  if (user.avatar_url) {
    const img = document.createElement('img');
    img.className = 'city-globe-avatar';
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.src = user.avatar_url;
    button.appendChild(img);
  } else {
    const initials = document.createElement('span');
    initials.className = 'city-globe-initials';
    initials.textContent = getInitials(user.full_name);
    button.appendChild(initials);
  }

  const stop = (event: Event) => event.stopPropagation();
  const click = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    onUserPress(user);
  };

  button.addEventListener('pointerdown', stop);
  button.addEventListener('click', click);

  return {
    element: button,
    dispose: () => {
      button.removeEventListener('pointerdown', stop);
      button.removeEventListener('click', click);
    },
  };
};

const createCityPinElement = (city: CityGlobeLocation) => {
  const element = document.createElement('div');
  element.className = 'city-globe-location-pin';
  element.title = `${city.name}, ${city.countryCode}`;
  return { element, dispose: () => undefined };
};

const addPin = ({
  group,
  pins,
  latitude,
  longitude,
  element,
  dispose,
  accentColor,
  markerScale = 1,
  markerOpacity = 0.72,
}: {
  group: THREE.Group;
  pins: React.MutableRefObject<PinRecord[]>;
  latitude: number;
  longitude: number;
  element: HTMLElement;
  dispose: () => void;
  accentColor: string;
  markerScale?: number;
  markerOpacity?: number;
}) => {
  const position = latLonToVector(latitude, longitude, PIN_RADIUS);
  const normal = latLonToVector(latitude, longitude, 1).normalize();
  const object = new CSS2DObject(element);
  object.position.copy(position);

  const marker =
    markerOpacity > 0 && markerScale > 0
      ? new THREE.Mesh(
          new THREE.SphereGeometry(0.012 * markerScale, 8, 8),
          new THREE.MeshBasicMaterial({
            color: accentColor,
            transparent: true,
            opacity: markerOpacity,
            depthWrite: false,
          })
        )
      : null;

  if (marker) {
    marker.userData.kind = 'pin-marker';
    marker.position.copy(latLonToVector(latitude, longitude, GLOBE_RADIUS + 0.028));
    group.add(marker);
  }

  group.add(object);
  pins.current.push({ object, marker, element, normal, visible: true, dispose });
};

const disposeScene = (scene: THREE.Scene) => {
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const line = object as THREE.Line;
    const geometry = mesh.geometry || line.geometry;
    const material = mesh.material || line.material;

    if (geometry && typeof geometry.dispose === 'function') geometry.dispose();

    if (Array.isArray(material)) {
      material.forEach((mat) => {
        const maybeMap = (mat as THREE.MeshStandardMaterial).map;
        maybeMap?.dispose();
        mat.dispose();
      });
    } else if (material && typeof material.dispose === 'function') {
      const maybeMap = (material as THREE.MeshStandardMaterial).map;
      maybeMap?.dispose();
      material.dispose();
    }
  });
};

const fixedCameraPosition = (direction?: THREE.Vector3) => {
  const nextDirection = direction?.clone() ?? new THREE.Vector3(0.35, 0.3, 4.4);
  if (nextDirection.lengthSq() === 0) nextDirection.set(0, 0, 1);
  return nextDirection.normalize().multiplyScalar(FIXED_CAMERA_DISTANCE);
};

export default function CityGlobe({
  city,
  users,
  onUserPress,
  backgroundColor,
  surfaceAltColor,
  textColor,
  accentColor,
}: CityGlobeProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<GlobeRuntime | null>(null);
  const pinsRef = useRef<PinRecord[]>([]);
  const frameRef = useRef<number | null>(null);

  const plottedUsers = useMemo(
    () =>
      users
        .map((user) => {
          const coordinate = getUserCoordinate(user, city);
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

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || runtimeRef.current) return;

    let resizeObserver: ResizeObserver | null = null;
    let resizeFrame: number | null = null;
    let dampingFrame: number | null = null;
    let dampingSettledFrames = 0;
    let isDampingTick = false;
    let disposed = false;

    try {
      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2('#030508', 0.035);

      const camera = new THREE.PerspectiveCamera(36, 1, 0.02, 100);
      camera.position.copy(fixedCameraPosition());

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute('aria-hidden', 'true');
      renderer.domElement.style.position = 'absolute';
      renderer.domElement.style.inset = '0';
      mount.appendChild(renderer.domElement);

      const labelRenderer = new CSS2DRenderer();
      labelRenderer.domElement.className = 'overlooked-city-globe-labels';
      mount.appendChild(labelRenderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.075;
      controls.enablePan = false;
      controls.enableZoom = false;
      controls.autoRotate = false;
      controls.minDistance = FIXED_CAMERA_DISTANCE;
      controls.maxDistance = FIXED_CAMERA_DISTANCE;
      controls.rotateSpeed = 0.56;
      renderer.domElement.style.touchAction = 'pan-y';

      const globeGroup = new THREE.Group();
      scene.add(globeGroup);

      const updatePinVisibility = () => {
        const cameraNormal = camera.position.clone().normalize();

        pinsRef.current.forEach((pin) => {
          const visible = pin.normal.dot(cameraNormal) > -0.03;
          if (pin.visible === visible) return;
          pin.visible = visible;
          pin.element.style.opacity = visible ? '1' : '0';
          pin.element.style.pointerEvents = visible ? 'auto' : 'none';
          if (pin.marker) pin.marker.visible = visible;
        });
      };

      const renderNow = () => {
        if (disposed) return;
        updatePinVisibility();
        renderer.render(scene, camera);
        labelRenderer.render(scene, camera);
      };

      const requestRender = () => {
        if (disposed || frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          renderNow();
        });
      };

      const startDampingLoop = () => {
        if (disposed || isDampingTick || dampingFrame !== null) return;
        dampingSettledFrames = 0;
        dampingFrame = requestAnimationFrame(runDamping);
      };

      const runDamping = () => {
        dampingFrame = null;
        if (disposed) return;

        isDampingTick = true;
        const changed = controls.update();
        isDampingTick = false;
        renderNow();

        if (changed || dampingSettledFrames < 4) {
          dampingSettledFrames = changed ? 0 : dampingSettledFrames + 1;
          dampingFrame = requestAnimationFrame(runDamping);
        }
      };

      const texture = createCountryTexture(renderer, accentColor, requestRender);
      const earth = new THREE.Mesh(
        new THREE.SphereGeometry(GLOBE_RADIUS, 192, 128),
        new THREE.MeshBasicMaterial({
          map: texture,
          color: '#FFFFFF',
          transparent: true,
          alphaTest: 0.02,
        })
      );
      globeGroup.add(earth);

      const resize = () => {
        if (disposed) return;
        const width = Math.max(280, mount.clientWidth || 760);
        const height = Math.max(320, mount.clientHeight || 440);

        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        labelRenderer.setSize(width, height);
        requestRender();
      };

      resizeObserver = new ResizeObserver(() => {
        if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(resize);
      });
      resizeObserver.observe(mount);
      resize();

      controls.addEventListener('change', startDampingLoop);

      runtimeRef.current = {
        scene,
        camera,
        renderer,
        labelRenderer,
        controls,
        globeGroup,
        renderNow,
        dispose: () => {
          disposed = true;
          controls.removeEventListener('change', startDampingLoop);
          controls.dispose();
          resizeObserver?.disconnect();
          if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
          if (dampingFrame !== null) cancelAnimationFrame(dampingFrame);
          if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
          clearPins(pinsRef, globeGroup);
          disposeScene(scene);
          renderer.dispose();
          labelRenderer.domElement.remove();
          renderer.domElement.remove();
        },
      };

      renderNow();
    } catch (error) {
      console.warn('City globe WebGL init failed:', error);
    }

    return () => {
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
  }, [accentColor]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    clearPins(pinsRef, runtime.globeGroup);
    runtime.controls.autoRotate = false;

    if (city && isFiniteCoordinate(city.latitude) && isFiniteCoordinate(city.longitude)) {
      if (visibleCityUsers.length === 0) {
        const cityPin = createCityPinElement(city);
        addPin({
          group: runtime.globeGroup,
          pins: pinsRef,
          latitude: city.latitude,
          longitude: city.longitude,
          element: cityPin.element,
          dispose: cityPin.dispose,
          accentColor,
          markerScale: 0.72,
          markerOpacity: 0.38,
        });
      }

      const focus = latLonToVector(city.latitude, city.longitude, 1).normalize();
      runtime.camera.position.copy(fixedCameraPosition(focus));
      runtime.camera.lookAt(0, 0, 0);
      runtime.controls.update();
    }

    const locationCounts = new Map<string, number>();
    visibleCityUsers.forEach(({ coordinate }) => {
      const key = coordinateKey(coordinate);
      locationCounts.set(key, (locationCounts.get(key) ?? 0) + 1);
    });

    const locationIndexes = new Map<string, number>();
    visibleCityUsers.forEach(({ user, coordinate }) => {
      const key = coordinateKey(coordinate);
      const index = locationIndexes.get(key) ?? 0;
      const total = locationCounts.get(key) ?? 1;
      const pinCoordinate = scatterCoordinate(coordinate, index, total, city ? 'city' : 'world');
      const pin = createProfilePinElement(user, onUserPress, city ? 'city' : 'world');

      locationIndexes.set(key, index + 1);

      addPin({
        group: runtime.globeGroup,
        pins: pinsRef,
        latitude: pinCoordinate.latitude,
        longitude: pinCoordinate.longitude,
        element: pin.element,
        dispose: pin.dispose,
        accentColor,
        markerScale: 0,
        markerOpacity: 0,
      });
    });

    worldProfilePins.forEach(({ user, coordinate }) => {
      const pin = createProfilePinElement(user, onUserPress, 'world');

      addPin({
        group: runtime.globeGroup,
        pins: pinsRef,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        element: pin.element,
        dispose: pin.dispose,
        accentColor,
        markerScale: 0,
        markerOpacity: 0,
      });
    });

    if (!city) {
      runtime.camera.position.copy(fixedCameraPosition());
      runtime.camera.lookAt(0, 0, 0);
      runtime.controls.update();
    }

    runtime.renderNow();

    return () => {
      clearPins(pinsRef, runtimeRef.current?.globeGroup ?? null);
    };
  }, [accentColor, city, onUserPress, visibleCityUsers, worldProfilePins]);

  return (
    <div
      className="overlooked-city-globe"
      style={
        {
          '--globe-bg': backgroundColor,
          '--globe-surface-alt': surfaceAltColor,
          '--globe-text': textColor,
          '--globe-accent': accentColor,
        } as React.CSSProperties
      }
      aria-label={city ? `${city.name} profile globe` : 'Profile globe'}
      data-city-globe="true"
      data-city-key={cityKey(city)}
    >
      <style>{css}</style>
      <div ref={mountRef} className="overlooked-city-globe-stage" />
    </div>
  );
}
