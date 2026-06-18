import { supabase } from './supabase';

export type ParsedCityQuery = {
  cityQuery: string;
  countryCode: string;
};

export type CitySearchRow = {
  id: number;
  name: string;
  country_code: string;
  population?: number | null;
};

type CitySearchResponse = {
  data: CitySearchRow[];
  error: any | null;
};

const CACHE_TTL_MS = 60_000;
const responseCache = new Map<string, { expiresAt: number; response: CitySearchResponse }>();
const inFlightSearches = new Map<string, Promise<CitySearchResponse>>();

export const getFlag = (countryCode: string) =>
  (countryCode || '')
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));

export const parseCityQuery = (raw: string): ParsedCityQuery => {
  const s = (raw || '').trim();
  const cleaned = s.replace(/[()]/g, '').replace(/\s+/g, ' ');
  const lower = cleaned.toLowerCase();

  const partsComma = lower
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  let cityPart = partsComma[0] || '';
  let countryPart = partsComma[1] || '';

  if (!countryPart) {
    const tokens = lower.split(' ').filter(Boolean);
    if (tokens.length >= 2) {
      const last = tokens[tokens.length - 1];
      if (/^[a-z]{2}$/.test(last)) {
        countryPart = last;
        cityPart = tokens.slice(0, -1).join(' ');
      }
    }
  }

  const cityQuery = (cityPart || '').trim();
  const countryCode = (countryPart || '').trim();

  return {
    cityQuery,
    countryCode: /^[a-z]{2}$/.test(countryCode) ? countryCode.toUpperCase() : '',
  };
};

const norm = (s: string) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

export const prioritizeCityMatches = <T extends { name: string; country_code: string; population?: number | null }>(
  list: T[],
  rawTerm: string
) => {
  const { cityQuery, countryCode } = parseCityQuery(rawTerm);
  const qn = norm(cityQuery);

  const score = (row: T) => {
    const name = norm(row.name);
    const cc = (row.country_code || '').toUpperCase();

    const exactCity = name === qn;
    const starts = name.startsWith(qn);
    const contains = name.includes(qn);

    if (countryCode && exactCity && cc === countryCode) return 0;
    if (exactCity) return 1;
    if (countryCode && starts && cc === countryCode) return 2;
    if (starts) return 3;
    if (countryCode && contains && cc === countryCode) return 4;
    if (contains) return 5;
    return 6;
  };

  return [...list].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) return sa - sb;

    if (countryCode) {
      const ac = (a.country_code || '').toUpperCase() === countryCode ? 0 : 1;
      const bc = (b.country_code || '').toUpperCase() === countryCode ? 0 : 1;
      if (ac !== bc) return ac - bc;
    }

    const ap = typeof a.population === 'number' ? a.population : -1;
    const bp = typeof b.population === 'number' ? b.population : -1;
    if (ap !== bp) return bp - ap;

    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    if (an !== bn) return an.localeCompare(bn);
    return (a.country_code || '').localeCompare(b.country_code || '');
  });
};

const toCityRows = (rows: any[] | null | undefined): CitySearchRow[] =>
  (rows || [])
    .map((row) => ({
      id: Number(row.id),
      name: String(row.name || ''),
      country_code: String(row.country_code || '').toUpperCase(),
      population:
        row.population == null || Number.isNaN(Number(row.population))
          ? null
          : Number(row.population),
    }))
    .filter((row) => Number.isFinite(row.id) && row.name && row.country_code);

const cloneResponse = (response: CitySearchResponse): CitySearchResponse => ({
  data: response.data.map((row) => ({ ...row })),
  error: response.error,
});

const getCacheKey = (rawTerm: string, limit: number) => {
  const { cityQuery, countryCode } = parseCityQuery(rawTerm);
  return `${cityQuery}|${countryCode}|${limit}`;
};

const getCachedResponse = (key: string) => {
  const cached = responseCache.get(key);
  if (!cached) return null;

  if (cached.expiresAt < Date.now()) {
    responseCache.delete(key);
    return null;
  }

  return cloneResponse(cached.response);
};

const setCachedResponse = (key: string, response: CitySearchResponse) => {
  if (response.error) return;
  responseCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, response: cloneResponse(response) });

  if (responseCache.size > 80) {
    const firstKey = responseCache.keys().next().value;
    if (firstKey) responseCache.delete(firstKey);
  }
};

const clampLimit = (limit?: number) => Math.min(Math.max(Number(limit) || 80, 1), 120);

const searchCitiesFastName = async (
  cityQuery: string,
  countryCode: string,
  limit: number
): Promise<CitySearchResponse> => {
  const baseQuery = supabase
    .from('cities')
    .select('id, name, country_code, population')
    .ilike('name', `${cityQuery}%`)
    .order('population', { ascending: false, nullsFirst: false })
    .limit(limit);

  const { data, error } = countryCode ? await baseQuery.eq('country_code', countryCode) : await baseQuery;

  if (error) return { data: [], error };
  return { data: toCityRows(data), error: null };
};

const searchCitiesRpc = async (
  cityQuery: string,
  countryCode: string,
  limit: number
): Promise<CitySearchResponse> => {
  const { data, error } = await supabase.rpc('search_cities', {
    city_query: cityQuery,
    country_code_filter: countryCode || null,
    result_limit: limit,
  });

  if (error) return { data: [], error };
  return { data: toCityRows(data), error: null };
};

const searchCitiesTableFallback = async (
  cityQuery: string,
  countryCode: string,
  limit: number
): Promise<CitySearchResponse> => {
  const baseQuery = supabase
    .from('cities')
    .select('id, name, country_code, population')
    .ilike('name', `%${cityQuery}%`)
    .order('population', { ascending: false, nullsFirst: false })
    .limit(limit);

  const { data, error } = countryCode ? await baseQuery.eq('country_code', countryCode) : await baseQuery;

  if (error) return { data: [], error };
  return { data: toCityRows(data), error: null };
};

export const searchCities = async (
  rawTerm: string,
  options: { limit?: number } = {}
): Promise<CitySearchResponse> => {
  const raw = (rawTerm || '').trim();
  const { cityQuery, countryCode } = parseCityQuery(raw);
  const limit = clampLimit(options.limit);

  if (cityQuery.length < 2) return { data: [], error: null };

  const cacheKey = getCacheKey(raw, limit);
  const cached = getCachedResponse(cacheKey);
  if (cached) return cached;

  const inFlight = inFlightSearches.get(cacheKey);
  if (inFlight) return cloneResponse(await inFlight);

  const searchPromise = runCitySearch(raw, cityQuery, countryCode, limit);
  inFlightSearches.set(cacheKey, searchPromise);

  try {
    const response = await searchPromise;
    setCachedResponse(cacheKey, response);
    return cloneResponse(response);
  } finally {
    inFlightSearches.delete(cacheKey);
  }
};

const runCitySearch = async (
  raw: string,
  cityQuery: string,
  countryCode: string,
  limit: number
): Promise<CitySearchResponse> => {
  const fastName = await searchCitiesFastName(cityQuery, countryCode, limit);
  if (!fastName.error && fastName.data.length > 0) {
    return { data: prioritizeCityMatches(fastName.data, raw), error: null };
  }

  const primary = await searchCitiesRpc(cityQuery, countryCode, limit);

  if (!primary.error) {
    if (!countryCode || primary.data.length > 0) {
      return { data: prioritizeCityMatches(primary.data, raw), error: null };
    }

    const fallback = await searchCitiesRpc(cityQuery, '', limit);
    if (!fallback.error) {
      return { data: prioritizeCityMatches(fallback.data, raw), error: null };
    }
  }

  const tablePrimary = await searchCitiesTableFallback(cityQuery, countryCode, limit);
  if (tablePrimary.error) return tablePrimary;

  if (!countryCode || tablePrimary.data.length > 0) {
    return { data: prioritizeCityMatches(tablePrimary.data, raw), error: null };
  }

  const tableFallback = await searchCitiesTableFallback(cityQuery, '', limit);
  if (tableFallback.error) return tableFallback;

  return { data: prioritizeCityMatches(tableFallback.data, raw), error: null };
};
