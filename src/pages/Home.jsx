import { Link } from "react-router-dom";

export default function Home() {
  return (
    <section className="page">
      <div className="glass-card hero-card">
        <p className="page-kicker">PESO Job Fair</p>
        <h1 className="page-title">Job Fair Registration &amp; QR Check-In</h1>
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
