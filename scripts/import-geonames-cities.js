#!/usr/bin/env node

/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');
const { spawnSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'geonames');
const ZIP_PATH = path.join(DATA_DIR, 'cities1000.zip');
const TXT_PATH = path.join(DATA_DIR, 'cities1000.txt');
const SOURCE_URL = 'https://download.geonames.org/export/dump/cities1000.zip';
const DEFAULT_BATCH_SIZE = 250;

const args = new Set(process.argv.slice(2));
const getArgValue = (name, fallback) => {
  const prefix = `${name}=`;
  const arg = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
};

const dryRun = args.has('--dry-run');
const planOnly = args.has('--plan-only');
const batchSize = Number(getArgValue('--batch-size', DEFAULT_BATCH_SIZE)) || DEFAULT_BATCH_SIZE;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] == null) process.env[key] = value;
  }
}

function loadEnv() {
  [
    path.join(ROOT, '.env'),
    path.join(ROOT, '.env.local'),
    path.join(ROOT, 'supabase', '.env'),
  ].forEach(loadEnvFile);
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const tmpPath = `${destination}.tmp`;
    const file = fs.createWriteStream(tmpPath);

    const request = https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location) {
        file.close();
        fs.rmSync(tmpPath, { force: true });
        downloadFile(response.headers.location, destination).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.rmSync(tmpPath, { force: true });
        reject(new Error(`Download failed with HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        fs.renameSync(tmpPath, destination);
        resolve();
      });
    });

    request.on('error', (error) => {
      file.close();
      fs.rmSync(tmpPath, { force: true });
      reject(error);
    });
  });
}

async function ensureGeoNamesDump() {
  if (fs.existsSync(TXT_PATH)) return TXT_PATH;

  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(ZIP_PATH)) {
    console.log(`Downloading ${SOURCE_URL}`);
    await downloadFile(SOURCE_URL, ZIP_PATH);
  }

  const unzip = spawnSync('unzip', ['-o', ZIP_PATH, '-d', DATA_DIR], {
    stdio: 'inherit',
  });

  if (unzip.error) {
    throw new Error(`Unable to run unzip: ${unzip.error.message}`);
  }
  if (unzip.status !== 0) {
    throw new Error(`unzip exited with status ${unzip.status}`);
  }

  if (!fs.existsSync(TXT_PATH)) {
    throw new Error(`Expected ${TXT_PATH} after unzip`);
  }

  return TXT_PATH;
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cityKey(countryCode, name) {
  return `${String(countryCode || '').toUpperCase()}|${normalizeKey(name)}`;
}

function featureRank(row) {
  switch (row.feature_code) {
    case 'PPLC':
      return 0;
    case 'PPLA':
      return 1;
    case 'PPLA2':
      return 2;
    case 'PPLA3':
      return 3;
    case 'PPLA4':
      return 4;
    case 'PPL':
      return 5;
    case 'PPLX':
      return 6;
    default:
      return 7;
  }
}

function compareImportRows(a, b) {
  const populationDiff = (b.population || 0) - (a.population || 0);
  if (populationDiff !== 0) return populationDiff;

  const rankDiff = featureRank(a) - featureRank(b);
  if (rankDiff !== 0) return rankDiff;

  return (a.geoname_id || 0) - (b.geoname_id || 0);
}

function parseNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildSearchNames(name, asciiName, alternateNames) {
  return [name, asciiName, String(alternateNames || '').replace(/,/g, ' ')]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseGeoNamesLine(line) {
  const cols = line.split('\t');
  if (cols.length < 19) return null;

  const population = parseNumber(cols[14]) || 0;
  const featureClass = cols[6];
  const countryCode = String(cols[8] || '').toUpperCase();

  if (featureClass !== 'P' || population < 1000 || !countryCode) return null;

  const name = cols[1];
  const asciiName = cols[2] || null;
  const alternateNames = cols[3] || null;

  return {
    geoname_id: Number(cols[0]),
    name,
    ascii_name: asciiName,
    alternate_names: alternateNames,
    latitude: parseNumber(cols[4]),
    longitude: parseNumber(cols[5]),
    country_code: countryCode,
    admin1_code: cols[10] || null,
    admin2_code: cols[11] || null,
    feature_code: cols[7] || null,
    population,
    timezone: cols[17] || null,
    geonames_modified_at: cols[18] || null,
    search_names: buildSearchNames(name, asciiName, alternateNames),
  };
}

async function readGeoNamesRows(filePath) {
  const rows = [];
  const stats = {
    totalLines: 0,
    importedRows: 0,
    skippedRows: 0,
    panamaCity: null,
  };

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    stats.totalLines += 1;
    const row = parseGeoNamesLine(line);
    if (!row) {
      stats.skippedRows += 1;
      continue;
    }

    if (row.geoname_id === 3703443) stats.panamaCity = row;
    rows.push(row);
  }

  stats.importedRows = rows.length;
  return { rows, stats };
}

function getSupabaseClient() {
  loadEnv();

  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    (planOnly ? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY : undefined);

  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL/EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
        'Apply the migration first, then run with a service role key.'
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function fetchExistingCities(client) {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await client
      .from('cities')
      .select('id, name, country_code, geoname_id')
      .order('id', { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(
        `Could not read existing cities. Did you apply 20260618143000_add_geonames_city_search.sql? ${error.message}`
      );
    }

    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

function splitRowsForUpsert(importRows, existingRows) {
  const byGeonameId = new Map();
  const exactBuckets = new Map();
  const candidateByExistingId = new Map();

  for (const row of existingRows) {
    if (row.geoname_id != null) byGeonameId.set(Number(row.geoname_id), row);

    const key = cityKey(row.country_code, row.name);
    if (!exactBuckets.has(key)) exactBuckets.set(key, []);
    exactBuckets.get(key).push(row);
  }

  const updateById = [];
  const upsertByGeoname = [];

  for (const row of importRows) {
    if (byGeonameId.has(row.geoname_id)) {
      upsertByGeoname.push(row);
      continue;
    }

    const exactMatches = exactBuckets.get(cityKey(row.country_code, row.name)) || [];
    const unlinkedExactMatches = exactMatches.filter((match) => match.geoname_id == null);

    if (unlinkedExactMatches.length === 1) {
      const existingId = unlinkedExactMatches[0].id;
      const current = candidateByExistingId.get(existingId);

      if (!current || compareImportRows(row, current.row) < 0) {
        if (current) current.duplicates.push(current.row);
        candidateByExistingId.set(existingId, { id: existingId, row, duplicates: current?.duplicates || [] });
      } else {
        current.duplicates.push(row);
      }
    } else {
      upsertByGeoname.push(row);
    }
  }

  for (const candidate of candidateByExistingId.values()) {
    updateById.push({ ...candidate.row, id: candidate.id });
    upsertByGeoname.push(...candidate.duplicates);
  }

  return { updateById, upsertByGeoname };
}

async function upsertInBatches(client, rows, conflictColumn, label) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    await upsertBatchWithSplit(client, batch, conflictColumn, label, i);

    const done = Math.min(i + batch.length, rows.length);
    if (done === rows.length || done % (batchSize * 10) === 0) {
      console.log(`${label}: ${done}/${rows.length}`);
    }
  }
}

async function upsertBatchWithSplit(client, batch, conflictColumn, label, offset) {
  const { error } = await client
    .from('cities')
    .upsert(batch, { onConflict: conflictColumn, ignoreDuplicates: false });

  if (!error) return;

  if (batch.length <= 1) {
    throw new Error(`${label} failed at row ${offset}: ${error.message}`);
  }

  const mid = Math.floor(batch.length / 2);
  console.log(`${label}: retrying rows ${offset}-${offset + batch.length - 1} in smaller chunks (${error.message})`);

  await upsertBatchWithSplit(client, batch.slice(0, mid), conflictColumn, label, offset);
  await upsertBatchWithSplit(client, batch.slice(mid), conflictColumn, label, offset + mid);
}

async function main() {
  const dumpPath = await ensureGeoNamesDump();
  const { rows, stats } = await readGeoNamesRows(dumpPath);

  console.log(`GeoNames lines read: ${stats.totalLines}`);
  console.log(`Rows with population >= 1000: ${stats.importedRows}`);
  console.log(`Rows skipped: ${stats.skippedRows}`);

  if (stats.panamaCity) {
    console.log(
      `Panama City, Panama (PA) found: geoname_id=${stats.panamaCity.geoname_id}, population=${stats.panamaCity.population}`
    );
  } else {
    console.warn('Panama City, PA was not found in the parsed dataset.');
  }

  if (dryRun) return;

  const client = getSupabaseClient();
  const existingRows = await fetchExistingCities(client);
  const { updateById, upsertByGeoname } = splitRowsForUpsert(rows, existingRows);

  console.log(`Existing city rows: ${existingRows.length}`);
  console.log(`Rows updating existing city IDs: ${updateById.length}`);
  console.log(`Rows upserting by GeoNames ID: ${upsertByGeoname.length}`);

  if (planOnly) return;

  await upsertInBatches(client, updateById, 'id', 'Updating exact existing cities');
  await upsertInBatches(client, upsertByGeoname, 'geoname_id', 'Upserting GeoNames cities');

  console.log('GeoNames city import complete.');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
