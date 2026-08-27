// Philippine Standard Geographic Code (PSGC) public API client.
// https://psgc.gitlab.io/api/ — no auth, CORS-enabled. Used for the
// cascading address typeahead: province -> city/municipality -> barangay.

const BASE_URL = "https://psgc.gitlab.io/api";

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function toItems(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({ code: String(row.code), name: String(row.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function getJson(path) {
  const response = await fetch(`${BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`Address lookup failed (HTTP ${response.status}).`);
  }
  return response.json();
}

// Lookup promises are cached so each list is fetched at most once per
// session; a failed request evicts itself so the next attempt can retry.
let provincesPromise = null;

export function fetchProvinces() {
  if (!provincesPromise) {
    provincesPromise = getJson("/provinces")
      .then(toItems)
      .catch((error) => {
        provincesPromise = null;
        throw error;
      });
  }
  return provincesPromise;
}

const citiesByProvince = new Map();

export function fetchCitiesMunicipalities(provinceCode) {
  if (!citiesByProvince.has(provinceCode)) {
    const promise = getJson(`/provinces/${provinceCode}/cities-municipalities`)
      .then(toItems)
      .catch((error) => {
        citiesByProvince.delete(provinceCode);
        throw error;
      });
    citiesByProvince.set(provinceCode, promise);
  }
  return citiesByProvince.get(provinceCode);
}

const barangaysByCityMunicipality = new Map();

export function fetchBarangays(cityMunicipalityCode) {
  if (!barangaysByCityMunicipality.has(cityMunicipalityCode)) {
    const promise = getJson(
      `/cities-municipalities/${cityMunicipalityCode}/barangays`
    )
      .then(toItems)
      .catch((error) => {
        barangaysByCityMunicipality.delete(cityMunicipalityCode);
        throw error;
      });
    barangaysByCityMunicipality.set(cityMunicipalityCode, promise);
  }
  return barangaysByCityMunicipality.get(cityMunicipalityCode);
}

/**
 * Form data stores plain names (what jobseekers see), but child lookups need
 * PSGC codes. These resolvers bridge the two using the cached lists.
 */
export async function resolveProvinceCode(name) {
  const wanted = normalizeName(name);
  if (!wanted) return null;
  const provinces = await fetchProvinces();
  return provinces.find((p) => normalizeName(p.name) === wanted)?.code ?? null;
}

export async function resolveCityMunicipalityCode(provinceCode, name) {
  const wanted = normalizeName(name);
  if (!provinceCode || !wanted) return null;
  const cities = await fetchCitiesMunicipalities(provinceCode);
  return cities.find((c) => normalizeName(c.name) === wanted)?.code ?? null;
}
