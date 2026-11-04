import { Link } from "react-router-dom";

export default function Home() {
  return (
    <section className="page">
      <div className="glass-card hero-card">
        <p className="page-kicker">PPESO Job Fairs &amp; Recruitment Events</p>
        <h1 className="page-title">Registration &amp; QR Check-In</h1>
        <p className="page-lead">
          Register online for provincial job fair events, receive your QR ticket,
          and skip the line on event day.
        </p>
        <Link className="btn btn--primary" to="/events">
          View published events and register
        </Link>
      </div>
    </section>
  );
}
