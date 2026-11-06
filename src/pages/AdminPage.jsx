import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  adminCreateEvent,
  adminCountEventCheckIns,
  adminCountEventRegistrations,
  adminEventCategoryBreakdown,
  adminEventInterviewSummary,
  adminCreateForm,
  adminCreateUser,
  adminCreateMunicipalScanners,
  adminDeleteEvent,
  adminDeleteUser,
  adminSetPassword,
  adminListEvents,
  adminListEventForms,
  adminListFormFields,
  adminListProfiles,
  adminListRegistrations,
  adminRestoreEvent,
  adminRestoreFormFields,
  adminRestoreForms,
  adminSaveOnlineEvent,
  adminUpdateEvent,
  adminUpdateProfileRole,
  exportPreRegistrants,
  exportCheckIns,
  adminRegistrationCorrectionCampaign,
  getPublishedFormWithFields,
} from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import UndoToast from "../components/UndoToast.jsx";
import PasswordInput from "../components/PasswordInput.jsx";
import EventDatePicker from "../components/EventDatePicker.jsx";
import { preRegistrantsCsv, downloadPreRegistrantsCsv } from "../lib/preRegistrantsExport.js";
import { checkinsCsv, downloadCheckinsCsv } from "../lib/checkinsExport.js";
import { MUNICIPALITIES } from "../lib/municipalities.js";

const ROLE_LABELS = { admin: "Admin", staff: "Staff", supervisor: "Supervisor", pending: "Pending" };

const TABS = [
  { id: "events", label: "Events" },
  { id: "export", label: "Export" },
  { id: "staff", label: "Staff roles" },
];

const BLANK_DRAFT = { name: "", description: "", event_date: "", event_end_date: "", location: "", municipality: "", isOnline: false, positions: "" };

/**
 * Brief confirmation message that clears itself (success-feedback).
 * Returns [notice, flash]; notice is null when nothing to show.
 */
function useFlash(timeoutMs = 4000) {
  const [notice, setNotice] = useState(null);
  const timerRef = useRef(null);
  const flash = useCallback(
    (text) => {
      setNotice(text);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setNotice(null), timeoutMs);
    },
    [timeoutMs]
  );
  useEffect(() => () => clearTimeout(timerRef.current), []);
  return [notice, flash];
}

function Notice({ text }) {
  if (!text) return null;
  return (
    <p role="status" className="alert alert--info">
      {text}
    </p>
  );
}

/**
 * Admin console — event setup + staff role management.
 * Every write goes through RLS-protected table helpers; only profiles with
 * role='admin' see or change anything here.
 */
export default function AdminPage() {
  // Tab state lives in the URL (?tab=staff) so refresh and back keep context.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab = tabParam === "staff" || tabParam === "export" ? tabParam : "events";
  const tabRefs = useRef({});
  const [undo, setUndo] = useState(null);
  const [pageNotice, flashPageNotice] = useFlash();
  const [pageError, setPageError] = useState(null);

  function pushUndo(payload) {
    setPageError(null);
    setUndo(payload); // replaces any pending undo — the old delete turns final
  }

  async function handleUndo(current) {
    setUndo(null);
    const failure = await current.run();
    if (failure) {
      setPageError(`Could not undo: ${failure}`);
    } else {
      flashPageNotice(current.afterMessage ?? "Changes reverted.");
    }
  }

  function selectTab(next) {
    setSearchParams(next === "events" ? {} : { tab: next }, { replace: true });
  }

  function onTablistKeyDown(event) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const idx = TABS.findIndex((t) => t.id === tab);
    const dir = event.key === "ArrowRight" ? 1 : -1;
    const next = TABS[(idx + dir + TABS.length) % TABS.length];
    selectTab(next.id);
    tabRefs.current[next.id]?.focus();
  }

  return (
    <section className="page admin-page">
      <h1 className="page-title">Event &amp; staff administration</h1>

      <div
        className="link-row admin-tabs"
        role="tablist"
        aria-label="Admin sections"
        onKeyDown={onTablistKeyDown}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={`btn btn--small ${tab === t.id ? "btn--primary" : "btn--ghost"}`}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Both panels stay mounted so half-filled forms survive tab switches. */}
      <div
        role="tabpanel"
        id="panel-events"
        aria-labelledby="tab-events"
        hidden={tab !== "events"}
      >
        <EventsPanel pushUndo={pushUndo} />
      </div>
      <div
        role="tabpanel"
        id="panel-export"
        aria-labelledby="tab-export"
        hidden={tab !== "export"}
      >
        <ExportPanel />
      </div>
      <div
        role="tabpanel"
        id="panel-staff"
        aria-labelledby="tab-staff"
        hidden={tab !== "staff"}
      >
        <StaffPanel pushUndo={pushUndo} />
      </div>

      {pageError && (
        <p role="alert" className="alert alert--error">
          {pageError}
        </p>
      )}
      <Notice text={pageNotice} />

      {undo && (
        <UndoToast undo={undo} onUndo={handleUndo} onExpire={() => setUndo(null)} />
      )}

      <p className="page-lead">
        <Link to="/staff/scanner">Scanner</Link>
        {" · "}
        <Link to="/staff/account">Account</Link>
      </p>
    </section>
  );
}

/* ------------------------------- Events -------------------------------- */

function EventsPanel({ pushUndo }) {
  const [events, setEvents] = useState(null); // null = loading
  const [checkInCounts, setCheckInCounts] = useState({});
  const [registrationCounts, setRegistrationCounts] = useState({});
  const [categoryData, setCategoryData] = useState({});
  const [interviewSummary, setInterviewSummary] = useState({});
  const [error, setError] = useState(null);
  const [notice, flash] = useFlash();
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const eventDialogRef = useRef(null);
  const [editing, setEditing] = useState(null); // event row being edited
  const [draft, setDraft] = useState(BLANK_DRAFT);
  const [draftError, setDraftError] = useState(null);
  const [positionsStatus, setPositionsStatus] = useState("ready");
  const [positionsAttempt, setPositionsAttempt] = useState(0);
  const onlineCreateId = useRef(null);
  const [busyEventId, setBusyEventId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const cardRefs = useRef({});
  const toggleRefs = useRef({});

  function toggleExpanded(id) {
    setDeletingId(null);
    setExpandedId((prev) => (prev === id ? null : id));
  }

  useEffect(() => {
    if (!expandedId) return;
    toggleRefs.current[expandedId]?.focus({ preventScroll: true });
    cardRefs.current[expandedId]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [expandedId]);

  async function reload() {
    const result = await adminListEvents();
    if (result.ok) {
      setEvents(result.data ?? []);
      setError(null);
      setCheckInCounts({});
      setRegistrationCounts({});
      setCategoryData({});
      setInterviewSummary({});
      const counts = await Promise.all((result.data ?? []).map(async (event) => {
        const [count, registrations, breakdown, interview] = await Promise.all([
          adminCountEventCheckIns(event.id),
          adminCountEventRegistrations(event.id),
          adminEventCategoryBreakdown(event.id),
          adminEventInterviewSummary(event.id),
        ]);
        return { id: event.id, checkIns: count.ok ? count.data : null,
          registrations: registrations.ok ? registrations.data : null,
          breakdown: breakdown.ok && breakdown.data?.status === "ok" ? breakdown.data.data : null,
          interview: interview.ok && interview.data?.status === "ok" ? interview.data.data : null };
      }));
      setCheckInCounts(Object.fromEntries(counts.map((count) => [count.id, count.checkIns])));
      setRegistrationCounts(Object.fromEntries(counts.map((count) => [count.id, count.registrations])));
      setCategoryData(Object.fromEntries(counts.map((count) => [count.id, count.breakdown])));
      setInterviewSummary(Object.fromEntries(counts.map((count) => [count.id, count.interview])));
    } else {
      setError(result.error.message);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!showForm) return;
    const dialog = eventDialogRef.current;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [showForm]);

  useEffect(() => {
    if (!editing?.is_online) return;
    let active = true;
    getPublishedFormWithFields(editing.id).then(result => {
      if (!active) return;
      if (!result.ok) {
        setPositionsStatus("error");
        return;
      }
      const position = result.data?.fields.find(field => field.field_key === "position_applying_for");
      setDraft(current => ({ ...current, positions: (position?.options ?? []).join("\n") }));
      setPositionsStatus("ready");
    });
    return () => { active = false; };
  }, [editing, positionsAttempt]);

  useEffect(() => {
    if (!events?.length) return;
    let active = true;
    let loading = false;
    async function refreshInterviews() {
      if (loading || document.visibilityState !== "visible") return;
      loading = true;
      const results = await Promise.all(events.map(async event => {
        const result = await adminEventInterviewSummary(event.id);
        return [event.id, result.ok && result.data?.status === "ok" ? result.data.data : null];
      }));
      if (active) setInterviewSummary(Object.fromEntries(results));
      loading = false;
    }
    const timer = setInterval(refreshInterviews, 15000);
    window.addEventListener("focus", refreshInterviews);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", refreshInterviews); };
  }, [events]);

  function openCreate() {
    onlineCreateId.current = null;
    setPositionsStatus("ready");
    setEditing(null);
    setDraft(BLANK_DRAFT);
    setDraftError(null);
    setShowForm(true);
  }

  function openEdit(ev) {
    setPositionsStatus(ev.is_online ? "loading" : "ready");
    setEditing({ ...ev });
    setDraft({
      name: ev.name ?? "",
      description: ev.description ?? "",
      event_date: ev.event_date ?? "",
      event_end_date: ev.event_end_date ?? "",
      location: ev.location ?? "",
      municipality: ev.municipality ?? "",
      isOnline: Boolean(ev.is_online),
      positions: "",
    });
    setDraftError(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setDraft(BLANK_DRAFT);
    setDraftError(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving || (draft.isOnline && positionsStatus !== "ready")) return;
    if (!draft.name.trim()) {
      setDraftError("Event name is required.");
      return;
    }
    if (draft.event_end_date && (!draft.event_date || draft.event_end_date < draft.event_date)) {
      setDraftError("Choose a start date and an end date on or after it.");
      return;
    }
    const positions = draft.isOnline
      ? [...new Set(draft.positions.split(/\r?\n/).map(line => line.trim()).filter(Boolean))]
      : [];
    if (draft.isOnline && (!positions.length || positions.length > 500 || positions.some(title => [...title].length > 500))) {
      setDraftError("Enter 1 to 500 positions, with one title of up to 500 characters per line.");
      return;
    }

    setSaving(true);
    setDraftError(null);

    const fields = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      event_date: draft.event_date || null,
      event_end_date: draft.event_end_date || null,
      location: draft.location.trim() || null,
      municipality: draft.municipality || null,
    };

    if (draft.isOnline) {
      const eventId = editing?.id ?? (onlineCreateId.current ??= crypto.randomUUID());
      const result = await adminSaveOnlineEvent(eventId, !editing, fields, positions);
      setSaving(false);
      if (!result.ok) {
        setDraftError(result.error.message);
        return;
      }
      closeForm();
      flash(editing ? `"${fields.name}" was updated.` : `"${fields.name}" is live — jobseekers can register now.`);
      reload();
      return;
    }

    if (editing) {
      const updated = await adminUpdateEvent(editing.id, fields);
      setSaving(false);
      if (!updated.ok) {
        setDraftError(updated.error.message);
        return;
      }
      closeForm();
      flash(`"${fields.name}" was updated.`);
      reload();
      return;
    }

    // 1) Create the event (published by default).
    const created = await adminCreateEvent({
      ...fields,
      status: "published",
    });
    if (!created.ok) {
      setDraftError(created.error.message);
      setSaving(false);
      return;
    }

    // 2) Auto-provision a published registration form so the public flow
    //    works immediately. Custom questions can be added later.
    const form = await adminCreateForm({
      eventId: created.data.id,
      name: `${fields.name} — Registration`,
      description: null,
    });
    if (!form.ok) {
      setDraftError(form.error.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    closeForm();
    flash(`"${created.data.name}" is live — jobseekers can register now.`);
    reload();
  }

  async function toggleStatus(ev) {
    if (busyEventId) return;
    setBusyEventId(ev.id);
    setError(null);

    const next = ev.status === "published" ? "draft" : "published";
    const result = await adminUpdateEvent(ev.id, { status: next });

    setBusyEventId(null);
    if (!result.ok) {
      setError(`Could not ${next === "published" ? "publish" : "unpublish"} "${ev.name}". ${result.error.message}`);
      return;
    }
    flash(next === "published" ? `"${ev.name}" is now visible to jobseekers.` : `"${ev.name}" is hidden from jobseekers.`);
    reload();
  }

  async function performDelete(ev) {
    setBusyEventId(ev.id);
    setError(null);

    // Registrations reference events ON DELETE RESTRICT, so check first and
    // explain instead of letting a raw foreign-key error bubble up.
    const regs = await adminListRegistrations({ eventId: ev.id, limit: 1 });
    if (regs.ok && (regs.data?.length ?? 0) > 0) {
      setBusyEventId(null);
      setDeletingId(null);
      setError(
        `"${ev.name}" already has jobseeker registrations and cannot be deleted. Unpublish it instead.`
      );
      return;
    }

    // Snapshot everything the delete will cascade away so Undo can restore
    // it verbatim: the event row, its forms, and each form's fields.
    const formsSnap = await adminListEventForms(ev.id);
    const forms = formsSnap.ok ? formsSnap.data ?? [] : [];
    const fieldsSnap = forms.length > 0
      ? await adminListFormFields(forms.map((f) => f.id))
      : { ok: true, data: [] };
    if (ev.is_online && (!formsSnap.ok || !fieldsSnap.ok)) {
      setBusyEventId(null);
      setDeletingId(null);
      setError("Could not back up the registration form. Please try again.");
      return;
    }
    const fields = fieldsSnap.ok ? fieldsSnap.data ?? [] : [];

    const result = await adminDeleteEvent(ev.id);
    setBusyEventId(null);

    if (!result.ok) {
      setDeletingId(null);
      setError(`Could not delete "${ev.name}". ${result.error.message}`);
      return;
    }

    setDeletingId(null);
    flash(`"${ev.name}" was deleted.`);
    reload();

    pushUndo({
      id: `${ev.id}-${Date.now()}`,
      label: `"${ev.name}" deleted.`,
      seconds: 8,
      afterMessage: `"${ev.name}" was restored.`,
      run: async () => {
        const republish = ev.is_online && ev.status === "published";
        const restoredEvent = await adminRestoreEvent(republish ? { ...ev, status: "draft" } : ev);
        if (!restoredEvent.ok) return restoredEvent.error.message;
        if (forms.length > 0) {
          const restoredForms = await adminRestoreForms(forms);
          if (!restoredForms.ok) return `event restored, but its registration form(s) did not: ${restoredForms.error.message}`;
        }
        if (fields.length > 0) {
          const restoredFields = await adminRestoreFormFields(fields);
          if (!restoredFields.ok) return `event and form restored, but their questions did not: ${restoredFields.error.message}`;
        }
        if (republish) {
          const published = await adminUpdateEvent(ev.id, { status: "published" });
          if (!published.ok) return `event restored as a draft: ${published.error.message}`;
        }
        reload();
        return null;
      },
    });
  }

  if (events === null && !error) {
    return <p className="status-line">Loading events…</p>;
  }

  const isEmpty = (events ?? []).length === 0;

  return (
    <div className="form-stack">
      {error && (
        <p role="alert" className="alert alert--error">
          {error}
        </p>
      )}
      <Notice text={notice} />

      {!isEmpty && (
        <button type="button" className="btn btn--primary btn--block" onClick={openCreate}>
          + New event
        </button>
      )}

      {showForm && (
        <dialog
          ref={eventDialogRef}
          className="event-dialog"
          aria-labelledby="event-dialog-title"
          onCancel={(event) => {
            event.preventDefault();
            if (!saving) closeForm();
          }}
        >
          <div className="event-dialog-header">
            <h2 id="event-dialog-title">{editing ? "Edit event" : "Create event"}</h2>
            <button type="button" className="btn btn--ghost btn--small" disabled={saving} onClick={closeForm} aria-label="Close event form">
              Close
            </button>
          </div>
        <form className="form-section" onSubmit={handleSubmit} noValidate>
          <div className="form-stack">
            {editing && (
              <p className="status-line">Editing “{editing.name}”</p>
            )}
            <div className="field">
              <label htmlFor="ev-name">Event name *</label>
              <input
                id="ev-name"
                type="text"
                autoFocus
                value={draft.name}
                disabled={saving}
                aria-invalid={draftError && !draft.name.trim() ? true : undefined}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="ev-format">Event format</label>
              <select id="ev-format" value={draft.isOnline ? "online" : "in-person"} disabled={saving || Boolean(editing)}
                onChange={(e) => setDraft((d) => ({ ...d, isOnline: e.target.value === "online" }))}>
                <option value="in-person">In person</option>
                <option value="online">Online</option>
              </select>
            </div>
            {draft.isOnline && (
              <div className="field">
                <label htmlFor="ev-positions">Available positions *</label>
                <textarea
                  id="ev-positions"
                  rows={5}
                  required
                  value={draft.positions}
                  disabled={saving || positionsStatus !== "ready"}
                  aria-describedby="ev-positions-hint"
                  onChange={(e) => setDraft((d) => ({ ...d, positions: e.target.value }))}
                />
                <p id="ev-positions-hint" className="field-hint">
                  Enter one position title per line. Applicants will choose one when they register.
                </p>
                {positionsStatus === "loading" && <p role="status">Loading positions…</p>}
                {positionsStatus === "error" && (
                  <>
                    <p role="alert" className="field-error">Could not load the current positions.</p>
                    <button type="button" className="btn btn--ghost btn--small" onClick={() => {
                      setPositionsStatus("loading");
                      setPositionsAttempt(attempt => attempt + 1);
                    }}>Retry loading positions</button>
                  </>
                )}
              </div>
            )}
            <EventDatePicker
              start={draft.event_date}
              end={draft.event_end_date}
              disabled={saving}
              onChange={(start, end) => setDraft(current => ({ ...current, event_date: start, event_end_date: end }))}
            />
            <div className="field">
              <label htmlFor="ev-municipality">Municipality / City</label>
              <select id="ev-municipality" value={draft.municipality} disabled={saving}
                onChange={(e) => setDraft((d) => ({ ...d, municipality: e.target.value }))}>
                <option value="">Unassigned — administrators and general staff only</option>
                {MUNICIPALITIES.map(({ name }) => <option key={name} value={name}>{name}</option>)}
              </select>
              <p className="field-hint">Only the scanner assigned to this municipality can access this event.</p>
            </div>
            {!draft.isOnline && (
              <div className="field">
                <label htmlFor="ev-location">Location</label>
                <input
                  id="ev-location"
                  type="text"
                  value={draft.location}
                  disabled={saving}
                  onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))}
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="ev-desc">Description</label>
              <textarea
                id="ev-desc"
                rows={2}
                value={draft.description}
                disabled={saving}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </div>
            {draftError && (
              <p role="alert" className="field-error">{draftError}</p>
            )}
            {!editing && (
              <p className="page-lead">
                A registration form is created automatically — jobseekers can
                register as soon as the event is published.
              </p>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" className="btn btn--primary btn--block" disabled={saving || (draft.isOnline && positionsStatus !== "ready")}>
                {saving ? "Saving…" : editing ? "Save changes" : "Create event"}
              </button>
              <button type="button" className="btn btn--ghost" disabled={saving} onClick={closeForm}>
                Cancel
              </button>
            </div>
          </div>
        </form>
        </dialog>
      )}

      {isEmpty && !error && (
        <div className="glass-card event-card">
          <h2>No events yet</h2>
          <p className="event-desc">
            Create your first job fair. It goes live immediately and gets a
            ready-to-use registration form.
          </p>
          <button type="button" className="btn btn--primary" onClick={openCreate}>
            + Create your first event
          </button>
        </div>
      )}

      <ul className="event-list admin-event-list">
        {(events ?? []).map((ev) => {
          const busy = busyEventId === ev.id;
          const confirmingDelete = deletingId === ev.id;
          const isExpanded = expandedId === ev.id;
          const dateLabel = `${ev.event_date ?? "No date"}${
            ev.event_end_date && ev.event_end_date !== ev.event_date ? ` – ${ev.event_end_date}` : ""
          }`;

          return (
            <li
              key={ev.id}
              ref={(el) => {
                cardRefs.current[ev.id] = el;
              }}
              className={`glass-card event-card admin-event-card${isExpanded ? " admin-event-card--expanded" : ""}`}
              style={{ minWidth: 0 }}
            >
              <h2 className="admin-event-heading">
                <button
                  ref={(el) => {
                    toggleRefs.current[ev.id] = el;
                  }}
                  type="button"
                  className="admin-event-toggle"
                  aria-expanded={isExpanded}
                  aria-controls={`admin-event-body-${ev.id}`}
                  onClick={() => toggleExpanded(ev.id)}
                >
                  <span className="admin-event-title">{ev.name}</span>
                  <span className="admin-event-date">{dateLabel}</span>
                  <svg
                    className="admin-event-chevron"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </h2>

              {isExpanded && (
                <div id={`admin-event-body-${ev.id}`} className="admin-event-body">
                  <p className="event-meta">
                    {dateLabel}
                    {ev.is_online ? " · Online" : ""}
                    {ev.location ? ` · ${ev.location}` : ""}
                  </p>
                  <p className="event-meta">Municipality: {ev.municipality ?? "Unassigned"}</p>
                  <span
                    className={`chip ${ev.status === "published" ? "" : "chip--muted"}`}
                    aria-label={`Status: ${ev.status}`}
                  >
                    <span className="chip-dot" aria-hidden="true" />
                    {ev.status}
                  </span>

                  {categoryData[ev.id] ? (
                    <div className="category-table-wrap">
                      <table className="category-table">
                        <thead>
                          <tr>
                            <th>Category</th>
                            <th>Preregistrants</th>
                            <th>Check-in</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="category-table-total">
                            <td>Total</td>
                            <td title={`MALE: ${(categoryData[ev.id].total_prereg_male ?? 0).toLocaleString()}\nFEMALE: ${(categoryData[ev.id].total_prereg_female ?? 0).toLocaleString()}\nUNSPECIFIED: ${(categoryData[ev.id].total_prereg_unspecified ?? 0).toLocaleString()}`}>{(categoryData[ev.id].total_prereg ?? 0).toLocaleString()}</td>
                            <td title={`MALE: ${(categoryData[ev.id].total_checkin_male ?? 0).toLocaleString()}\nFEMALE: ${(categoryData[ev.id].total_checkin_female ?? 0).toLocaleString()}\nUNSPECIFIED: ${(categoryData[ev.id].total_checkin_unspecified ?? 0).toLocaleString()}`}>{(categoryData[ev.id].total_checkin ?? 0).toLocaleString()}</td>
                          </tr>
                          <tr>
                            <td>PWD</td>
                            <td title={`MALE: ${(categoryData[ev.id].pwd_prereg_male ?? 0).toLocaleString()}\nFEMALE: ${(categoryData[ev.id].pwd_prereg_female ?? 0).toLocaleString()}\nUNSPECIFIED: ${(categoryData[ev.id].pwd_prereg_unspecified ?? 0).toLocaleString()}`}>{(categoryData[ev.id].pwd_prereg ?? 0).toLocaleString()}</td>
                            <td title={`MALE: ${(categoryData[ev.id].pwd_checkin_male ?? 0).toLocaleString()}\nFEMALE: ${(categoryData[ev.id].pwd_checkin_female ?? 0).toLocaleString()}\nUNSPECIFIED: ${(categoryData[ev.id].pwd_checkin_unspecified ?? 0).toLocaleString()}`}>{(categoryData[ev.id].pwd_checkin ?? 0).toLocaleString()}</td>
                          </tr>
                          <tr>
                            <td>First-time Job seekers</td>
                            <td title={`MALE: ${(categoryData[ev.id].first_time_prereg_male ?? 0).toLocaleString()}\nFEMALE: ${(categoryData[ev.id].first_time_prereg_female ?? 0).toLocaleString()}\nUNSPECIFIED: ${(categoryData[ev.id].first_time_prereg_unspecified ?? 0).toLocaleString()}`}>{(categoryData[ev.id].first_time_prereg ?? 0).toLocaleString()}</td>
                            <td title={`MALE: ${(categoryData[ev.id].first_time_checkin_male ?? 0).toLocaleString()}\nFEMALE: ${(categoryData[ev.id].first_time_checkin_female ?? 0).toLocaleString()}\nUNSPECIFIED: ${(categoryData[ev.id].first_time_checkin_unspecified ?? 0).toLocaleString()}`}>{(categoryData[ev.id].first_time_checkin ?? 0).toLocaleString()}</td>
                          </tr>
                          <tr>
                            <td>Returning OFW</td>
                            <td title={`MALE: ${(categoryData[ev.id].ofw_prereg_male ?? 0).toLocaleString()}\nFEMALE: ${(categoryData[ev.id].ofw_prereg_female ?? 0).toLocaleString()}\nUNSPECIFIED: ${(categoryData[ev.id].ofw_prereg_unspecified ?? 0).toLocaleString()}`}>{(categoryData[ev.id].ofw_prereg ?? 0).toLocaleString()}</td>
                            <td title={`MALE: ${(categoryData[ev.id].ofw_checkin_male ?? 0).toLocaleString()}\nFEMALE: ${(categoryData[ev.id].ofw_checkin_female ?? 0).toLocaleString()}\nUNSPECIFIED: ${(categoryData[ev.id].ofw_checkin_unspecified ?? 0).toLocaleString()}`}>{(categoryData[ev.id].ofw_checkin ?? 0).toLocaleString()}</td>
                          </tr>
                          <tr>
                            <td>Returning workers</td>
                            <td title={`MALE: ${(categoryData[ev.id].worker_prereg_male ?? 0).toLocaleString()}\nFEMALE: ${(categoryData[ev.id].worker_prereg_female ?? 0).toLocaleString()}\nUNSPECIFIED: ${(categoryData[ev.id].worker_prereg_unspecified ?? 0).toLocaleString()}`}>{(categoryData[ev.id].worker_prereg ?? 0).toLocaleString()}</td>
                            <td title={`MALE: ${(categoryData[ev.id].worker_checkin_male ?? 0).toLocaleString()}\nFEMALE: ${(categoryData[ev.id].worker_checkin_female ?? 0).toLocaleString()}\nUNSPECIFIED: ${(categoryData[ev.id].worker_checkin_unspecified ?? 0).toLocaleString()}`}>{(categoryData[ev.id].worker_checkin ?? 0).toLocaleString()}</td>
                          </tr>
                          <tr>
                            <td>Interested in Training</td>
                            <td title={`MALE: ${(categoryData[ev.id].training_prereg_male ?? 0).toLocaleString()}\nFEMALE: ${(categoryData[ev.id].training_prereg_female ?? 0).toLocaleString()}\nUNSPECIFIED: ${(categoryData[ev.id].training_prereg_unspecified ?? 0).toLocaleString()}`}>{(categoryData[ev.id].training_prereg ?? 0).toLocaleString()}</td>
                            <td title={`MALE: ${(categoryData[ev.id].training_checkin_male ?? 0).toLocaleString()}\nFEMALE: ${(categoryData[ev.id].training_checkin_female ?? 0).toLocaleString()}\nUNSPECIFIED: ${(categoryData[ev.id].training_checkin_unspecified ?? 0).toLocaleString()}`}>{(categoryData[ev.id].training_checkin ?? 0).toLocaleString()}</td>
                          </tr>
                          <tr>
                            <td>Walk-in</td>
                            <td title={`MALE: ${(categoryData[ev.id].walkin_prereg_male ?? 0).toLocaleString()}\nFEMALE: ${(categoryData[ev.id].walkin_prereg_female ?? 0).toLocaleString()}\nUNSPECIFIED: ${(categoryData[ev.id].walkin_prereg_unspecified ?? 0).toLocaleString()}`}>{(categoryData[ev.id].walkin_prereg ?? 0).toLocaleString()}</td>
                            <td title={`MALE: ${(categoryData[ev.id].walkin_checkin_male ?? 0).toLocaleString()}\nFEMALE: ${(categoryData[ev.id].walkin_checkin_female ?? 0).toLocaleString()}\nUNSPECIFIED: ${(categoryData[ev.id].walkin_checkin_unspecified ?? 0).toLocaleString()}`}>{(categoryData[ev.id].walkin_checkin ?? 0).toLocaleString()}</td>
                          </tr>
                          <tr>
                            <td>Youth (30 &amp; below)</td>
                            <td title={`MALE: ${(categoryData[ev.id].youth_prereg_male ?? 0).toLocaleString()}\nFEMALE: ${(categoryData[ev.id].youth_prereg_female ?? 0).toLocaleString()}\nUNSPECIFIED: ${(categoryData[ev.id].youth_prereg_unspecified ?? 0).toLocaleString()}`}>{(categoryData[ev.id].youth_prereg ?? 0).toLocaleString()}</td>
                            <td title={`MALE: ${(categoryData[ev.id].youth_checkin_male ?? 0).toLocaleString()}\nFEMALE: ${(categoryData[ev.id].youth_checkin_female ?? 0).toLocaleString()}\nUNSPECIFIED: ${(categoryData[ev.id].youth_checkin_unspecified ?? 0).toLocaleString()}`}>{(categoryData[ev.id].youth_checkin ?? 0).toLocaleString()}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="event-meta" aria-live="polite">
                      Loading category data…
                    </p>
                  )}

                  {interviewSummary[ev.id] ? (
                    <div className="category-table-wrap">
                      <table className="category-table">
                        <thead>
                          <tr>
                            <th>Local Interview Result</th>
                            <th>Female</th>
                            <th>Male</th>
                            <th>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>HOTS</td>
                            <td>{(interviewSummary[ev.id].hots_female ?? 0).toLocaleString()}</td>
                            <td>{(interviewSummary[ev.id].hots_male ?? 0).toLocaleString()}</td>
                            <td>{(interviewSummary[ev.id].hots_total ?? 0).toLocaleString()}</td>
                          </tr>
                          <tr>
                            <td>Near Hire</td>
                            <td>{(interviewSummary[ev.id].near_hire_female ?? 0).toLocaleString()}</td>
                            <td>{(interviewSummary[ev.id].near_hire_male ?? 0).toLocaleString()}</td>
                            <td>{(interviewSummary[ev.id].near_hire_total ?? 0).toLocaleString()}</td>
                          </tr>
                          <tr>
                            <td>Qualified</td>
                            <td>{(interviewSummary[ev.id].qualified_female ?? 0).toLocaleString()}</td>
                            <td>{(interviewSummary[ev.id].qualified_male ?? 0).toLocaleString()}</td>
                            <td>{(interviewSummary[ev.id].qualified_total ?? 0).toLocaleString()}</td>
                          </tr>
                          <tr>
                            <td>Not Qualified</td>
                            <td>{(interviewSummary[ev.id].not_qualified_female ?? 0).toLocaleString()}</td>
                            <td>{(interviewSummary[ev.id].not_qualified_male ?? 0).toLocaleString()}</td>
                            <td>{(interviewSummary[ev.id].not_qualified_total ?? 0).toLocaleString()}</td>
                          </tr>
                          <tr className="category-table-total">
                            <td>Total</td>
                            <td>{(interviewSummary[ev.id].total_female ?? 0).toLocaleString()}</td>
                            <td>{(interviewSummary[ev.id].total_male ?? 0).toLocaleString()}</td>
                            <td>{((interviewSummary[ev.id].total_female ?? 0) + (interviewSummary[ev.id].total_male ?? 0)).toLocaleString()}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    <Link
                      className="btn btn--ghost btn--small"
                      to={`/admin/events/${ev.id}/registrants`}
                    >
                      Registrants
                    </Link>
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      disabled={busy}
                      onClick={() => toggleStatus(ev)}
                    >
                      {busy
                        ? "Working…"
                        : ev.status === "published"
                          ? "Unpublish"
                          : "Publish"}
                    </button>
                    {!confirmingDelete && (
                      <>
                        <button
                          type="button"
                          className="btn btn--ghost btn--small"
                          disabled={busy || saving}
                          onClick={() => openEdit(ev)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--small"
                          disabled={busy}
                          onClick={() => setDeletingId(ev.id)}
                        >
                          Delete…
                        </button>
                      </>
                    )}
                    {confirmingDelete && (
                      <>
                        <button
                          type="button"
                          className="btn btn--danger btn--small"
                          disabled={busy}
                          onClick={() => performDelete(ev)}
                        >
                          {busy ? "Working…" : "Yes, delete permanently"}
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--small"
                          disabled={busy}
                          onClick={() => setDeletingId(null)}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------- Export -------------------------------- */

function ExportPanel() {
  const navigate = useNavigate();
  const [events, setEvents] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [exporting, setExporting] = useState(null); // "pre-reg" | "checkin" | null
  const [notice, flash] = useFlash();
  const [error, setError] = useState(null);
  const [correctionPreview, setCorrectionPreview] = useState(null);
  const [correctionBusy, setCorrectionBusy] = useState(false);
  const [correctionStatus, setCorrectionStatus] = useState(null);
  const [correctionStatusBusy, setCorrectionStatusBusy] = useState(false);
  const [correctionStatusRefresh, setCorrectionStatusRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    adminListEvents().then((result) => {
      if (!active) return;
      if (result.ok) setEvents(result.data ?? []);
      else setError(result.error.message);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedEventId) {
      setCorrectionStatus(null);
      return undefined;
    }

    let active = true;
    setCorrectionStatus(null);
    setCorrectionStatusBusy(true);
    adminRegistrationCorrectionCampaign(selectedEventId, "status").then((result) => {
      if (!active) return;
      if (!result.ok) {
        setError(`Could not load correction email status: ${result.error.message}`);
        return;
      }
      if (result.data?.status !== "ok") {
        setError(result.data?.error ?? "Could not load correction email status.");
        return;
      }
      setCorrectionStatus({ ...result.data, eventId: selectedEventId });
    }).finally(() => {
      if (active) setCorrectionStatusBusy(false);
    });
    return () => { active = false; };
  }, [selectedEventId, correctionStatusRefresh]);

  const selectedEvent = (events ?? []).find((ev) => ev.id === selectedEventId) || null;

  async function handleCorrectionPreview() {
    if (!selectedEvent || correctionBusy) return;
    setCorrectionBusy(true);
    setCorrectionPreview(null);
    setError(null);
    const result = await adminRegistrationCorrectionCampaign(selectedEvent.id, "preview");
    setCorrectionBusy(false);
    if (!result.ok) {
      setError(`Could not preview correction emails: ${result.error.message}`);
      return;
    }
    if (result.data?.status !== "ok") {
      setError(result.data?.error ?? "Could not preview correction emails.");
      return;
    }
    setCorrectionPreview({ ...result.data, eventId: selectedEvent.id });
  }

  async function handleSendCorrectionEmails() {
    if (!selectedEvent || correctionBusy || correctionPreview?.eventId !== selectedEvent.id) return;
    const count = correctionPreview.eligible;
    if (!Number.isInteger(count) || count < 1) return;
    const confirmed = window.confirm(
      `Send correction emails to ${count.toLocaleString()} preregistrants for "${selectedEvent.name}"? Each link will expire after 7 days and can be used once.`
    );
    if (!confirmed) return;

    setCorrectionBusy(true);
    setError(null);
    const result = await adminRegistrationCorrectionCampaign(selectedEvent.id, "send");
    setCorrectionBusy(false);
    if (!result.ok) {
      setError(`Correction email campaign failed: ${result.error.message}`);
      return;
    }
    if (result.data?.status !== "ok") {
      setError(result.data?.error ?? "Correction email campaign failed.");
      return;
    }
    setCorrectionPreview(null);
    flash(`Resend accepted ${result.data.sent} emails; ${result.data.failed} failed and ${result.data.skipped} invalid addresses were skipped. Refresh status below for delivery updates.`);
    setCorrectionStatusRefresh((version) => version + 1);
  }

  async function handleExportPreRegistrants() {
    if (!selectedEvent || exporting) return;
    setExporting("pre-reg");
    setError(null);
    try {
      const result = await exportPreRegistrants(selectedEvent.id);
      if (!result.ok) throw new Error(result.error.message);
      const { rows, fields } = result.data;
      downloadPreRegistrantsCsv(selectedEvent.name, preRegistrantsCsv(selectedEvent.name, fields, rows));
      flash(`Exported ${rows.length} pre-registrants.`);
    } catch (err) {
      setError(`Pre-registrant export failed: ${err.message}`);
    } finally {
      setExporting(null);
    }
  }

  async function handleExportCheckIns() {
    if (!selectedEvent || exporting) return;
    setExporting("checkin");
    setError(null);
    try {
      const result = await exportCheckIns(selectedEvent.id);
      if (!result.ok) throw new Error(result.error.message);
      const rows = result.data;
      downloadCheckinsCsv(selectedEvent.name, checkinsCsv(selectedEvent.name, rows));
      flash(`Exported ${rows.length} check-ins.`);
    } catch (err) {
      setError(`Check-in export failed: ${err.message}`);
    } finally {
      setExporting(null);
    }
  }

  if (events === null && !error) {
    return <p className="status-line">Loading events…</p>;
  }

  const noEvents = (events ?? []).length === 0;

  return (
    <div className="form-stack">
      {error && (
        <p role="alert" className="alert alert--error">{error}</p>
      )}
      <Notice text={notice} />

      <div className="glass-card event-card">
        <h2>Export</h2>
        <p className="event-desc">
          Select an event, then download pre-registrants or check-in data as CSV.
        </p>

        <div className="field">
          <label htmlFor="export-event">Select event</label>
          <select
            id="export-event"
            value={selectedEventId}
            disabled={noEvents || !!exporting || correctionBusy}
            onChange={(e) => {
              setSelectedEventId(e.target.value);
              setCorrectionPreview(null);
              setCorrectionStatus(null);
            }}
          >
            <option value="">{noEvents ? "No events available" : "Select event"}</option>
            {(events ?? []).map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}{ev.event_date ? ` — ${ev.event_date}` : ""}
              </option>
            ))}
          </select>
        </div>

        {noEvents && (
          <p className="field-hint">No events have been created yet.</p>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            disabled={!selectedEventId}
            onClick={() => navigate(`/staff/interviews?event=${selectedEventId}`)}
          >
            Manage Interview
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            disabled={!selectedEventId || !!exporting || correctionBusy}
            onClick={handleExportPreRegistrants}
          >
            {exporting === "pre-reg" ? "Exporting…" : "Download Pre-registrants"}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            disabled={!selectedEventId || !!exporting || correctionBusy}
            onClick={handleExportCheckIns}
          >
            {exporting === "checkin" ? "Exporting…" : "Download Check-ins"}
          </button>
        </div>
      </div>

      <div className="glass-card event-card">
        <h2>Missing registration details</h2>
        <p className="event-desc">
          Preview preregistrants with missing registration details, then send each one a private correction link. Links expire after 7 days and can be used once.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            disabled={!selectedEventId || correctionBusy || !!exporting}
            onClick={handleCorrectionPreview}
          >
            {correctionBusy ? "Working…" : "Preview affected preregistrants"}
          </button>
          {correctionPreview?.eventId === selectedEventId && (
            <>
              <p className="field-hint" role="status">
                {correctionPreview.eligible.toLocaleString()} preregistrants have at least one missing field.
              </p>
              <button
                type="button"
                className="btn btn--primary btn--small"
                disabled={correctionBusy || correctionPreview.eligible === 0}
                onClick={handleSendCorrectionEmails}
              >
                Send correction emails
              </button>
            </>
          )}
        </div>
        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            disabled={!selectedEventId || correctionStatusBusy || correctionBusy}
            onClick={() => setCorrectionStatusRefresh((version) => version + 1)}
          >
            {correctionStatusBusy ? "Refreshing status…" : "Refresh email status"}
          </button>
          {correctionStatus?.eventId === selectedEventId && (
            <div aria-live="polite" style={{ marginTop: 12 }}>
              <p className="field-hint">
                Latest correction email per preregistrant ({correctionStatus.total.toLocaleString()} total):
                {" "}status unavailable for older sends {correctionStatus.counts.unknown.toLocaleString()},
                {" "}Pending {correctionStatus.counts.pending.toLocaleString()},
                {" "}accepted by Resend {correctionStatus.counts.sent.toLocaleString()},
                {" "}delivered to mail server {correctionStatus.counts.delivered.toLocaleString()},
                {" "}bounced {correctionStatus.counts.bounced.toLocaleString()},
                {" "}delayed {correctionStatus.counts.delayed.toLocaleString()},
                {" "}failed {correctionStatus.counts.failed.toLocaleString()},
                {" "}spam complaints {correctionStatus.counts.complained.toLocaleString()}.
              </p>
              <p className="field-hint">
                “Delivered” means the recipient’s mail server accepted the email; it does not confirm inbox placement or that the person saw it.
                {" "}Updates arrive through the configured Resend webhook; check the webhook delivery log in Resend if statuses stay unchanged.
                {correctionStatus.updatedAt
                  ? ` Last event: ${new Date(correctionStatus.updatedAt).toLocaleString()}.`
                  : ""}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------- Staff role management ----------------------- */

function StaffPanel({ pushUndo }) {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState(null);
  const [error, setError] = useState(null);
  const [notice, flash] = useFlash();
  const [busyId, setBusyId] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("staff");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState(null);

  const [passwordEditId, setPasswordEditId] = useState(null);
  const [passwordValue, setPasswordValue] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState(null);
  const [initialPassword, setInitialPassword] = useState("");
  const [provisioning, setProvisioning] = useState(false);
  const [scannerResults, setScannerResults] = useState(null);

  async function createMunicipalScanners(event) {
    event.preventDefault();
    if (provisioning) return;
    setProvisioning(true);
    setError(null);
    setScannerResults(null);
    const result = await adminCreateMunicipalScanners(initialPassword);
    setProvisioning(false);
    if (!result.ok || result.data?.status !== "ok") {
      setError(!result.ok ? result.error.message : "Could not create municipal scanners. Enter a temporary password of at least 6 characters.");
      return;
    }
    setInitialPassword("");
    setScannerResults(result.data.accounts);
    flash("Municipal scanner setup completed. Existing accounts were left unchanged.");
    reload();
  }

  async function reload() {
    const result = await adminListProfiles();
    if (result.ok) setProfiles(result.data ?? []);
    else setError(result.error.message);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyRole(id, role) {
    setBusyId(id);
    setError(null);

    const result = await adminUpdateProfileRole(id, role);

    setBusyId(null);
    setConfirmingId(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    flash(role === "staff" ? "Account promoted to Staff — scanner access granted." : "Access revoked — account is Pending.");
    reload();
  }

  async function createUser(e) {
    e.preventDefault();
    setFormError(null);
    setCreating(true);
    const result = await adminCreateUser({
      email: newEmail,
      password: newPassword,
      role: newRole,
    });
    setCreating(false);

    if (!result.ok) {
      setFormError(result.error.message);
      return;
    }

    const payload = result.data ?? {};
    if (payload.status !== "ok") {
      const messages = {
        forbidden: "Only admins can create accounts.",
        invalid_role: "Invalid role selected.",
        invalid_email: "Please enter a valid email address.",
        weak_password: "Password must be at least 8 characters.",
        email_taken: "An account with that email already exists.",
      };
      setFormError(messages[payload.status] || payload.message || "Could not create the account.");
      return;
    }

    flash(`Account created for ${payload.email} as ${ROLE_LABELS[payload.role] ?? payload.role}.`);
    setNewEmail("");
    setNewPassword("");
    setNewRole("staff");
    reload();
  }

  async function savePassword(profile) {
    setPasswordError(null);
    setPasswordBusy(true);
    const result = await adminSetPassword({
      email: profile.email,
      password: passwordValue,
    });
    setPasswordBusy(false);

    if (!result.ok) {
      setPasswordError(result.error.message);
      return;
    }

    const payload = result.data ?? {};
    if (payload.status !== "ok") {
      const messages = {
        forbidden: "Only admins can change passwords.",
        weak_password: "Password must be at least 8 characters.",
        not_found: "No account with that email was found.",
      };
      setPasswordError(messages[payload.status] || payload.message || "Could not update the password.");
      return;
    }

    flash(`Password updated for ${profile.email}.`);
    setPasswordEditId(null);
    setPasswordValue("");
  }

  async function removeProfile(profile) {
    setBusyId(profile.id);
    setError(null);

    const result = await adminDeleteUser(profile.email);
    setBusyId(null);
    setDeleteConfirmId(null);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }

    const payload = result.data ?? {};
    if (payload.status !== "ok") {
      const messages = {
        forbidden: "Only admins can delete accounts.",
        not_found: "That account could not be found.",
      };
      setError(messages[payload.status] || payload.message || "Could not delete the account.");
      return;
    }

    const displayName = profile.full_name || profile.email || "(no name yet)";
    flash(`"${displayName}" was removed from this workspace.`);
    reload();

    pushUndo({
      id: `${profile.id}-${Date.now()}`,
      label: `"${displayName}" deleted.`,
      seconds: 8,
      afterMessage: `"${displayName}" was restored.`,
      run: async () => {
        // Deletion removed the whole Auth account, so undo recreates it via
        // the same corrected admin_create_user flow (temporary password).
        const restored = await adminCreateUser({
          email: profile.email,
          password: "ChangeMe@Temp123",
          role: profile.role,
        });
        if (!restored.ok) return restored.error.message;
        reload();
        return null;
      },
    });
  }

  if (profiles === null && !error) {
    return <p className="status-line">Loading accounts…</p>;
  }

  const isEmpty = (profiles ?? []).length === 0;

  return (
    <div className="form-stack">
      {error && (
        <p role="alert" className="alert alert--error">
          {error}
        </p>
      )}
      <Notice text={notice} />

      <div className="glass-card event-card">
        <h2>Municipal scanner accounts</h2>
        <p className="event-desc">Create 29 scanner logins covering the listed municipalities and Tuguegarao City.
          Each account sees only events assigned to its municipality and must change its temporary password on first login.
          Existing email addresses are skipped.</p>
        <form className="form-stack" onSubmit={createMunicipalScanners}>
          <div className="field">
            <label htmlFor="scanner-initial-password">Temporary password for new scanners</label>
            <PasswordInput id="scanner-initial-password" autoComplete="new-password" value={initialPassword} minLength={6} required disabled={provisioning}
              onChange={(e) => setInitialPassword(e.target.value)} />
          </div>
          <button className="btn btn--primary" type="submit" disabled={provisioning}>
            {provisioning ? "Creating scanners…" : "Create 29 municipal scanners"}
          </button>
        </form>
        {scannerResults && <ul>{scannerResults.map((account) => <li key={account.email}>
          {account.municipality}: {account.email} — {account.status}
        </li>)}</ul>}
      </div>

      <div className="glass-card event-card">
        <h2>Create account</h2>
        <p className="event-desc">
          Add a staff or admin login. The password is hashed securely and the
          account is ready to sign in immediately — no email confirmation needed.
        </p>
        <form className="form-stack" onSubmit={createUser}>
          {formError && (
            <p role="alert" className="alert alert--error">{formError}</p>
          )}
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              className="field"
              value={newEmail}
              placeholder="name@agency.gov.ph"
              onChange={(e) => setNewEmail(e.target.value)}
              required
            />
          </label>
          <div className="field">
            <label htmlFor="admin-new-account-password">Password (min 8 characters)</label>
            <PasswordInput
              id="admin-new-account-password"
              autoComplete="new-password"
              className="field"
              value={newPassword}
              placeholder="••••••••"
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>
          <label className="field">
            <span>Role</span>
            <select
              className="field"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
            >
              <option value="staff">Staff (scanner access)</option>
              <option value="admin">Admin</option>
              <option value="supervisor">Supervisor</option>
            </select>
          </label>
          <div>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={creating}
            >
              {creating ? "Creating…" : "Create account"}
            </button>
          </div>
        </form>
      </div>

      <p className="page-lead">
        Accounts you create appear below with their role. Promote, revoke, or
        delete them anytime.
      </p>

      {isEmpty && !error && (
        <div className="glass-card event-card">
          <h2>No accounts yet</h2>
          <p className="event-desc">
            Invite your first staff member in Supabase (Authentication → Users),
            then refresh this page to promote them.
          </p>
        </div>
      )}

      <ul className="event-list">
        {(profiles ?? []).map((p) => {
          const isSelf = p.id === user?.id;
          const busy = busyId === p.id;
          const confirming = confirmingId === p.id;
          const confirmingDelete = deleteConfirmId === p.id;
          const displayName = p.full_name || "(no name yet)";

          return (
            <li key={p.id} className="glass-card event-card">
              <h2>
                {displayName}
                {isSelf && " (you)"}
              </h2>
              <p className="event-meta">
                Role: {ROLE_LABELS[p.role] ?? p.role}
              </p>
              <p className="event-meta">{p.email}</p>
              {p.municipality && <p className="event-meta">Municipality: {p.municipality}
                {p.must_change_password ? " · Password change required" : ""}</p>}

              {!isSelf && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {p.role === "pending" && (
                      <button
                        type="button"
                        className="btn btn--primary btn--small"
                        disabled={busy}
                        onClick={() => applyRole(p.id, "staff")}
                      >
                        {busy ? "Working…" : "Make Staff"}
                      </button>
                    )}
                  {p.role === "staff" && !confirming && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--small"
                        disabled={busy}
                        onClick={() => setConfirmingId(p.id)}
                      >
                        Revoke access…
                      </button>
                    )}
                  {confirming && (
                    <>
                      <button
                        type="button"
                        className="btn btn--danger btn--small"
                        disabled={busy}
                        onClick={() => applyRole(p.id, "pending")}
                      >
                        {busy ? "Working…" : "Yes, revoke access"}
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--small"
                        disabled={busy}
                        onClick={() => setConfirmingId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  )}

                  {!confirmingDelete && !confirming && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      disabled={busy}
                      onClick={() => setDeleteConfirmId(p.id)}
                    >
                      Delete…
                    </button>
                  )}
                  {confirmingDelete && (
                    <>
                      <button
                        type="button"
                        className="btn btn--danger btn--small"
                        disabled={busy}
                        onClick={() => removeProfile(p)}
                      >
                        {busy ? "Working…" : "Yes, delete account"}
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--small"
                        disabled={busy}
                        onClick={() => setDeleteConfirmId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              )}

                  {confirmingDelete && (
                    <p className="field-hint">
                      Permanently removes this person&apos;s Supabase login and role
                      record. They will no longer be able to sign in.
                    </p>
                  )}

              {passwordEditId === p.id ? (
                <div className="form-stack" style={{ marginTop: 10 }}>
                  {passwordError && (
                    <p role="alert" className="alert alert--error">{passwordError}</p>
                  )}
                  <div className="field">
                    <label htmlFor={`admin-reset-password-${p.id}`}>New password (min 8 characters)</label>
                    <PasswordInput
                      id={`admin-reset-password-${p.id}`}
                      autoComplete="new-password"
                      className="field"
                      disabled={passwordBusy}
                      value={passwordValue}
                      onChange={(e) => setPasswordValue(e.target.value)}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      type="button"
                      className="btn btn--primary btn--small"
                      disabled={passwordBusy}
                      onClick={() => savePassword(p)}
                    >
                      {passwordBusy ? "Saving…" : "Save password"}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      onClick={() => {
                        setPasswordEditId(null);
                        setPasswordValue("");
                        setPasswordError(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() => {
                      setPasswordEditId(p.id);
                      setPasswordValue("");
                      setPasswordError(null);
                    }}
                  >
                    Edit password…
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
