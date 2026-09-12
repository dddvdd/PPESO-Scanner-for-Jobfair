import { useCallback, useEffect, useRef, useState } from "react";
import { adminRecordLateCheckIn, performCheckIn, staffLookup } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { describeScanOutcome, getDeviceId, isValidTicketToken } from "../lib/scannerUtils.js";
import "./StaffScanner.css";

const READER_ELEMENT_ID = "qr-reader-region";

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 5v14M15 5v14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5L8 5.5z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l9 16H3L12 3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 10v4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1.1" fill="currentColor" />
    </svg>
  );
}

/**
 * Mobile-first staff check-in console.
 *
 * Camera lifecycle: exactly one html5-qrcode instance per mounted page.
 * A successful decode pauses the preview (frame stays visible behind the
 * result card) instead of killing the stream — "Scan Again" resumes it.
 * Unmount/route change always fully stops and clears the instance.
 *
 * Test hook: window.dispatchEvent(new CustomEvent("peso-simulate-scan",
 * { detail: { text, force } })) feeds a decoded string through the exact
 * production pipeline. Inert in normal operation.
 */
export default function StaffScanner() {
  const { signOut, user, isAdmin } = useAuth();
  const signedInEmail = typeof user?.email === "string" ? user.email : "";
  const [cameraState, setCameraState] = useState("initializing"); // initializing | active | paused | permission | unavailable | insecure
  const [scanOutcome, setScanOutcome] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchHasRun, setSearchHasRun] = useState(false);
  const [checkingInToken, setCheckingInToken] = useState(null);
  const searchDebounceRef = useRef(null);
  const searchRequestRef = useRef(0);
  const confirmedCheckInsRef = useRef(new Map());
  const [manualOutcome, setManualOutcome] = useState(null);
  const [lateEntry, setLateEntry] = useState(null);
  const [lateReason, setLateReason] = useState("");

  const runSearch = useCallback(async (queryText = "") => {
    const trimmed = typeof queryText === "string" ? queryText.trim() : "";
    const requestId = ++searchRequestRef.current;
    setIsSearching(true);
    try {
      const res = await staffLookup(trimmed);
      if (requestId !== searchRequestRef.current) return;
      if (res.ok) {
        setSearchResults((res.data?.results ?? []).map((row) => ({
          ...row,
          ...(confirmedCheckInsRef.current.get(row.registrationNumber) ?? {}),
        })));
      } else {
        setSearchResults([]);
      }
    } finally {
      if (requestId === searchRequestRef.current) {
        setIsSearching(false);
        setSearchHasRun(true);
      }
    }
  }, []);

  useEffect(() => {
    runSearch("");
    return () => {
      clearTimeout(searchDebounceRef.current);
      searchRequestRef.current += 1;
    };
  }, [runSearch]);

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    searchRequestRef.current += 1;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      runSearch(val);
    }, 300);
  };

  function recordCheckIn(result) {
    const data = result.ok ? result.data : null;
    if (!data || !["success", "already_checked_in"].includes(data.status) || !data.checkedInAt) return;
    const confirmed = { checkedInAt: data.checkedInAt,
      ...(data.attendanceDate ? { attendanceDate: data.attendanceDate, isLateCheckIn: true } : {}) };
    confirmedCheckInsRef.current.set(data.registrationNumber, confirmed);
    setSearchResults((rows) => rows.map((row) =>
      row.registrationNumber === data.registrationNumber
        ? { ...row, ...confirmed }
        : row
    ));
  }

  const handleManualCheckIn = async (item, late = false) => {
    if (late && (!isAdmin || !lateReason.trim())) return;
    if (processingRef.current || (!late && !item.ticketToken) || item.checkedInAt) return;
    processingRef.current = true;
    setCheckingInToken(item.ticketToken);
    setProcessing(true);
    setManualOutcome(null);
    try {
      const result = late
        ? await adminRecordLateCheckIn(item.registrationNumber, lateReason, deviceIdentifierRef.current)
        : await performCheckIn(item.ticketToken, deviceIdentifierRef.current);
      const outcome = describeScanOutcome(result);
      setManualOutcome({ registrationNumber: item.registrationNumber, ...outcome });
      recordCheckIn(result);
      if (result.ok && result.data?.status === "event_past" && isAdmin) {
        setLateEntry(item);
        setLateReason("");
        setManualOutcome(null);
      } else if (late && result.ok && ["success", "already_checked_in"].includes(result.data?.status)) {
        setLateEntry(null);
        setLateReason("");
      }
    } finally {
      processingRef.current = false;
      setCheckingInToken(null);
      setProcessing(false);
    }
  };

  const scannerRef = useRef(null);
  const startingRef = useRef(false);
  const processingRef = useRef(false);
  const resultActiveRef = useRef(false);
  const deviceIdentifierRef = useRef(getDeviceId());

  function safeStopCameraInstance(instance) {
    if (!instance) return;
    try {
      const stopped = instance.stop();
      if (stopped && typeof stopped.then === "function") {
        stopped
          .then(() => {
            try {
              instance.clear();
            } catch {
              /* ignore */
            }
          })
          .catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }

  const startCamera = useCallback(async () => {
    if (startingRef.current || scannerRef.current) return;
    startingRef.current = true;
    try {
      if (!window.isSecureContext) {
        setCameraState("insecure");
        return;
      }
      const { Html5Qrcode } = await import("html5-qrcode");

      // Clear any leftover video/canvas from a previous (failed) instance so a
      // retry doesn't fail with "element already has a child".
      const region = document.getElementById(READER_ELEMENT_ID);
      if (region) region.innerHTML = "";

      const instance = new Html5Qrcode(READER_ELEMENT_ID);
      scannerRef.current = instance;

      // Same start strategy as the proven .basis/scanner.html, hardened with
      // extra fallbacks so "Scan Again" reliably relaunches the camera:
      //   1) rear-facing preference,
      //   2) explicit rear camera by device id (exact, then loose),
      //   3) any enumerated camera,
      // with a watchdog so a hung start degrades gracefully.
      const withTimeout = (promise) =>
        Promise.race([
          promise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("camera-start-timeout")), 15000)
          ),
        ]);
      const config = { fps: 10, qrbox: 250 };
      const onDecode = (decodedText) => handleDecodedText(decodedText);

      let devices = [];
      try {
        devices = (await Html5Qrcode.getCameras()) ?? [];
      } catch {
        devices = [];
      }
      const backCam =
        devices.find((d) => /back|rear|environment/i.test(d.label)) ??
        devices[devices.length - 1] ??
        null;

      const attempts = [{ facingMode: "environment" }];
      if (backCam) {
        attempts.push({ deviceId: { exact: backCam.id } });
        attempts.push({ deviceId: backCam.id });
      }
      if (devices[0]) attempts.push({ deviceId: devices[0].id });
      if (!attempts.some((a) => a.facingMode)) {
        attempts.push({ facingMode: "user" });
      }

      let lastError;
      for (const constraint of attempts) {
        try {
          await withTimeout(
            instance.start(constraint, config, onDecode, () => {})
          );
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
        }
      }
      if (lastError) throw lastError;

      setCameraState("active");
    } catch (err) {
      const failedInstance = scannerRef.current;
      scannerRef.current = null;
      safeStopCameraInstance(failedInstance);
      // html5-qrcode sometimes rejects with a bare string instead of an Error.
      const normalized = typeof err === "string" ? { message: err } : (err ?? {});
      const name = String(normalized.name ?? "");
      const message = String(normalized.message ?? "");
      if (/camera-start-timeout/.test(message)) {
        setCameraState("unavailable");
      } else if (name === "NotAllowedError" || /permission|not allowed|denied/i.test(message)) {
        setCameraState("permission");
      } else {
        setCameraState("unavailable");
      }
    } finally {
      startingRef.current = false;
    }
  }, []);

  const pauseScanning = useCallback(async () => {
    const instance = scannerRef.current;
    if (!instance) return;
    try {
      instance.pause(true);
    } catch {
      /* ignore */
    }
    setCameraState((prev) => (prev === "active" ? "paused" : prev));
  }, []);

  const resumeScanning = useCallback(() => {
    const instance = scannerRef.current;
    if (!instance) {
      setCameraState("unavailable");
      return;
    }
    try {
      instance.resume();
      setCameraState("active");
    } catch {
      setCameraState("unavailable");
    }
  }, []);

  const handleDecodedText = useCallback(
    async (decodedText) => {
      // One decode = at most one RPC. While a request is in flight, or while
      // a result is on screen awaiting "Scan Again", every frame is dropped.
      if (processingRef.current || resultActiveRef.current) return;

      if (!isValidTicketToken(decodedText)) {
        processingRef.current = true;
        await pauseScanning();
        resultActiveRef.current = true;
        setScanOutcome({
          tone: "invalid",
          title: "Unrecognized QR code",
          detail: "This is not a valid ticket code. Scan the QR printed on an attendee ticket.",
        });
        processingRef.current = false;
        return;
      }

      processingRef.current = true;
      setProcessing(true);
      await pauseScanning();

      try {
        window.__pesoScanTrace?.push("rpc:start");
        const result = await performCheckIn(decodedText, deviceIdentifierRef.current);
        window.__pesoScanTrace?.push(
          `rpc:done:${result.ok ? result.data?.status : `err:${result.error?.kind}`}`
        );
        resultActiveRef.current = true;
        const outcome = describeScanOutcome(result);
        setScanOutcome(outcome);
        if (result.ok && result.data?.status === "event_past" && isAdmin) {
          setLateEntry({
            registrationNumber: result.data.registrationNumber,
            applicantName: result.data.applicantName,
            ticketToken: decodedText,
            eventName: result.data.eventName,
            eventDate: result.data.eventDate,
          });
          setLateReason("");
        }
      } finally {
        processingRef.current = false;
        setProcessing(false);
      }
    },
    [pauseScanning]
  );

  useEffect(() => {
    startCamera();
    return () => {
      const instance = scannerRef.current;
      scannerRef.current = null;
      safeStopCameraInstance(instance);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const simulate = (event) => {
      const detail = event.detail ?? {};
      const trace = (window.__pesoScanTrace = window.__pesoScanTrace ?? []);
      trace.push(`received:len=${typeof detail.text === "string" ? detail.text.length : -1},force=${!!detail.force}`);
      if (detail.force) {
        resultActiveRef.current = false;
        setScanOutcome(null);
      }
      if (typeof detail.text !== "string") return;
      handleDecodedText(detail.text);
      trace.push("dispatch:returned");
    };
    window.addEventListener("peso-simulate-scan", simulate);
    return () => window.removeEventListener("peso-simulate-scan", simulate);
  }, [handleDecodedText]);

  const scanAgain = useCallback(() => {
    resultActiveRef.current = false;
    setScanOutcome(null);
    // Always relaunch from a clean state. A paused/broken instance (or a
    // leftover stream) can otherwise refuse to resume and fall back to the
    // "Camera unavailable" notice — tearing down first makes Scan Again
    // reliably restart the camera.
    const existing = scannerRef.current;
    scannerRef.current = null;
    safeStopCameraInstance(existing);
    startCamera();
  }, [startCamera]);

  // ---------------------------------------------------------------- rendering
  const toneClass =
    scanOutcome?.tone === "success"
      ? "sc-result--success"
      : scanOutcome?.tone === "duplicate"
        ? "sc-result--duplicate"
        : scanOutcome?.tone === "invalid" || scanOutcome?.tone === "forbidden"
          ? "sc-result--danger"
          : "sc-result--danger";

  const pillLabel =
    processing ? "BUSY" : cameraState === "active" ? "LIVE" : cameraState === "paused" ? "PAUSED" : cameraState === "initializing" ? "STARTING" : "CAMERA OFF";
  const pillDot =
    processing ? "sc-dot sc-dot--busy" : cameraState === "active" ? "sc-dot sc-dot--live" : "sc-dot";

  const viewfinderState =
    cameraState === "active" && !scanOutcome && !processing ? "live" : "idle";

  const notice =
    cameraState === "insecure"
      ? {
          variant: "warn",
          title: "Secure connection required",
          detail:
            "The camera can only be used over HTTPS (or on localhost during development). Open this page using an https:// address and reload.",
        }
      : cameraState === "permission"
        ? {
            variant: "warn",
            title: "Camera access is required to scan tickets.",
            detail:
              "Allow camera access for this site in your browser settings, then tap Scan Again. On most phones: tap the padlock icon in the address bar → Permissions → Camera → Allow.",
          }
        : cameraState === "unavailable"
          ? {
              variant: "danger",
              title: "Camera unavailable",
              detail:
                "No usable camera was found on this device. Check that another app isn't using it, or switch devices.",
            }
          : null;

  const outcomeMeta = [];
  if (scanOutcome?.applicantName) {
    outcomeMeta.push(["Applicant", scanOutcome.applicantName]);
  }
  if (scanOutcome?.registrationNumber) {
    outcomeMeta.push(["Registration no.", scanOutcome.registrationNumber]);
  }
  if ((scanOutcome?.tone === "success" || scanOutcome?.tone === "duplicate") && scanOutcome.checkedInAt) {
    outcomeMeta.push([
      "Checked in at",
      new Date(scanOutcome.checkedInAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    ]);
  }

  // Current date formatting for station date check
  const todayDateFormatted = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const todayIsoDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  return (
    <div className="sc-page">
      <span className="sc-orb sc-orb--indigo" aria-hidden="true" />
      <span className="sc-orb sc-orb--cyan" aria-hidden="true" />
      <span className="sc-orb sc-orb--pink" aria-hidden="true" />

      <div className="sc-shell">
        <div className="sc-topbar">
          <div className="sc-header-left">
            <div>
              <p className="sc-kicker">
                Today: {todayDateFormatted}{signedInEmail ? ` · ${signedInEmail}` : ""}
              </p>
              <h1 className="sc-title">Staff Check-In</h1>
            </div>
          </div>
          <span className="sc-pill">
            <span className={pillDot} aria-hidden="true" />
            {pillLabel}
          </span>
        </div>

        {notice ? (
          <div className={`sc-notice sc-notice--${notice.variant}`} role="alert">
            <span className="sc-notice-icon">
              {notice.variant === "danger" ? <AlertIcon /> : <AlertIcon />}
            </span>
            <span>
              <span className="sc-notice-title">{notice.title}</span>
              <span className="sc-notice-detail" style={{ display: "block" }}>{notice.detail}</span>
            </span>
          </div>
        ) : (
          <div className="sc-viewfinder" data-state={viewfinderState}>
            <div id={READER_ELEMENT_ID} className="sc-reader" />
            <span className="sc-frame" aria-hidden="true">
              <span className="sc-corner sc-corner--tl" />
              <span className="sc-corner sc-corner--tr" />
              <span className="sc-corner sc-corner--bl" />
              <span className="sc-corner sc-corner--br" />
              <span className="sc-laser" />
            </span>

            {(cameraState === "active" || cameraState === "paused") && (
              <button
                type="button"
                className="sc-shutter"
                onClick={() => (cameraState === "active" ? pauseScanning() : resumeScanning())}
                aria-label={cameraState === "active" ? "Pause camera" : "Resume camera"}
              >
                {cameraState === "active" ? <PauseIcon /> : <PlayIcon />}
              </button>
            )}

            {processing && (
              <div className="sc-processing" role="status">
                <span className="sc-spinner" aria-hidden="true" />
                <p>Recording check-in…</p>
              </div>
            )}

            {!processing && cameraState === "paused" && !scanOutcome && (
              <button type="button" className="sc-resume-btn" style={{ position: "absolute", inset: 0, margin: "auto", width: "fit-content", height: "fit-content" }} onClick={resumeScanning}>
                <PlayIcon /> Resume
              </button>
            )}
          </div>
        )}

        {!notice && !scanOutcome && !processing && (
          <p className="sc-hint">Scan a participant&apos;s ticket QR code</p>
        )}

        {scanOutcome && (
          <div className={`sc-result ${toneClass}`} role="alert">
            <span className="sc-result-icon">
              {scanOutcome.tone === "success" ? <CheckIcon /> : <AlertIcon />}
            </span>
            <div>
              <p className="sc-result-title">{scanOutcome.title}</p>
              {outcomeMeta.length > 0 && (
                <div className="sc-meta">
                  {outcomeMeta.map(([label, value]) => (
                    <div className="sc-meta-row" key={label}>
                      <span className="sc-meta-label">{label}</span>
                      <span className="sc-meta-value">{value}</span>
                    </div>
                  ))}
                </div>
              )}
              {scanOutcome.detail && <p className="sc-result-detail">{scanOutcome.detail}</p>}
            </div>
          </div>
        )}

        <div className="sc-actions">
          <button type="button" className="sc-btn sc-btn--primary" disabled={processing} onClick={scanAgain}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ marginRight: 8 }}>
              <path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <rect x="8" y="8" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
            </svg>
            Scan Again
          </button>
        </div>

        {isAdmin && lateEntry && (
          <form className="sc-search-section" onSubmit={(event) => { event.preventDefault(); handleManualCheckIn(lateEntry, true); }}>
            <h2 className="sc-search-title">Record late check-in</h2>
            <p>Confirm {lateEntry.applicantName} ({lateEntry.registrationNumber}) attended {lateEntry.eventName || "the event"} on {lateEntry.eventDate}.</p>
            <p>The attendance date, your admin account, today's recording time, and reason will be saved.</p>
            <label htmlFor="late-check-in-reason">Reason / attendance evidence</label>
            <textarea id="late-check-in-reason" className="sc-search-input" autoFocus required maxLength={1000}
              value={lateReason} onChange={(event) => setLateReason(event.target.value)} disabled={processing} />
            <button className="sc-btn sc-btn--primary" type="submit" disabled={processing || !lateReason.trim()}>
              {processing ? "Recording..." : "Confirm attendance and record"}
            </button>
            <button className="sc-btn sc-btn--ghost" type="button" disabled={processing} onClick={() => setLateEntry(null)}>Cancel</button>
          </form>
        )}

        <div className="sc-search-section">
          <div className="sc-search-header">
            <h2 className="sc-search-title">
              {searchQuery.trim() ? "Search Results" : "Registrants & Check-ins"}
            </h2>
            <span className="sc-search-subtitle">
              {searchQuery.trim()
                ? "Filter matching registrants"
                : "Recent registrants and checked-in attendees"}
            </span>
          </div>

          <div className="sc-search-box">
            <input
              type="search"
              className="sc-search-input"
              placeholder="Search all registrants by name..."
              value={searchQuery}
              onChange={handleSearchChange}
              autoComplete="off"
            />
            {isSearching && <span className="sc-search-spinner" aria-hidden="true" />}
          </div>

          {searchHasRun && searchResults.length === 0 && (
            <div className="sc-search-empty">
              {searchQuery.trim()
                ? `No registrants found matching "${searchQuery}"`
                : "No registrants found yet."}
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="sc-search-list">
              {searchResults.map((item, idx) => {
                const isCheckedIn = Boolean(item.checkedInAt);
                const isRowBusy = checkingInToken !== null && checkingInToken === item.ticketToken;
                const isDifferentDate = Boolean(item.eventDate && item.eventDate !== todayIsoDate);
                const isPastEvent = Boolean(item.eventDate && item.eventDate < todayIsoDate);
                const isFutureEvent = Boolean(item.eventDate && item.eventDate > todayIsoDate);

                return (
                  <div key={item.registrationNumber || item.email || idx} className="sc-registrant-row">
                    <div className="sc-registrant-info">
                      <span className="sc-registrant-name">{item.applicantName || "Applicant"}</span>
                      <span className="sc-registrant-sub">
                        {item.registrationNumber ? `${item.registrationNumber} · ` : ""}
                        {item.email || ""}
                      </span>
                      {isCheckedIn ? (
                        <span className="sc-registrant-status sc-registrant-status--checkedin">
                          {item.isLateCheckIn ? "Recorded at" : "✓ Checked in at"}{" "}
                          {new Date(item.checkedInAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      ) : isPastEvent ? (
                        <span className="sc-registrant-status sc-registrant-status--mismatch">
                          ⚠️ Event date ({item.eventDate}) already passed
                        </span>
                      ) : isFutureEvent ? (
                        <span className="sc-registrant-status sc-registrant-status--mismatch">
                          ⚠️ Event date ({item.eventDate}) — early check-in
                        </span>
                      ) : (
                        <span className="sc-registrant-status sc-registrant-status--pending">Not checked in</span>
                      )}
                      {item.isLateCheckIn && (
                        <span className="sc-registrant-status">Attendance: {item.attendanceDate} — {item.entrySource === "post_event_walk_in" ? "Post-event walk-in" : "Recorded late by admin"}</span>
                      )}
                      {manualOutcome?.registrationNumber === item.registrationNumber && (
                        <p className="sc-registrant-status" role="status">
                          {manualOutcome.title}
                          {manualOutcome.detail ? ` ${manualOutcome.detail}` : ""}
                        </p>
                      )}
                    </div>
                    <div className="sc-registrant-action">
                      {isCheckedIn ? (
                        <button type="button" className="sc-row-btn sc-row-btn--done" disabled>
                          Checked In
                        </button>
                      ) : isPastEvent && isAdmin ? (
                        <button type="button" className="sc-row-btn sc-row-btn--checkin"
                          disabled={processing} onClick={() => { setLateEntry(item); setLateReason(""); }}>
                          Record late check-in
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="sc-row-btn sc-row-btn--checkin"
                          disabled={isRowBusy || processing || !item.ticketToken}
                          onClick={() => handleManualCheckIn(item)}
                        >
                          {isRowBusy ? "Checking In…" : "Check In"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
