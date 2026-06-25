import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import countriesMobileTopology from '../public/globe-assets/countries-mobile.json';

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
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
};

type UserPlot = {
  user: CityGlobeUser;
  coordinate: {
    latitude: number;
    longitude: number;
  };
};

type GlobePin = UserPlot & {
  mode: 'city' | 'world';
};

type RgbColor = {
  r: number;
  g: number;
  b: number;
};

const MAX_CITY_PROFILE_PINS = 18;
const MAX_WORLD_PROFILE_PINS = 36;
const TOPOLOGY_JSON = JSON.stringify(countriesMobileTopology).replace(/</g, '\\u003c');

const clampLatitude = (latitude: number) => Math.max(-84, Math.min(84, latitude));
const normalizeLongitude = (longitude: number) => ((((longitude + 180) % 360) + 360) % 360) - 180;

const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

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

const parseColor = (color: string | undefined, fallback: RgbColor): RgbColor => {
  const value = String(color || '').trim();

  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? hex.split('').map((part) => part + part).join('') : hex;
    const numeric = Number.parseInt(full, 16);
    return {
      r: (numeric >> 16) & 255,
      g: (numeric >> 8) & 255,
      b: numeric & 255,
    };
  }

  const rgb = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgb) {
    return {
      r: Math.max(0, Math.min(255, Number(rgb[1]))),
      g: Math.max(0, Math.min(255, Number(rgb[2]))),
      b: Math.max(0, Math.min(255, Number(rgb[3]))),
    };
  }

  return fallback;
};

const mixColor = (from: RgbColor, to: RgbColor, amount: number): RgbColor => ({
  r: Math.round(from.r + (to.r - from.r) * amount),
  g: Math.round(from.g + (to.g - from.g) * amount),
  b: Math.round(from.b + (to.b - from.b) * amount),
});

const rgbToCss = ({ r, g, b }: RgbColor) => `rgb(${r}, ${g}, ${b})`;

const rgbToHex = ({ r, g, b }: RgbColor) =>
  `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

const colorLuminance = ({ r, g, b }: RgbColor) => {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const getGlobeTheme = (backgroundColor: string, surfaceAltColor: string, textColor: string, accentColor: string) => {
  const background = parseColor(backgroundColor, { r: 3, g: 3, b: 3 });
  const surfaceAlt = parseColor(surfaceAltColor, background);
  const text = parseColor(textColor, { r: 244, g: 239, b: 230 });
  const accent = parseColor(accentColor, { r: 198, g: 166, b: 100 });
  const isLight = colorLuminance(background) > 0.72;
  const black = { r: 0, g: 0, b: 0 };

  const ocean = isLight ? mixColor(background, accent, 0.055) : background;
  const land = isLight ? mixColor(accent, black, 0.02) : accent;
  const rim = isLight ? mixColor(accent, background, 0.5) : accent;
  const pinBackground = isLight ? mixColor(surfaceAlt, background, 0.42) : surfaceAlt;
  const pinShadow = isLight
    ? '0 0 0 1px rgba(168, 121, 34, 0.16), 0 4px 14px rgba(20, 17, 13, 0.18)'
    : '0 0 0 1px rgba(198, 166, 100, 0.26), 0 0 11px rgba(198, 166, 100, 0.22), 0 5px 12px rgba(0, 0, 0, 0.36)';

  return {
    isLight,
    stageBackground: rgbToCss(ocean),
    oceanHex: rgbToHex(ocean),
    landHex: rgbToHex(land),
    rimHex: rgbToHex(rim),
    pinBackground: rgbToCss(pinBackground),
    pinText: rgbToCss(text),
    pinShadow,
  };
};

const createGlobeHtml = ({
  city,
  pins,
  backgroundColor,
  surfaceAltColor,
  textColor,
  accentColor,
}: {
  city: CityGlobeLocation | null;
  pins: GlobePin[];
  backgroundColor: string;
  surfaceAltColor: string;
  textColor: string;
  accentColor: string;
}) => {
  const globeTheme = getGlobeTheme(backgroundColor, surfaceAltColor, textColor, accentColor);
  const initialRotation = city
    ? { latitude: clampLatitude(city.latitude), longitude: normalizeLongitude(city.longitude) }
    : { latitude: 16, longitude: 78 };
  const payload = {
    city,
    colors: {
      background: globeTheme.stageBackground,
      ocean: globeTheme.oceanHex,
      land: globeTheme.landHex,
      rim: globeTheme.rimHex,
      surfaceAlt: globeTheme.pinBackground,
      text: globeTheme.pinText,
      accent: accentColor,
    },
    rotation: initialRotation,
    pins: pins.map(({ user, coordinate, mode }) => ({
      id: user.id,
      name: user.full_name || 'Overlooked member',
      initials: getInitials(user.full_name),
      avatarUrl: user.avatar_url || null,
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      mode,
    })),
  };

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover" />
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: ${globeTheme.stageBackground};
      overscroll-behavior: none;
      touch-action: none;
      -webkit-user-select: none;
      user-select: none;
    }

    #stage {
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: ${globeTheme.stageBackground};
      contain: strict;
    }

    #globe {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
      background: ${globeTheme.stageBackground};
      touch-action: none;
    }

    #pins {
      position: absolute;
      inset: 0;
      pointer-events: none;
      contain: layout paint style;
    }

    .pin {
      position: absolute;
      width: 32px;
      height: 32px;
      margin-left: -16px;
      margin-top: -16px;
      display: grid;
      place-items: center;
      padding: 0;
      border: 1.5px solid ${accentColor};
      border-radius: 999px;
      background: ${globeTheme.pinBackground};
      color: ${globeTheme.pinText};
      font: 900 10px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif;
      box-shadow: ${globeTheme.pinShadow};
      overflow: hidden;
      pointer-events: auto;
      transform-origin: center;
      transition: opacity 80ms linear;
      will-change: transform, opacity, left, top;
    }

    .pin.city {
      width: 34px;
      height: 34px;
      margin-left: -17px;
      margin-top: -17px;
      font-size: 11px;
    }

    .pin.world {
      width: 28px;
      height: 28px;
      margin-left: -14px;
      margin-top: -14px;
      font-size: 8px;
    }

    .pin img {
      width: calc(100% - 4px);
      height: calc(100% - 4px);
      border-radius: 999px;
      object-fit: cover;
      display: block;
      pointer-events: none;
    }

    .fallback {
      position: absolute;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      color: ${globeTheme.pinText};
      font: 700 13px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      opacity: 0.72;
    }

    .no-webgl .fallback {
      display: flex;
    }
  </style>
</head>
<body>
  <div id="stage">
    <canvas id="globe"></canvas>
    <div id="pins"></div>
    <div class="fallback">Globe unavailable</div>
  </div>
  <script>
    const topology = ${TOPOLOGY_JSON};
    const data = ${safeJson(payload)};
    const stage = document.getElementById('stage');
    const canvas = document.getElementById('globe');
    const pinsLayer = document.getElementById('pins');
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const normalizeLongitude = (longitude) => ((((longitude + 180) % 360) + 360) % 360) - 180;
    const rad = (degrees) => degrees * Math.PI / 180;
    const post = (message) => {
      try {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(message));
      } catch (error) {}
    };

    if (!gl) {
      document.body.classList.add('no-webgl');
    } else {
      const ocean = hexToRgb(data.colors.ocean);
      const land = hexToRgb(data.colors.land);
      const rim = hexToRgb(data.colors.rim);
      const rotation = {
        latitude: data.rotation.latitude,
        longitude: data.rotation.longitude,
      };
      const target = {
        latitude: data.rotation.latitude,
        longitude: data.rotation.longitude,
      };
      const pointer = {
        active: false,
        moved: false,
        id: null,
        x: 0,
        y: 0,
        latitude: target.latitude,
        longitude: target.longitude,
      };

      let width = 1;
      let height = 1;
      let dpr = 1;
      let spherePixelRadius = 1;
      let animationFrame = 0;

      const shaderProgram = createProgram(gl, vertexShaderSource(), fragmentShaderSource());
      const attribLatLon = gl.getAttribLocation(shaderProgram, 'aLatLon');
      const attribUv = gl.getAttribLocation(shaderProgram, 'aUv');
      const uniforms = {
        centerLat: gl.getUniformLocation(shaderProgram, 'uCenterLat'),
        centerLon: gl.getUniformLocation(shaderProgram, 'uCenterLon'),
        aspect: gl.getUniformLocation(shaderProgram, 'uAspect'),
        scale: gl.getUniformLocation(shaderProgram, 'uScale'),
        texture: gl.getUniformLocation(shaderProgram, 'uTexture'),
        ocean: gl.getUniformLocation(shaderProgram, 'uOcean'),
        land: gl.getUniformLocation(shaderProgram, 'uLand'),
        rim: gl.getUniformLocation(shaderProgram, 'uRim'),
      };

      const mesh = createSphereMesh(gl, 64, 128);
      const texture = createLandTexture(gl, topology);
      const pinElements = createPinElements();

      gl.useProgram(shaderProgram);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clearColor(ocean.r / 255, ocean.g / 255, ocean.b / 255, 1);

      function resize() {
        const rect = stage.getBoundingClientRect();
        width = Math.max(1, rect.width);
        height = Math.max(1, rect.height);
        dpr = Math.min(window.devicePixelRatio || 1, 1.45);
        canvas.width = Math.max(1, Math.floor(width * dpr));
        canvas.height = Math.max(1, Math.floor(height * dpr));
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        gl.viewport(0, 0, canvas.width, canvas.height);
        spherePixelRadius = Math.min(width, height) * 0.47;
        requestRender();
      }

      function requestRender() {
        if (animationFrame) return;
        animationFrame = requestAnimationFrame(tick);
      }

      function tick() {
        animationFrame = 0;
        const lonDelta = normalizeLongitude(target.longitude - rotation.longitude);
        const latDelta = target.latitude - rotation.latitude;

        if (pointer.active) {
          rotation.longitude = target.longitude;
          rotation.latitude = target.latitude;
        } else {
          rotation.longitude = normalizeLongitude(rotation.longitude + lonDelta * 0.24);
          rotation.latitude += latDelta * 0.24;
        }

        render();
        updatePins();

        if (pointer.active || Math.abs(lonDelta) > 0.02 || Math.abs(latDelta) > 0.02) {
          requestRender();
        }
      }

      function render() {
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(shaderProgram);

        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.latLonBuffer);
        gl.enableVertexAttribArray(attribLatLon);
        gl.vertexAttribPointer(attribLatLon, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uvBuffer);
        gl.enableVertexAttribArray(attribUv);
        gl.vertexAttribPointer(attribUv, 2, gl.FLOAT, false, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(uniforms.texture, 0);
        gl.uniform1f(uniforms.centerLat, rad(rotation.latitude));
        gl.uniform1f(uniforms.centerLon, rad(rotation.longitude));
        gl.uniform1f(uniforms.aspect, Math.max(0.1, width / height));
        gl.uniform1f(uniforms.scale, 0.94);
        gl.uniform3f(uniforms.ocean, ocean.r / 255, ocean.g / 255, ocean.b / 255);
        gl.uniform3f(uniforms.land, land.r / 255, land.g / 255, land.b / 255);
        gl.uniform3f(uniforms.rim, rim.r / 255, rim.g / 255, rim.b / 255);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer);
        gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);
      }

      function updatePins() {
        data.pins.forEach((pin, index) => {
          const element = pinElements[index];
          const projection = projectCoordinate(pin.latitude, pin.longitude, rotation);
          const visible = projection.depth > -0.03;
          const x = width / 2 + projection.x * spherePixelRadius;
          const y = height / 2 - projection.y * spherePixelRadius;
          const baseScale = pin.mode === 'city' ? 1 : 0.86;
          const scale = baseScale * (0.86 + Math.max(0, projection.depth) * 0.2);

          element.style.left = x + 'px';
          element.style.top = y + 'px';
          element.style.opacity = visible ? String(Math.max(0.36, Math.min(1, projection.depth + 0.22))) : '0';
          element.style.pointerEvents = visible ? 'auto' : 'none';
          element.style.zIndex = String(Math.round((projection.depth + 1) * 100) + (pin.mode === 'city' ? 50 : 0));
          element.style.transform = 'scale(' + scale.toFixed(3) + ')';
        });
      }

      function createPinElements() {
        pinsLayer.innerHTML = '';

        return data.pins.map((pin) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'pin ' + pin.mode;
          button.title = pin.name;
          button.setAttribute('aria-label', 'Open ' + pin.name);

          if (pin.avatarUrl) {
            const image = document.createElement('img');
            image.alt = '';
            image.decoding = 'async';
            image.loading = 'lazy';
            image.referrerPolicy = 'no-referrer';
            image.src = pin.avatarUrl;
            button.appendChild(image);
          } else {
            button.textContent = pin.initials;
          }

          button.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
          });
          button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            post({ type: 'userPress', userId: pin.id });
          });
          pinsLayer.appendChild(button);
          return button;
        });
      }

      stage.addEventListener('pointerdown', (event) => {
        pointer.active = true;
        pointer.moved = false;
        pointer.id = event.pointerId;
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        pointer.latitude = target.latitude;
        pointer.longitude = target.longitude;
        stage.setPointerCapture && stage.setPointerCapture(event.pointerId);
        post({ type: 'gesture', phase: 'start' });
      });

      stage.addEventListener('pointermove', (event) => {
        if (!pointer.active || event.pointerId !== pointer.id) return;
        const dx = event.clientX - pointer.x;
        const dy = event.clientY - pointer.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) pointer.moved = true;
        target.longitude = normalizeLongitude(pointer.longitude - dx * 0.42);
        target.latitude = clamp(pointer.latitude + dy * 0.28, -58, 58);
        requestRender();
      });

      const finishPointer = (event) => {
        if (!pointer.active || event.pointerId !== pointer.id) return;
        pointer.active = false;
        pointer.id = null;
        stage.releasePointerCapture && stage.releasePointerCapture(event.pointerId);
        post({ type: 'gesture', phase: 'end' });
        requestRender();
      };

      stage.addEventListener('pointerup', finishPointer);
      stage.addEventListener('pointercancel', finishPointer);
      window.addEventListener('resize', resize);
      resize();
      render();
      updatePins();
    }

    function vertexShaderSource() {
      return [
        'attribute vec2 aLatLon;',
        'attribute vec2 aUv;',
        'uniform float uCenterLat;',
        'uniform float uCenterLon;',
        'uniform float uAspect;',
        'uniform float uScale;',
        'varying vec2 vUv;',
        'varying float vDepth;',
        'void main() {',
        '  float lat = aLatLon.x;',
        '  float lon = aLatLon.y - uCenterLon;',
        '  float cosLat = cos(lat);',
        '  float sinLat = sin(lat);',
        '  float cosLon = cos(lon);',
        '  float sinLon = sin(lon);',
        '  float cosTilt = cos(uCenterLat);',
        '  float sinTilt = sin(uCenterLat);',
        '  vec3 sphere;',
        '  sphere.x = cosLat * sinLon;',
        '  sphere.y = sinLat * cosTilt - cosLat * cosLon * sinTilt;',
        '  sphere.z = sinLat * sinTilt + cosLat * cosLon * cosTilt;',
        '  vUv = aUv;',
        '  vDepth = sphere.z;',
        '  gl_Position = vec4((sphere.x * uScale) / uAspect, sphere.y * uScale, -sphere.z * 0.58, 1.0);',
        '}'
      ].join('\\n');
    }

    function fragmentShaderSource() {
      return [
        'precision mediump float;',
        'uniform sampler2D uTexture;',
        'uniform vec3 uOcean;',
        'uniform vec3 uLand;',
        'uniform vec3 uRim;',
        'varying vec2 vUv;',
        'varying float vDepth;',
        'void main() {',
        '  vec4 land = texture2D(uTexture, vUv);',
        '  float landAlpha = smoothstep(0.08, 0.24, land.a);',
        '  float shade = 0.62 + 0.38 * clamp(vDepth, 0.0, 1.0);',
        '  float oceanShade = 0.9 + 0.1 * clamp(vDepth, 0.0, 1.0);',
        '  float rim = pow(1.0 - clamp(vDepth, 0.0, 1.0), 3.0) * 0.16;',
        '  vec3 color = mix(uOcean * oceanShade, uLand * shade, landAlpha);',
        '  color = mix(color, uRim, rim);',
        '  gl_FragColor = vec4(color, 1.0);',
        '}'
      ].join('\\n');
    }

    function createShader(gl, type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || 'Shader compile failed');
      }
      return shader;
    }

    function createProgram(gl, vertexSource, fragmentSource) {
      const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
      const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
      const program = gl.createProgram();
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || 'Program link failed');
      }
      return program;
    }

    function createSphereMesh(gl, latBands, lonBands) {
      const latLon = [];
      const uvs = [];
      const indices = [];

      for (let latIndex = 0; latIndex <= latBands; latIndex += 1) {
        const latitude = -90 + (latIndex / latBands) * 180;
        for (let lonIndex = 0; lonIndex <= lonBands; lonIndex += 1) {
          const longitude = -180 + (lonIndex / lonBands) * 360;
          latLon.push(rad(latitude), rad(longitude));
          uvs.push((longitude + 180) / 360, (90 - latitude) / 180);
        }
      }

      for (let latIndex = 0; latIndex < latBands; latIndex += 1) {
        for (let lonIndex = 0; lonIndex < lonBands; lonIndex += 1) {
          const first = latIndex * (lonBands + 1) + lonIndex;
          const second = first + lonBands + 1;
          indices.push(first, second, first + 1, second, second + 1, first + 1);
        }
      }

      const latLonBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, latLonBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(latLon), gl.STATIC_DRAW);

      const uvBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);

      const indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

      return { latLonBuffer, uvBuffer, indexBuffer, indexCount: indices.length };
    }

    function createLandTexture(gl, topology) {
      const textureCanvas = document.createElement('canvas');
      textureCanvas.width = 1024;
      textureCanvas.height = 512;
      const context = textureCanvas.getContext('2d');
      drawCountryTexture(context, topology);

      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textureCanvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return texture;
    }

    function drawCountryTexture(context, topology) {
      const width = context.canvas.width;
      const height = context.canvas.height;
      context.clearRect(0, 0, width, height);
      context.fillStyle = 'rgba(255,255,255,1)';
      context.strokeStyle = 'rgba(255,255,255,0.2)';
      context.lineWidth = 0.35;
      context.lineJoin = 'round';
      context.lineCap = 'round';

      const decodeArc = createArcDecoder(topology);
      const geometries = topology.objects && topology.objects.countries && topology.objects.countries.geometries
        ? topology.objects.countries.geometries
        : [];

      geometries.forEach((geometry) => {
        if (geometry.type === 'Polygon') {
          drawTopologyPolygon(context, geometry.arcs, decodeArc);
          return;
        }
        geometry.arcs.forEach((polygon) => drawTopologyPolygon(context, polygon, decodeArc));
      });
    }

    function createArcDecoder(topology) {
      const scale = topology.transform ? topology.transform.scale : [1, 1];
      const translate = topology.transform ? topology.transform.translate : [0, 0];
      const cache = new Map();

      const decodeForwardArc = (arcIndex) => {
        if (cache.has(arcIndex)) return cache.get(arcIndex);
        let x = 0;
        let y = 0;
        const arc = topology.arcs[arcIndex] || [];
        const decoded = [];
        const stride = arc.length > 900 ? 5 : arc.length > 420 ? 3 : arc.length > 180 ? 2 : 1;

        arc.forEach(([dx, dy], index) => {
          x += dx;
          y += dy;
          if (index !== 0 && index !== arc.length - 1 && index % stride !== 0) return;
          decoded.push([x * scale[0] + translate[0], y * scale[1] + translate[1]]);
        });
        cache.set(arcIndex, decoded);
        return decoded;
      };

      return (arcIndex) => {
        const positiveArcIndex = arcIndex < 0 ? ~arcIndex : arcIndex;
        const decoded = decodeForwardArc(positiveArcIndex);
        return arcIndex < 0 ? decoded.slice().reverse() : decoded;
      };
    }

    function getUnwrappedRingPoints(ring, decodeArc) {
      const ringPoints = [];
      let longitudeOffset = 0;
      let previousLongitude = null;

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
    }

    function drawRingPoints(context, ringPoints, horizontalShift) {
      let didMove = false;
      const width = context.canvas.width;
      const height = context.canvas.height;

      ringPoints.forEach(([longitude, latitude]) => {
        const x = ((longitude + 180) / 360) * width + horizontalShift;
        const y = ((90 - latitude) / 180) * height;
        if (!didMove) {
          context.moveTo(x, y);
          didMove = true;
        } else {
          context.lineTo(x, y);
        }
      });

      if (didMove) context.closePath();
    }

    function drawTopologyPolygon(context, polygon, decodeArc) {
      context.beginPath();
      polygon.forEach((ring) => {
        const ringPoints = getUnwrappedRingPoints(ring, decodeArc);
        drawRingPoints(context, ringPoints, -context.canvas.width);
        drawRingPoints(context, ringPoints, 0);
        drawRingPoints(context, ringPoints, context.canvas.width);
      });
      context.fill('evenodd');
      context.stroke();
    }

    function projectCoordinate(latitude, longitude, rotation) {
      const lat = rad(clamp(latitude, -84, 84));
      const lon = rad(normalizeLongitude(longitude - rotation.longitude));
      const tilt = rad(clamp(rotation.latitude, -58, 58));
      const cosLat = Math.cos(lat);
      const sinLat = Math.sin(lat);
      const cosLon = Math.cos(lon);
      const sinLon = Math.sin(lon);
      const cosTilt = Math.cos(tilt);
      const sinTilt = Math.sin(tilt);

      return {
        x: cosLat * sinLon,
        y: sinLat * cosTilt - cosLat * cosLon * sinTilt,
        depth: sinLat * sinTilt + cosLat * cosLon * cosTilt,
      };
    }

    function hexToRgb(hex) {
      const clean = String(hex || '#C6A664').replace('#', '');
      const full = clean.length === 3
        ? clean.split('').map((part) => part + part).join('')
        : clean.padEnd(6, '0').slice(0, 6);
      const value = parseInt(full, 16);
      return {
        r: (value >> 16) & 255,
        g: (value >> 8) & 255,
        b: value & 255,
      };
    }
  </script>
</body>
</html>`;
};

export default function CityGlobe({
  city,
  users,
  searched,
  onUserPress,
  backgroundColor,
  surfaceAltColor,
  borderColor,
  textColor,
  accentColor,
  onInteractionStart,
  onInteractionEnd,
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
        coordinate: scatterCoordinate(coordinate, index, total, city ? 'city' : 'world'),
      };
    });

    const worldPins = worldProfilePins.map(({ user, coordinate }) => ({
      user,
      mode: 'world' as const,
      coordinate,
    }));

    return [...cityPins, ...worldPins];
  }, [city, visibleCityUsers, worldProfilePins]);

  const usersById = useMemo(() => {
    const map = new Map<string, CityGlobeUser>();
    visiblePins.forEach(({ user }) => map.set(user.id, user));
    users.forEach((user) => map.set(user.id, user));
    return map;
  }, [users, visiblePins]);

  const html = useMemo(
    () =>
      createGlobeHtml({
        city,
        pins: visiblePins,
        backgroundColor,
        surfaceAltColor,
        textColor,
        accentColor,
      }),
    [accentColor, backgroundColor, city, surfaceAltColor, textColor, visiblePins]
  );

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);
      if (message?.type === 'gesture') {
        if (message.phase === 'start') onInteractionStart?.();
        if (message.phase === 'end') onInteractionEnd?.();
        return;
      }

      if (message?.type === 'userPress' && typeof message.userId === 'string') {
        const user = usersById.get(message.userId);
        if (user) onUserPress(user);
      }
    } catch {
      // Ignore malformed WebView messages.
    }
  };

  return (
    <View style={[styles.shell, { backgroundColor, borderColor }]}>
      <WebView
        key={`${city?.name ?? 'world'}:${city?.countryCode ?? ''}:${visiblePins.length}:${backgroundColor}:${accentColor}`}
        originWhitelist={['*']}
        source={{ html, baseUrl: '' }}
        style={[styles.webView, { backgroundColor }]}
        containerStyle={[styles.webViewContainer, { backgroundColor }]}
        javaScriptEnabled
        domStorageEnabled={false}
        scrollEnabled={false}
        bounces={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        onMessage={handleMessage}
        onTouchStart={onInteractionStart}
        onTouchEnd={onInteractionEnd}
        onTouchCancel={onInteractionEnd}
        androidLayerType="hardware"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    width: '100%',
    height: 390,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  webView: {
    flex: 1,
    backgroundColor: '#000',
  },
});
