import { useEffect, useRef, useState } from "react";

/**
 * Bottom-right safety toast after a destructive action. Shows a countdown;
 * tapping Undo hands control back to the caller (which re-inserts the
 * deleted rows). When the countdown ends the deletion becomes permanent.
 */
export default function UndoToast({ undo, onUndo, onExpire }) {
  const [secondsLeft, setSecondsLeft] = useState(undo.seconds);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    setSecondsLeft(undo.seconds);
    const timer = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timer);
          expireRef.current();
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [undo.id, undo.seconds]);

  return (
    <div className="undo-toast" role="status" aria-live="polite">
      <p className="undo-toast-label">{undo.label}</p>
      <div className="undo-toast-actions">
        <button type="button" className="btn btn--primary btn--small" onClick={() => onUndo(undo)}>
          Undo
        </button>
        <span className="undo-toast-count">{Math.max(secondsLeft, 0)}s</span>
      </div>
    </div>
  );
}
