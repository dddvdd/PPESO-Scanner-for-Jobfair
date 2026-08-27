import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  adminCreateEvent,
  adminCreateForm,
  adminCreateUser,
  adminDeleteEvent,
  adminDeleteProfile,
  adminListEvents,
  adminListEventForms,
  adminListFormFields,
  adminListProfiles,
  adminListRegistrations,
  adminRestoreEvent,
  adminRestoreFormFields,
  adminRestoreForms,
  adminRestoreProfile,
  adminUpdateEvent,
  adminUpdateProfileRole,
} from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import UndoToast from "../components/UndoToast.jsx";

const ROLE_LABELS = { admin: "Admin", staff: "Staff", supervisor: "Supervisor", pending: "Pending" };

const TABS = [
  { id: "events", label: "Events" },
  { id: "staff", label: "Staff roles" },
];

const BLANK_DRAFT = { name: "", description: "", event_date: "", location: "" };

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
  const tab = searchParams.get("tab") === "staff" ? "staff" : "events";
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
    <section className="page">
      <p className="page-kicker">Admin</p>
      <h1 className="page-title">Event &amp; staff administration</h1>

      <div
        className="link-row"
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
  const [error, setError] = useState(null);
  const [notice, flash] = useFlash();
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null); // event row being edited
  const [draft, setDraft] = useState(BLANK_DRAFT);
  const [draftError, setDraftError] = useState(null);
  const [busyEventId, setBusyEventId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  async function reload() {
    const result = await adminListEvents();
    if (result.ok) {
      setEvents(result.data ?? []);
      setError(null);
    } else {
      setError(result.error.message);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCreate() {
    setEditing(null);
    setDraft(BLANK_DRAFT);
    setDraftError(null);
    setShowForm(true);
  }

  function openEdit(ev) {
    setEditing(ev);
    setDraft({
      name: ev.name ?? "",
      description: ev.description ?? "",
      event_date: ev.event_date ?? "",
      location: ev.location ?? "",
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
    if (!draft.name.trim()) {
      setDraftError("Event name is required.");
      return;
    }
    setSaving(true);
    setDraftError(null);

    const fields = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      event_date: draft.event_date || null,
      location: draft.location.trim() || null,
    };

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
    let fields = [];
    if (forms.length > 0) {
      const fieldsSnap = await adminListFormFields(forms.map((f) => f.id));
      fields = fieldsSnap.ok ? fieldsSnap.data ?? [] : [];
    }

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
        const restoredEvent = await adminRestoreEvent(ev);
        if (!restoredEvent.ok) return restoredEvent.error.message;
        if (forms.length > 0) {
          const restoredForms = await adminRestoreForms(forms);
          if (!restoredForms.ok) return `event restored, but its registration form(s) did not: ${restoredForms.error.message}`;
        }
        if (fields.length > 0) {
          const restoredFields = await adminRestoreFormFields(fields);
          if (!restoredFields.ok) return `event and form restored, but their questions did not: ${restoredFields.error.message}`;
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

      {!showForm && !isEmpty && (
        <button type="button" className="btn btn--primary btn--block" onClick={openCreate}>
          + New event
        </button>
      )}

      {showForm && (
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
                value={draft.name}
                disabled={saving}
                aria-invalid={draftError && !draft.name.trim() ? true : undefined}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="ev-date">Date</label>
              <input
                id="ev-date"
                type="date"
                value={draft.event_date}
                disabled={saving}
                onChange={(e) => setDraft((d) => ({ ...d, event_date: e.target.value }))}
              />
            </div>
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
                A blank registration form is created automatically — jobseekers can
                register as soon as the event is published.
              </p>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" className="btn btn--primary btn--block" disabled={saving}>
                {saving ? "Saving…" : editing ? "Save changes" : "Create event"}
              </button>
              <button type="button" className="btn btn--ghost" disabled={saving} onClick={closeForm}>
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {isEmpty && !showForm && !error && (
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

      <ul className="event-list">
        {(events ?? []).map((ev) => {
          const busy = busyEventId === ev.id;
          const confirmingDelete = deletingId === ev.id;

          return (
            <li key={ev.id} className="glass-card event-card">
              <h2>{ev.name}</h2>
              <p className="event-meta">
                {ev.event_date ?? "No date"}
                {ev.location ? ` · ${ev.location}` : ""}
              </p>
              <span
                className={`chip ${ev.status === "published" ? "" : "chip--muted"}`}
                aria-label={`Status: ${ev.status}`}
              >
                <span className="chip-dot" aria-hidden="true" />
                {ev.status}
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
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
                      disabled={busy}
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
            </li>
          );
        })}
      </ul>
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

  async function removeProfile(profile) {
    setBusyId(profile.id);
    setError(null);

    const result = await adminDeleteProfile(profile.id);
    setBusyId(null);
    setDeleteConfirmId(null);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }

    const displayName = profile.full_name || "(no name yet)";
    flash(`"${displayName}" was removed from this workspace.`);
    reload();

    pushUndo({
      id: `${profile.id}-${Date.now()}`,
      label: `"${displayName}" deleted.`,
      seconds: 8,
      afterMessage: `"${displayName}" was restored.`,
      run: async () => {
        // Re-insert the exact profile row (same id, role, timestamps). The
        // auth user was never touched, so this fully restores the account.
        const restored = await adminRestoreProfile({
          id: profile.id,
          full_name: profile.full_name ?? null,
          role: profile.role,
          created_at: profile.created_at,
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
          <label className="field">
            <span>Password (min 8 characters)</span>
            <input
              type="text"
              className="field"
              value={newPassword}
              placeholder="••••••••"
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </label>
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
                  Removes this person&apos;s role record here so they lose all
                  access. Their Supabase login email stays until you delete it
                  in Authentication → Users.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
