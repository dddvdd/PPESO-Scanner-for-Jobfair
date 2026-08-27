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
  const [svg, setSvg] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!value) return undefined;
    let alive = true;
    setFailed(false);
    QRCode.toString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
      .then((markup) => {
        if (alive) {
          setSvg(
            typeof markup === "string"
              ? markup.replace("<svg ", `<svg width="${size}" height="${size}" `)
              : null
          );
        }
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
  if (!svg) {
    return <p className="qr-status">Preparing QR…</p>;
  }
  return (
    <div
      role="img"
      aria-label="Ticket QR code"
      style={{ lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
