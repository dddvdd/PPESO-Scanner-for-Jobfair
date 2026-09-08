import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { adminGetEvent, adminListEvents, adminImportVacancies, adminListVacancies } from "../lib/api.js";
import { parseVacanciesCsv, VACANCY_HEADERS } from "../lib/vacanciesCsv.js";

function VacancyTable({ rows, label }) {
  return <div role="region" aria-label={label} tabIndex={0} style={{ overflowX: "auto" }}>
    <table style={{ width: "100%", textAlign: "left", borderCollapse: "collapse" }}>
      <caption className="sr-only">{label}</caption>
      <thead><tr>{VACANCY_HEADERS.map(header => <th key={header} scope="col" style={{ padding: 12 }}>{header}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        {[row.company_name, row.vacancy_title, row.number_of_vacancies].map((value, index) => <td key={index} style={{ padding: 12, minWidth: 120, overflowWrap: "anywhere" }}>{value}</td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

export default function VacanciesPage() {
  const { eventId } = useParams();
  return <VacanciesSelection key={eventId ?? "picker"} eventId={eventId} />;
}

function VacanciesSelection({ eventId }) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setResult(null);
    (eventId ? adminGetEvent(eventId) : adminListEvents()).then(value => {
      if (active) setResult(value);
    });
    return () => { active = false; };
  }, [eventId, attempt]);
  if (eventId && result?.ok && result.data) return <EventVacancies event={result.data} />;
  return <section className="page">
    <Link to="/admin">Back to administration</Link>
    <h1 className="page-title">Vacancies</h1>
    {!result ? <p role="status">Loading events…</p> : !result.ok ? <>
      <p role="alert" className="alert alert--error">{result.error.message}</p>
      <button className="btn btn--ghost" type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button>
    </> : eventId ? <p>Event not found.</p> : <>
      <p className="page-lead">Choose an event to upload and view its vacancies.</p>
      {!result.data.length && <p>No events yet. Create an event in administration first.</p>}
      <ul className="event-list">{result.data.map(event => <li key={event.id} className="glass-card event-card">
        <h2>{event.name}</h2>
        <p className="event-meta">{event.event_date ?? "No date"}</p>
        <Link className="btn btn--primary btn--small" to={`/admin/vacancies/${event.id}`}>Manage vacancies</Link>
      </li>)}</ul>
    </>}
  </section>;
}

function EventVacancies({ event }) {
  const [rows, setRows] = useState(null);
  const [listError, setListError] = useState(null);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [preview, setPreview] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef(null);
  const readVersion = useRef(0);

  useEffect(() => {
    let active = true;
    setRows(null);
    setListError(null);
    adminListVacancies(event.id, page).then(result => {
      if (!active) return;
      if (result.ok) setRows(result.data ?? []);
      else setListError(result.error.message);
    });
    return () => { active = false; };
  }, [event.id, page, refresh]);

  async function chooseFile(event) {
    const version = ++readVersion.current;
    const file = event.target.files?.[0];
    setPreview(null); setUploadError(null); setNotice(null); setReading(false);
    if (!file) return;
    setReading(true);
    try {
      if (!/\.csv$/i.test(file.name)) throw new Error("Choose a .csv file.");
      if (file.size > 5 * 1024 * 1024) throw new Error("Choose a CSV smaller than 5 MB.");
      const parsed = parseVacanciesCsv(await file.text());
      if (version === readVersion.current) setPreview(parsed.map(row => ({ ...row, id: crypto.randomUUID() })));
    } catch (error) {
      if (version === readVersion.current) setUploadError(error.message);
    } finally {
      if (version === readVersion.current) setReading(false);
    }
  }

  async function importRows() {
    if (!preview || saving) return;
    setSaving(true); setUploadError(null); setNotice(null);
    const result = await adminImportVacancies(event.id, preview);
    setSaving(false);
    if (!result.ok) { setUploadError(result.error.message); return; }
    setNotice(`${preview.length} vacancy row${preview.length === 1 ? "" : "s"} imported successfully.`);
    setPreview(null);
    fileInput.current.value = "";
    setPage(0); setRefresh(value => value + 1);
  }

  return <section className="page" style={{ maxWidth: 1100 }}>
    <Link className="btn btn--ghost btn--small" style={{ alignSelf: "flex-start" }} to="/admin">Back to administration</Link>
    <p className="page-kicker">Admin</p>
    <h1 className="page-title">Vacancies</h1>
    <h2 className="section-heading">{event.name}</h2>
    <Link to="/admin/vacancies">Choose another event</Link>
    <p className="page-lead">Upload company vacancies from a CSV file.</p>
    <section className="glass-card" style={{ minWidth: 0 }} aria-labelledby="upload-heading">
      <h2 id="upload-heading" className="section-heading">Upload vacancies</h2>
      <p>Required columns: {VACANCY_HEADERS.join(", ")}.</p>
      <p className="field-help">Blank or null Number of Vacancies values are imported as 1.</p>
      <p className="field-help">Up to 5,000 rows, 5 MB. Each upload adds vacancies only to {event.name}.</p>
      <label htmlFor="vacancies-csv">CSV file</label>
      <input ref={fileInput} id="vacancies-csv" type="file" accept=".csv,text/csv" onChange={chooseFile} disabled={saving} style={{ maxWidth: "100%" }} />
      {reading && <p role="status">Reading CSV…</p>}
      {uploadError && <p role="alert" className="alert alert--error">{uploadError}</p>}
      {notice && <p role="status" className="alert alert--info">{notice}</p>}
      {preview && <>
        <h3>Import preview</h3>
        <p>{preview.length} vacancy rows ready to import. {preview.length > 10 ? "Showing the first 10 rows." : ""}</p>
        <VacancyTable rows={preview.slice(0, 10)} label="CSV preview" />
        <button type="button" className="btn btn--primary" disabled={saving} onClick={importRows}>{saving ? "Importing…" : "Import vacancies"}</button>
      </>}
    </section>
    <section className="glass-card" style={{ minWidth: 0 }} aria-labelledby="saved-heading">
      <h2 id="saved-heading" className="section-heading">Saved vacancies</h2>
      {listError ? <><p role="alert" className="alert alert--error">{listError}</p><button type="button" className="btn btn--ghost btn--small" onClick={() => setRefresh(value => value + 1)}>Retry loading</button></> : rows === null ? <p role="status">Loading vacancies…</p> : rows.length ? <VacancyTable rows={rows.slice(0, 25)} label="Saved vacancies" /> : <p>No vacancies found.</p>}
      <div className="link-row">
        <button type="button" className="btn btn--ghost btn--small" disabled={!page || rows === null} onClick={() => setPage(value => value - 1)}>Previous</button>
        <span>Page {page + 1}</span>
        <button type="button" className="btn btn--ghost btn--small" disabled={!rows || rows.length <= 25} onClick={() => setPage(value => value + 1)}>Next</button>
      </div>
    </section>
  </section>;
}
