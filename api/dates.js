const { createHash, createHmac, timingSafeEqual } = require("node:crypto");

const SESSION_COOKIE = "dates_session";
const SESSION_DURATION_SECONDS = 8 * 60 * 60;
const DATES_URL =
  process.env.DATES_JSON_URL ||
  "https://api.andoverpridenights.co.uk/dates.json";

function signSession(expiresAt, secret) {
  return createHmac("sha256", secret)
    .update(`dates:${expiresAt}`)
    .digest("base64url");
}

function isEqual(left, right) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();

  return timingSafeEqual(leftHash, rightHash);
}

function hasValidSession(req, secret) {
  const cookies = (req.headers.cookie || "").split(";");
  const sessionCookie = cookies
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));

  if (!sessionCookie) {
    return false;
  }

  const [expiresAt, signature] = sessionCookie
    .slice(SESSION_COOKIE.length + 1)
    .split(".");

  if (
    !/^\d+$/.test(expiresAt) ||
    Number(expiresAt) <= Math.floor(Date.now() / 1000)
  ) {
    return false;
  }

  return isEqual(signature || "", signSession(expiresAt, secret));
}

function formatDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date "${value}". Use YYYY-MM-DD.`);
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid calendar date "${value}".`);
  }

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

async function loadDates() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(DATES_URL, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Dates API returned HTTP ${response.status}.`);
    }

    const dates = await response.json();

    if (!Array.isArray(dates)) {
      throw new Error("Dates API did not return a JSON array.");
    }

    return dates;
  } finally {
    clearTimeout(timeout);
  }
}

async function renderPage({ authenticated, error = "", dates = [] }) {
  const content = authenticated
    ? `<p>Our next monthly meet-ups:</p>
        ${
          dates.length
            ? `<ol class="dates-list">${[...dates]
                .sort((left, right) =>
                  String(left.date).localeCompare(String(right.date)),
                )
                .map(({ date, beside = "", underneath = "" }) => {
                  const label = formatDate(date);
                  const besideText =
                    typeof beside === "string" ? beside.trim() : "";
                  const underneathText =
                    typeof underneath === "string" ? underneath.trim() : "";
                  const besideMarkup = besideText
                    ? `<span class="date-update-beside">${escapeHtml(besideText)}</span>`
                    : "";
                  const underneathMarkup = underneathText
                    ? `<p class="date-update-underneath">${escapeHtml(underneathText)}</p>`
                    : "";

                  return `<li><strong>${label}</strong>${besideMarkup}${underneathMarkup}</li>`;
                })
                .join("")}</ol>`
            : `<p>No dates have been published yet.</p>`
        }`
    : `<p>Enter the password to see the upcoming dates.</p>
        <form class="password-form" method="post" action="/dates">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required>
          <button class="button button-primary" type="submit">Show dates</button>
          <p class="form-error" role="alert">${error}</p>
        </form>`;

  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <title>Dates | Andover's Pride Nights</title>
  <link rel="stylesheet" href="/src/css/styles.css">
  <link rel="icon" href="https://assets.andoverpridenights.co.uk/images/logos/andover-pride-nights-new-logo.ico" type="image/png">
  <style>
    .dates-list { padding-left: 1.4rem; }
    .dates-list li { margin: 0.9rem 0; color: #514f48; }
    .date-update-beside { margin-left: 0.55rem; color: #587d43; font-weight: 700; }
    .date-update-underneath { margin: 0.35rem 0 0; color: #656158; }
    .password-form { display: grid; gap: 12px; max-width: 380px; }
    .password-form label { font-weight: 700; }
    .password-form input { min-height: 46px; padding: 11px 12px; border: 1px solid #c9c3b7; border-radius: 2em; font: inherit; }
    .password-form .button { width: max-content; border: 0; cursor: pointer; }
    .form-error { min-height: 1.5em; margin: 0; color: #a3312c; }
.legal-subheading {
    font-size: 2em;
    text-align: center;
  }

  </style>
</head>
<body class="legal-page">
  <header class="site-header">
    <a class="wordmark" href="/" aria-label="Andover's Pride Nights home">
      <img class="wordmark-logo" src="https://assets.andoverpridenights.co.uk/images/logos/andover-pride-nights-logo.png" alt="Andover's Pride Nights">
    </a>
  </header>
  <main class="legal-main">
    <a class="legal-back" href="/">← Back to home</a>
    <h1 class="legal-heading">Dates</h1>
<p class="legal-subheading"> check out Upcoming dates & any changes </p>
    <section class="legal-copy" aria-label="Upcoming dates/changes">${content}</section>
  </main>
</body>
</html>`;
}

function setSecurityHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
}

module.exports = async (req, res) => {
  setSecurityHeaders(res);

  const password = process.env.DATES_PAGE_PASSWORD;
  const sessionSecret = process.env.DATES_SESSION_SECRET;

  if (!password || !sessionSecret) {
    res
      .status(503)
      .send(
        "Dates page is not configured. Set DATES_PAGE_PASSWORD and DATES_SESSION_SECRET in Vercel.",
      );
    return;
  }

  if (req.method === "GET") {
    if (!hasValidSession(req, sessionSecret)) {
      res.status(200).send(await renderPage({ authenticated: false }));
      return;
    }

    try {
      const dates = await loadDates();
      res.status(200).send(await renderPage({ authenticated: true, dates }));
    } catch (error) {
      res.status(502).send(`Could not load dates: ${error.message}`);
    }
    return;
  }

  if (req.method === "POST") {
    const submittedPassword =
      req.body && typeof req.body.password === "string"
        ? req.body.password
        : "";

    if (!isEqual(submittedPassword, password)) {
      res.status(401).send(
        await renderPage({
          authenticated: false,
          error: "That password was not recognised. Please try again.",
        }),
      );
      return;
    }

    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;
    const signature = signSession(expiresAt, sessionSecret);

    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${expiresAt}.${signature}; Path=/dates; Max-Age=${SESSION_DURATION_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
    );
    res.status(303).setHeader("Location", "/dates").end();
    return;
  }

  res.setHeader("Allow", "GET, POST");
  res.status(405).send("Method not allowed");
};
