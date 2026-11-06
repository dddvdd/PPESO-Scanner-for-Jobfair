import { useId, useRef, useState } from "react";

function asDate(value) {
  return new Date(`${value}T12:00:00Z`);
}

function addDays(value, days) {
  const date = asDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthStart(value, offset = 0) {
  const date = asDate(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1, 12)).toISOString().slice(0, 10);
}

const dateLabel = new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const monthLabel = new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "UTC" });

function rangeLabel(start, end) {
  if (!start) return "Select event dates";
  const first = dateLabel.format(asDate(start));
  return end && end !== start ? `${first} – ${dateLabel.format(asDate(end))}` : first;
}

export default function EventDatePicker({ start, end, disabled, onChange }) {
  const id = useId();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthStart(start || today));
  const [selection, setSelection] = useState({ start, end: end || start });
  const [choosingEnd, setChoosingEnd] = useState(false);
  const [hovered, setHovered] = useState(null);
  const triggerRef = useRef(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function toggle() {
    if (open) return close();
    setSelection({ start, end: end || start });
    setChoosingEnd(false);
    setHovered(null);
    setMonth(monthStart(start || today));
    setOpen(true);
  }

  function selectDay(day) {
    if (choosingEnd) {
      setSelection({ start: day < selection.start ? day : selection.start, end: day < selection.start ? selection.start : day });
    } else {
      setSelection({ start: day, end: day });
    }
    setChoosingEnd(!choosingEnd);
    setHovered(null);
  }

  function preset(first, last) {
    setSelection({ start: first, end: last });
    setMonth(monthStart(first));
    setChoosingEnd(false);
    setHovered(null);
  }

  const previewEnd = choosingEnd && hovered ? hovered : selection.end;
  const rangeStart = previewEnd && previewEnd < selection.start ? previewEnd : selection.start;
  const rangeEnd = previewEnd && previewEnd < selection.start ? selection.start : previewEnd;

  return (
    <div className="field event-date-picker" onKeyDown={(event) => {
      if (open && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    }}>
      <label htmlFor={id}>Event dates</label>
      <button ref={triggerRef} id={id} type="button" className="date-range-trigger" disabled={disabled}
        aria-expanded={open} aria-controls={`${id}-calendar`} onClick={toggle}>
        <span>{rangeLabel(start, end)}</span><span aria-hidden="true">▦</span>
      </button>
      {open && (
        <fieldset id={`${id}-calendar`} className="date-range-panel" disabled={disabled} aria-label="Choose event dates">
          <div className="date-range-body">
            <div className="date-range-presets" aria-label="Date shortcuts">
              <button type="button" onClick={() => preset(today, today)}>Today</button>
              <button type="button" onClick={() => preset(today, addDays(today, 6))}>Next 7 days</button>
              <button type="button" onClick={() => preset(today, addDays(today, 29))}>Next 30 days</button>
              <button type="button" onClick={() => preset(monthStart(today), addDays(monthStart(today, 1), -1))}>This month</button>
              <button type="button" onClick={() => preset(monthStart(today, 1), addDays(monthStart(today, 2), -1))}>Next month</button>
            </div>
            <div className="date-range-calendars" onMouseLeave={() => setHovered(null)}>
              <div className="date-range-navigation">
                <button type="button" aria-label="Previous month" onClick={() => setMonth(monthStart(month, -1))}>‹</button>
                <span>Choose the first and last day</span>
                <button type="button" aria-label="Next month" onClick={() => setMonth(monthStart(month, 1))}>›</button>
              </div>
              <div className="date-range-months">
                {[0, 1].map(offset => {
                  const first = monthStart(month, offset);
                  const headingId = `${id}-month-${offset}`;
                  const blanks = (asDate(first).getUTCDay() + 6) % 7;
                  const count = asDate(addDays(monthStart(first, 1), -1)).getUTCDate();
                  return (
                    <section key={first} aria-labelledby={headingId}>
                      <h3 id={headingId}>{monthLabel.format(asDate(first))}</h3>
                      <div className="date-range-grid">
                        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map(day => <span key={day} className="date-range-weekday" aria-hidden="true">{day}</span>)}
                        {Array.from({ length: blanks }, (_, index) => <span key={`blank-${index}`} />)}
                        {Array.from({ length: count }, (_, index) => {
                          const day = addDays(first, index);
                          const selected = Boolean(rangeStart && day >= rangeStart && day <= rangeEnd);
                          const endpoint = selected && (day === rangeStart || day === rangeEnd);
                          return <button key={day} type="button" data-date={day}
                            className={`date-range-day${selected ? " is-selected" : ""}${endpoint ? " is-endpoint" : ""}`}
                            aria-label={dateLabel.format(asDate(day))} aria-pressed={selected} aria-current={day === today ? "date" : undefined}
                            onClick={() => selectDay(day)} onMouseEnter={() => setHovered(day)}>{index + 1}</button>;
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="date-range-footer">
            <p role="status">{rangeLabel(selection.start, selection.end)}</p>
            <div className="date-range-actions">
              <button type="button" className="btn btn--ghost btn--small" onClick={() => { onChange("", ""); close(); }}>Clear</button>
              <button type="button" className="btn btn--ghost btn--small" onClick={close}>Cancel</button>
              <button type="button" className="btn btn--primary btn--small" disabled={!selection.start}
                onClick={() => { onChange(selection.start, selection.end); close(); }}>Apply</button>
            </div>
          </div>
        </fieldset>
      )}
    </div>
  );
}
