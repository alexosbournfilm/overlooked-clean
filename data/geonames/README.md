# GeoNames City Import

This directory is used by `scripts/import-geonames-cities.js`.

Source: https://download.geonames.org/export/dump/cities1000.zip

GeoNames publishes the dump as UTF-8 tab-delimited text under the Creative
Commons Attribution 4.0 License. Their `cities1000.zip` file includes populated
places with population over 1000 and some administrative seats; the importer
filters again to `population >= 1000`.

Raw downloaded files such as `cities1000.zip` and `cities1000.txt` are ignored
by git. Refresh/import with:

```sh
node scripts/import-geonames-cities.js --dry-run
node scripts/import-geonames-cities.js
```

Run the Supabase migration first and provide `SUPABASE_SERVICE_ROLE_KEY` for the
real import.
