# PPESO interface direction

Mode: redesign, preserve. This is an event registration service for jobseekers
and a working tool for municipal staff and administrators.

Use a quiet institutional interface: solid navy surfaces, readable labels,
clear event details, and one blue primary action per task. Preserve the existing
dark theme, PESO seal (`src/assets/peso-seal.png`), full site name, footer credit,
routes, permissions, field order, validation, consent text, and API contracts.

Design calibration: variance 2 (familiar forms and lists), motion 1 (state
feedback only), density 6 (useful event details and operational data), asset
dependence 2 (the supplied seal only), brand fidelity 9 (identity retained).
Phone and laptop reading should be comfortable; no promotional hero is needed.

- Palette: canvas #101722, surface #182230, raised surface #223044;
  text #f3f5f8, secondary #bec8d6, muted #a4b1c2;
  primary #245caa, link/focus #a8caff. Red, amber, and green indicate status.
- Typography: local Segoe UI / system sans serif, 16px body, 28px page heading,
  15px labels, comfortable line height. No downloaded fonts.
- Spacing: 4px base; 8/12px within related controls, 16/24px between groups.
- Shapes: 8px controls, 12px surfaces. Borders define surfaces; shadows only
  distinguish overlays. No background orbs, decorative glow, or gradient buttons.
- Interaction: 44px minimum controls, visible keyboard focus, contained menu
  focus, readable error recovery, and reduced motion support.

Audit: remove stacked blur/shadow/highlight treatments and redundant eyebrows;
improve menu overflow and focus, login form width, event date/location hierarchy,
loading failures, and scanner search labeling. Keep camera/QR feedback and
operational states functional. No new dependencies or external assets.

Verification uses local fixtures, never live applicant data. Layout captures
are saved under ignored `screenshots/`; source edits remain independently
reviewable in git. Database and authentication rules are unchanged.
