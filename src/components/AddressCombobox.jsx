import { useEffect, useMemo, useRef, useState } from "react";

function fold(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Type-to-suggest combobox over a PSGC list of {code, name} options.
 *
 * The input stays freely editable (typed text is a valid answer), while
 * suggestions come from the loaded list. Keyboard: ArrowDown/ArrowUp to move,
 * Enter to pick, Escape to close. ARIA 1.2 combobox pattern.
 */
export default function AddressCombobox({
  id,
  label,
  value,
  error,
  disabled = false,
  enabled = true,
  enabledHint,
  placeholder,
  loadOptions,
  onSelect,
  onInput,
  reloadKey,
}) {
  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!enabled) {
      setOptions(null);
      setLoading(false);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    loadOptions()
      .then((items) => {
        if (!cancelled) {
          setOptions(items);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err?.message ?? "Could not load suggestions.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, loadOptions, reloadKey]);

  useEffect(() => {
    function onPointerDown(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const filtered = useMemo(() => {
    const list = options ?? [];
    const query = fold(value);
    if (!query) return list;
    const starts = [];
    const contains = [];
    for (const option of list) {
      const name = fold(option.name);
      if (name.startsWith(query)) starts.push(option);
      else if (name.includes(query)) contains.push(option);
    }
    return [...starts, ...contains];
  }, [options, value]);

  const showList = open && enabled && !disabled;

  function choose(option) {
    onSelect(option.name);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(event) {
    if (!showList) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      if (activeIndex >= 0 && filtered[activeIndex]) {
        event.preventDefault();
        choose(filtered[activeIndex]);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const describedBy = error ? `${id}-error` : undefined;
  const activeId =
    showList && activeIndex >= 0 ? `${id}-opt-${activeIndex}` : undefined;

  return (
    <div className="field" ref={wrapRef}>
      <label htmlFor={id}>{label}</label>
      <div className="combo-anchor">
        <input
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={showList ? "true" : "false"}
          aria-controls={showList ? `${id}-listbox` : undefined}
          aria-activedescendant={activeId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          placeholder={placeholder}
          value={value}
          disabled={disabled || !enabled}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
          onChange={(e) => {
            onInput(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
        />
        {showList && (
          <ul
            id={`${id}-listbox`}
            role="listbox"
            aria-label={`${label} suggestions`}
            className="combo-listbox"
          >
            {loading && !options && (
              <li className="combo-status">Loading suggestions…</li>
            )}
            {loadError && (
              <li className="combo-status">
                {loadError} You can still type your answer below.
              </li>
            )}
            {options && !loading && filtered.length === 0 && (
              <li className="combo-status">
                No matches{value.trim() ? ` for "${value.trim()}"` : ""}. You can
                still type your answer.
              </li>
            )}
            {filtered.map((option, index) => (
              <li
                key={option.code}
                id={`${id}-opt-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`combo-option ${index === activeIndex ? "combo-option--active" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(option)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                {option.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      {!enabled && enabledHint && <p className="field-hint">{enabledHint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
