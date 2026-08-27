import { useCallback, useRef } from "react";
import AddressCombobox from "./AddressCombobox.jsx";
import {
  fetchBarangays,
  fetchCitiesMunicipalities,
  fetchProvinces,
  resolveCityMunicipalityCode,
  resolveProvinceCode,
} from "../lib/psgc.js";

/**
 * Cascading Philippine address fields backed by the PSGC public API:
 * Province first, then municipality/city suggestions within that province,
 * then barangay suggestions within that city/municipality.
 *
 * Suggestion scope always follows the text CURRENTLY shown in the parent
 * field, whether it arrived by picking a suggestion or by typing. Editing a
 * parent therefore immediately re-scopes its children (PSGC lists are cached,
 * so re-scoping is instant). Selecting or clearing a parent resets children.
 */
export default function AddressFieldsGroup({ keys, answers, errors, disabled, onChange }) {
  const provinceText = answers[keys.province] ?? "";
  const cityText = answers[keys.city] ?? "";

  // Loaders read the latest texts through a ref but keep stable identity so
  // refetches are driven solely by the reloadKey props below.
  const latest = useRef(null);
  latest.current = { provinceText, cityText };

  const loadProvinces = useCallback(() => fetchProvinces(), []);

  const loadCities = useCallback(async () => {
    const { provinceText: current } = latest.current;
    if (!current.trim()) return [];
    const code = await resolveProvinceCode(current);
    return code ? fetchCitiesMunicipalities(code) : [];
  }, []);

  const loadBarangays = useCallback(async () => {
    const { provinceText: province, cityText: city } = latest.current;
    if (!city.trim()) return [];
    const provinceCode = await resolveProvinceCode(province);
    if (!provinceCode) return [];
    const code = await resolveCityMunicipalityCode(provinceCode, city);
    return code ? fetchBarangays(code) : [];
  }, []);

  function clearChildren(...childKeys) {
    for (const key of childKeys) onChange(key, "");
  }

  return (
    <>
      <AddressCombobox
        id={`addr-${keys.province}`}
        label="Province *"
        placeholder="Start typing — e.g. Cagayan"
        value={provinceText}
        error={errors[keys.province]}
        disabled={disabled}
        loadOptions={loadProvinces}
        onSelect={(name) => {
          clearChildren(keys.city, keys.barangay);
          onChange(keys.province, name);
        }}
        onInput={(text) => {
          clearChildren(keys.city, keys.barangay);
          onChange(keys.province, text);
        }}
      />

      <AddressCombobox
        id={`addr-${keys.city}`}
        label="Municipality / City *"
        placeholder={
          provinceText.trim() ? "Start typing — e.g. Tuguegarao City" : "Choose a province first"
        }
        value={cityText}
        error={errors[keys.city]}
        disabled={disabled}
        enabled={Boolean(provinceText.trim())}
        enabledHint="Pick your province from the suggestions to unlock this field."
        loadOptions={loadCities}
        reloadKey={provinceText}
        onSelect={(name) => {
          clearChildren(keys.barangay);
          onChange(keys.city, name);
        }}
        onInput={(text) => {
          clearChildren(keys.barangay);
          onChange(keys.city, text);
        }}
      />

      <AddressCombobox
        id={`addr-${keys.barangay}`}
        label="Barangay *"
        placeholder={
          cityText.trim()
            ? "Start typing — e.g. Caritan Sur"
            : "Choose a municipality or city first"
        }
        value={answers[keys.barangay] ?? ""}
        error={errors[keys.barangay]}
        disabled={disabled}
        enabled={Boolean(cityText.trim())}
        enabledHint="Pick your municipality or city to unlock barangay suggestions."
        loadOptions={loadBarangays}
        reloadKey={`${provinceText} > ${cityText}`}
        onSelect={(name) => onChange(keys.barangay, name)}
        onInput={(text) => onChange(keys.barangay, text)}
      />
    </>
  );
}
