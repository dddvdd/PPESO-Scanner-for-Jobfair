import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { listInterviewApplicants, saveInterviewStatus } from "../lib/api.js";
import "./InterviewStatus.css";

const STATUSES = ["Not Qualified", "Qualified", "Near Hires", "HOTS"];
const statusLabel = value => value === "HOTS" ? "Hired-On-The-Spot (HOTS)" : value;

function InterviewModal({ applicant, onClose, onSaved }) {
  const dialog = useRef(null);
  const savingRef = useRef(false);
  const [company, setCompany] = useState("");
  const [position, setPosition] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    const node = dialog.current;
    node.showModal();
    return () => node.close();
  }, []);
  async function submit(event) {
    event.preventDefault();
    if (savingRef.current) return;
    if (!company.trim() || !position.trim() || !status) {
      setError("Enter a company, position, and interview status."); return;
    }
    savingRef.current = true; setSaving(true); setError(null);
    const result = await saveInterviewStatus(applicant.registration_id, company, position, status);
    savingRef.current = false; setSaving(false);
    if (!result.ok) { setError(result.error.message); return; }
    onSaved();
  }
  return <dialog ref={dialog} className="interview-dialog" aria-labelledby="interview-modal-title" onCancel={event => { event.preventDefault(); if (!savingRef.current) onClose(); }}>
    <h2 id="interview-modal-title">Interview status</h2>
    <p><strong>{applicant.applicant_name}</strong><br />{applicant.event_name}</p>
    {applicant.interviews.length > 0 && <details>
      <summary>Your saved interviews ({applicant.interviews.length})</summary>
      {applicant.interviews.map(item => <p key={item.id}>
        <button type="button" className="btn btn--ghost btn--small" disabled={saving} onClick={() => { setCompany(item.company); setPosition(item.position); setStatus(item.status); }}>
          {item.company} · {item.position} · {statusLabel(item.status)}
        </button>
      </p>)}
    </details>}
    <form className="form-stack" onSubmit={submit}>
      <div className="field"><label htmlFor="interview-company">Company</label><input autoFocus id="interview-company" maxLength={500} required value={company} disabled={saving} onChange={e => setCompany(e.target.value)} /></div>
      <div className="field"><label htmlFor="interview-position">Position</label><input id="interview-position" maxLength={500} required value={position} disabled={saving} onChange={e => setPosition(e.target.value)} /></div>
      <div className="field"><label htmlFor="interview-status">Status</label><select id="interview-status" required value={status} disabled={saving} onChange={e => setStatus(e.target.value)}>
        <option value="">Choose a status</option>{STATUSES.map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}
      </select></div>
      <p className="field-help">Saved to your account. Saving the same company and position updates your existing record.</p>
      {error && <p role="alert" className="alert alert--error">{error}</p>}
      <div className="link-row"><button className="btn btn--primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save status"}</button><button className="btn btn--ghost" type="button" disabled={saving} onClick={onClose}>Cancel</button></div>
    </form>
  </dialog>;
}

export default function InterviewStatus() {
  const { user } = useAuth();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    let active = true;
    setRows(null); setError(null);
    listInterviewApplicants(query, page).then(result => {
      if (!active) return;
      if (result.ok) setRows(result.data ?? []); else setError(result.error.message);
    });
    return () => { active = false; };
  }, [query, page, refresh, user?.id]);
  return <section className="page interview-page">
    <Link to="/staff/scanner">Back to scanner</Link>
    <p className="page-kicker">Staff</p><h1 className="page-title">Interview Status</h1>
    <p className="page-lead">Checked-in applicants and interview records saved by {user?.email}.</p>
    <form className="interview-search" onSubmit={e => { e.preventDefault(); setPage(0); setQuery(draft.trim()); setRefresh(value => value + 1); }}>
      <div className="field"><label htmlFor="applicant-search">Search applicants by name</label><input id="applicant-search" type="search" maxLength={200} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Enter a name" /></div>
      <button type="submit" className="btn btn--primary">Search</button>
    </form>
    {notice && <p role="status" className="alert alert--info">{notice}</p>}
    {error ? <><p role="alert" className="alert alert--error">{error}</p><button type="button" className="btn btn--ghost" onClick={() => setRefresh(value => value + 1)}>Retry</button></> : rows === null ? <p role="status">Loading checked-in applicants…</p> : rows.length === 0 ? <p role="status">{query ? "No checked-in applicants match that name." : "No applicants have checked in yet."}</p> : <>
      <div className="glass-card interview-table" role="region" aria-label="Checked-in applicants" tabIndex={0}><table>
        <thead><tr><th scope="col">Applicant</th><th scope="col">Event</th><th scope="col">Your interview records</th><th scope="col">Action</th></tr></thead>
        <tbody>{rows.slice(0, 25).map(row => <tr key={row.registration_id}>
          <td><strong>{row.applicant_name}</strong><br /><small>{row.registration_number}</small></td>
          <td>{row.event_name}</td>
          <td>{row.interviews.length ? row.interviews.map(item => <p key={item.id}>{item.company} · {item.position}<br /><strong>{statusLabel(item.status)}</strong></p>) : "Not recorded"}</td>
          <td><button type="button" className="btn btn--ghost btn--small" onClick={() => { setNotice(null); setSelected(row); }}>Interview status<span className="interview-sr-only"> for {row.applicant_name}</span></button></td>
        </tr>)}</tbody>
      </table></div>
    </>}
    <div className="link-row"><button type="button" className="btn btn--ghost btn--small" disabled={!page || !rows} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page + 1}</span><button type="button" className="btn btn--ghost btn--small" disabled={!rows || rows.length <= 25} onClick={() => setPage(value => value + 1)}>Next</button></div>
    {selected && <InterviewModal key={selected.registration_id} applicant={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); setNotice("Interview status saved."); setRefresh(value => value + 1); }} />}
  </section>;
}
