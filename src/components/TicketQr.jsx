import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Renders the ticket bearer token as a QR code. The payload is exactly the
 * raw 48-character lowercase hex token — never transformed, never wrapped in
 * URLs or JSON (scanner passes the decoded string straight to
 * perform_check_in).
 *
 * SVG rendering keeps this canvas-free; the markup comes verbatim from the
 * qrcode library (no user-controlled content) and is injected as-is.
 */
export default function TicketQr({ value, size = 176 }) {
  const [dataUrl, setDataUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!value) return undefined;
    let alive = true;
    setFailed(false);
    QRCode.toDataURL(value, { margin: 1, errorCorrectionLevel: "M", width: size })
      .then((url) => {
        if (alive) setDataUrl(url);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [value, size]);

  if (!value || failed) {
    return <p className="qr-status">QR preview unavailable.</p>;
  }
  if (!dataUrl) {
    return <p className="qr-status">Preparing QR…</p>;
  }
  return (
    <img
      src={dataUrl}
      alt="Ticket QR code"
      width={size}
      height={size}
      className="ticket-qr-img"
      style={{ display: "block", margin: "0 auto" }}
    />
  );
}

