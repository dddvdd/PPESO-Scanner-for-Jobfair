import { useEffect, useMemo, useState } from "react";
import { adminListAllEventRegistrations, adminListEventForms, adminListFormFields } from "../lib/api.js";
import { displayAnswer, registrationColumns, registrantsCsv } from "../lib/registrantsExport.js";

export default function EventRegistrants({ event }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    setPage(0);
    async function load() {
      try {
        const [registrations, forms] = await Promise.all([
          adminListAllEventRegistrations(event.id), adminListEventForms(event.id),
        ]);
        if (!registrations.ok) throw new Error(registrations.error.message);
        if (!forms.ok) throw new Error(forms.error.message);
        const fields = forms.data.length
          ? await adminListFormFields(forms.data.map(form => form.id))
          : { ok: true, data: [] };
        if (!fields.ok) throw new Error(fields.error.message);
        if (active) setData({ rows: registrations.data, fields: fields.data });
      } catch (failure) {
        if (active) setError(failure.message);
      }
    }
    load();
    return () => { active = false; };
  }, [event.id, attempt]);
  const columns = useMemo(() => data ? registrationColumns(data.fields, data.rows) : [], [data]);

  function download() {
    const url = URL.createObjectURL(new Blob([registrantsCsv(event.name, columns, data.rows)], { type: "text/csv;charset=utf-8;" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${event.name.replace(/[^a-z0-9_-]+/gi, "-") || "event"}-registrants.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section id={`registrants-${event.id}`} aria-label={`${event.name} registrants`} style={{ minWidth: 0, width: "100%" }}>
      <h3>Registrants</h3>
      {!data && !error && <p role="status">Loading registrants…</p>}
      {error && <><p role="alert" className="alert alert--error">{error}</p><button type="button" className="btn btn--small btn--ghost" onClick={() => setAttempt(value => value + 1)}>Retry</button></>}
      {data && <>
        <p role="status">{data.rows.length} registered applicant{data.rows.length === 1 ? "" : "s"}</p>
        <button type="button" className="btn btn--primary btn--small" onClick={download} disabled={!data.rows.length}>Export CSV</button>
        <p className="field-help">Exports all registrants and saved registration fields. Data Privacy Consent is not stored with registrations.</p>
        {data.rows.length === 0 ? <p>No applicants have registered for this event yet.</p> : <>
          <div role="region" aria-label="Registrant details" tabIndex={0} style={{ overflowX: "auto", maxWidth: "100%", marginTop: 16 }}>
            <table style={{ borderCollapse: "collapse", textAlign: "left", width: "100%" }}>
              <caption className="sr-only">Registered applicants for {event.name}</caption>
              <thead><tr>{columns.map(column => <th key={column.key} scope="col" style={{ padding: 10, whiteSpace: "nowrap" }}>{column.label}</th>)}</tr></thead>
              <tbody>{data.rows.slice(page * 25, (page + 1) * 25).map(row => <tr key={row.id}>{columns.map(column => <td key={column.key} style={{ padding: 10, verticalAlign: "top", minWidth: 120, overflowWrap: "anywhere" }}>{displayAnswer(column.value(row)) || "—"}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div className="link-row">
            <button type="button" className="btn btn--ghost btn--small" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</button>
            <span>Page {page + 1} of {Math.ceil(data.rows.length / 25)}</span>
            <button type="button" className="btn btn--ghost btn--small" disabled={(page + 1) * 25 >= data.rows.length} onClick={() => setPage(value => value + 1)}>Next</button>
          </div>
        </>}
      </>}
    </section>
  );
}
