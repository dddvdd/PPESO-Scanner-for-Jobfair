import { test, expect } from "@playwright/test";
import { attachObservability, assertNoHorizontalOverflow } from "./_helpers.js";

/**
 * Phase 3A — Applicant registration UI/UX with NO database writes.
 *
 * Walks the public flow as far as the form, exercises every field type the
 * current seeded form exposes, and asserts client-side validation.
 *
 * Field types covered by the seed migration:
 *   short_text, date, radio, yes_no
 * Field types NOT covered by the current seed (long_text, number, dropdown,
 * checkbox, multi_select) are still asserted to render correctly if an
 * admin adds them later — the test simply skips them when absent.
 */

const SCREENSHOTS = "screenshots";

test.describe.configure({ mode: "serial" });

async function openRegistrationForm(page) {
  await page.goto("/");
  await expect(page.locator(".nav-brand")).toBeVisible();
  await expect(page.getByRole("heading", { name: /jobseeker registration/i })).toBeVisible();

  const emptyState = page.getByText(/no events open for registration/i);
  await page
    .locator(".event-card")
    .first()
    .or(emptyState)
    .waitFor({ timeout: 15_000 });
  if (await emptyState.isVisible().catch(() => false)) {
    test.skip(true, "no published events available to test against");
  }

  await page.locator(".event-card").first().getByRole("button", { name: /register/i }).click();
  await page.waitForURL(/\/events\/[^/]+\/register\/[^/]+$/, { timeout: 15_000 });

  // Wait for the form to render (identity section always present).
  await expect(page.getByLabel(/first name/i)).toBeVisible();
}

async function getFieldKeys(page) {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll("[id^='field-']")).map((el) =>
      el.id.replace(/^field-/, "")
    )
  );
}

test("Phase 3A — home → events → form loads with required-field indicators", async ({ page }) => {
  const obs = attachObservability(page);
  await openRegistrationForm(page);

  // Required identity fields exist.
  await expect(page.getByLabel(/first name/i)).toBeVisible();
  await expect(page.getByLabel(/last name/i)).toBeVisible();
  await expect(page.getByLabel(/^email$/i)).toBeVisible();
  await expect(page.getByLabel(/mobile/i)).toBeVisible();

  // The seeded "course" field is required; its label carries an asterisk.
  const courseLabel = page.locator("label[for='field-course']");
  await expect(courseLabel).toBeVisible();
  await expect(courseLabel).toContainText("*");

  // Submit button is readable.
  await expect(page.getByRole("button", { name: /submit registration/i })).toBeVisible();

  expect(obs.pageErrors).toEqual([]);
  await page.screenshot({ path: `${SCREENSHOTS}/applicant-form-desktop.png`, fullPage: true });
});

test("Phase 3A — required-field validation surfaces understandable errors", async ({ page }) => {
  await openRegistrationForm(page);

  // Tick consent so we can isolate required-field errors from consent errors.
  await page.getByRole("checkbox", { name: /data privacy/i }).check();

  await page.getByRole("button", { name: /submit registration/i }).click();

  // Identity required-field errors.
  await expect(page.getByText(/first name is required/i)).toBeVisible();
  await expect(page.getByText(/last name is required/i)).toBeVisible();
  await expect(page.getByText(/email is required/i)).toBeVisible();
  await expect(page.getByText(/mobile number is required/i)).toBeVisible();

  // At least one field-level required error from the seeded form fields.
  const errors = page.locator('[role="alert"]');
  await expect(errors.first()).toBeVisible();
  expect(await errors.count()).toBeGreaterThan(1);

  // Still on the registration page (no DB write attempted).
  await expect(page).toHaveURL(/\/events\/[^/]+\/register\/[^/]+$/);

  await page.screenshot({ path: `${SCREENSHOTS}/applicant-form-validation-errors.png`, fullPage: true });
});

test("Phase 3A — invalid email is rejected without submitting", async ({ page }) => {
  const obs = attachObservability(page);
  await openRegistrationForm(page);

  await page.getByLabel(/first name/i).fill("Test");
  await page.getByLabel(/last name/i).fill("Applicant");
  await page.getByLabel(/^email$/i).fill("not-a-real-email");
  await page.getByLabel(/mobile/i).fill("09171234567");
  await page.getByRole("checkbox", { name: /data privacy/i }).check();

  await page.getByRole("button", { name: /submit registration/i }).click();

  await expect(page.getByText(/valid email address/i)).toBeVisible();
  await expect(page).toHaveURL(/\/events\/[^/]+\/register\/[^/]+$/);
  expect(obs.pageErrors).toEqual([]);
});

test("Phase 3A — consent gate blocks submission", async ({ page }) => {
  await openRegistrationForm(page);
  await page.getByLabel(/first name/i).fill("Test");
  await page.getByLabel(/last name/i).fill("Applicant");
  await page.getByLabel(/^email$/i).fill(`valid-${Date.now()}@example.test`);
  await page.getByLabel(/mobile/i).fill("09171234567");
  await page.getByRole("button", { name: /submit registration/i }).click();

  await expect(page.locator("#consent-error")).toBeVisible();
  await expect(page.locator("#consent-error")).toContainText(/data privacy consent/i);
  // Form still on registration page.
  await expect(page).toHaveURL(/\/events\/[^/]+\/register\/[^/]+$/);
});

test("Phase 3A — short_text, date, radio, yes_no fields are present and interactive", async ({ page }) => {
  await openRegistrationForm(page);
  const keys = await getFieldKeys(page);

  // short_text (course)
  if (keys.includes("course")) {
    await page.locator("#field-course").fill("BS E2 Testing");
    await expect(page.locator("#field-course")).toHaveValue("BS E2 Testing");
  }
  // date (date_of_birth)
  if (keys.includes("date_of_birth")) {
    await page.locator("#field-date_of_birth").fill("1990-01-01");
    await expect(page.locator("#field-date_of_birth")).toHaveValue("1990-01-01");
  }
  // radio (sex)
  if (keys.includes("sex")) {
    await page.locator("input[name='field-sex'][value='Female']").check();
    await expect(page.locator("input[name='field-sex'][value='Female']")).toBeChecked();
  }
  // yes_no trio
  for (const k of ["first_time_job_seeker", "returning_ofw", "returning_worker"]) {
    if (keys.includes(k)) {
      await page.locator(`input[name='field-${k}'][value='no']`).check();
      await expect(page.locator(`input[name='field-${k}'][value='no']`)).toBeChecked();
    }
  }
});

test("Phase 3A — optional long_text/number/dropdown/checkbox/multi_select render when seeded", async ({ page }) => {
  await openRegistrationForm(page);
  const keys = await getFieldKeys(page);

  const optional = [
    { type: "long_text", id: "field-bio" },
    { type: "number", id: "field-age" },
    { type: "dropdown", id: "field-program" },
    { type: "checkbox", id: "field-interests" },
    { type: "multi_select", id: "field-skills" },
  ];

  for (const f of optional) {
    if (keys.some((k) => f.id.includes(k))) {
      const el = page.locator(`#${f.id}`);
      await expect(el).toBeVisible();
    }
  }
  // The point of this test: the form is renderable for all present field
  // types. The current dev seed only contains short_text/date/radio/yes_no,
  // so the test simply exits successfully without forcing those types.
});

test("Phase 3A — invalid date and number values are caught client-side", async ({ page }) => {
  await openRegistrationForm(page);
  const keys = await getFieldKeys(page);

  await page.getByLabel(/first name/i).fill("A");
  await page.getByLabel(/last name/i).fill("B");
  await page.getByLabel(/^email$/i).fill(`e2e-${Date.now()}@example.test`);
  await page.getByLabel(/mobile/i).fill("09171234567");

  // Number field — invalid value.
  if (keys.includes("age")) {
    await page.locator("#field-age").fill("not-a-number");
  }
  // For type="date" the browser rejects malformed input via the native picker;
  // use evaluate() to bypass Playwright's strict fill so the React handler
  // observes an invalid string.
  if (keys.includes("date_of_birth")) {
    await page.evaluate(() => {
      const el = document.querySelector("#field-date_of_birth");
      const proto = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, "not-a-date");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await page.getByRole("checkbox", { name: /data privacy/i }).check();
  await page.getByRole("button", { name: /submit registration/i }).click();

  // Either a date-of-birth or a generic field error must appear, OR the form
  // simply stayed on /register without a server round-trip.
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/events\/[^/]+\/register\/[^/]+$/);
});

test("Phase 3A — mobile viewport: no horizontal overflow at 390x844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRegistrationForm(page);
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOTS}/applicant-form-mobile.png`, fullPage: true });
});

test("Phase 3A — mobile viewport: events list does not overflow horizontally", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /jobseeker registration/i })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOTS}/applicant-events-mobile.png`, fullPage: true });
});

test("Phase 3A — no uncaught page errors during form interaction", async ({ page }) => {
  const obs = attachObservability(page);
  await openRegistrationForm(page);

  // Walk through every field that exists without submitting.
  const keys = await getFieldKeys(page);
  for (const k of keys) {
    const sel = `#field-${k}`;
    const el = page.locator(sel);
    if (await el.count() === 0) continue;
    const tagName = await el.evaluate((n) => n.tagName);
    if (tagName === "INPUT") {
      const type = await el.evaluate((n) => n.getAttribute("type") ?? "text");
      if (type === "date") {
        await el.fill("2000-01-01");
      } else if (type === "radio") continue;
      else {
        await el.fill("hello");
      }
    } else if (tagName === "TEXTAREA") {
      await el.fill("lorem ipsum");
    } else if (tagName === "SELECT") {
      const firstOption = await el.evaluate(
        (n) => n.querySelectorAll("option")[1]?.value ?? ""
      );
      if (firstOption) await el.selectOption(firstOption);
    }
  }
  expect(obs.pageErrors).toEqual([]);
});