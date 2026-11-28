const { createHash, createHmac, timingSafeEqual } = require("node:crypto");

const SESSION_COOKIE = "dates_session";
const SESSION_DURATION_SECONDS = 8 * 60 * 60;
const DATES_URL =
  process.env.DATES_JSON_URL ||
  "https://api.andoverpridenights.co.uk/dates.json";
const EARLIEST_MONTH = { year: 2026, month: 12, key: "2026-12" };

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

function parseMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(value || "")) {
    return null;
  }

  const [year, month] = value.split("-").map(Number);
  if (month < 1 || month > 12) {
    return null;
  }

  return { year, month, key: `${year}-${String(month).padStart(2, "0")}` };
}

function shiftMonth(selectedMonth, amount) {
  const date = new Date(
    Date.UTC(selectedMonth.year, selectedMonth.month - 1 + amount, 1),
  );

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
  };
}

function formatMonth(year, month) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function getDefaultMonth(dates) {
  const validDates = dates
    .filter((entry) => typeof entry.date === "string")
    .sort((left, right) => left.date.localeCompare(right.date));
  const firstDate = validDates.find(
    (entry) => entry.date >= EARLIEST_MONTH.key,
  );
  return parseMonth(firstDate?.date.slice(0, 7) || EARLIEST_MONTH.key);
}

function ensureMinimumMonth(selectedMonth) {
  if (!selectedMonth) {
    return null;
  }

  const selectedKey = `${selectedMonth.year}-${String(selectedMonth.month).padStart(2, "0")}`;
  return selectedKey < EARLIEST_MONTH.key ? EARLIEST_MONTH : selectedMonth;
}

function renderList(dates) {
  if (!dates.length) {
    return `<p>No dates have been published yet.</p>`;
  }

  const sortedDates = [...dates].sort((left, right) =>
    String(left.date).localeCompare(String(right.date)),
  );
  const groupedDates = new Map();
  sortedDates.forEach((entry) => {
    const monthKey = entry.date.slice(0, 7);
    if (!groupedDates.has(monthKey)) {
      groupedDates.set(monthKey, []);
    }
    groupedDates.get(monthKey).push(entry);
  });

  return [...groupedDates.entries()]
    .map(([monthKey, monthDates]) => {
      const month = parseMonth(monthKey);
      return `
        <section class="dates-month-group" id="month-${monthKey}">
          <h2 class="dates-list-month">
            <a href="/dates?view=calendar&amp;month=${monthKey}">
              ${escapeHtml(formatMonth(month.year, month.month))}
            </a>
          </h2>
          <ol class="dates-list">
            ${monthDates
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

                return `
                  <li id="date-${escapeHtml(date)}">
                    <a class="date-link" href="/dates?view=calendar&amp;month=${monthKey}&amp;date=${escapeHtml(date)}">
                      <strong>${label}</strong>${besideMarkup}
                    </a>
                    ${underneathMarkup}
                  </li>
                `;
              })
              .join("")}
          </ol>
        </section>
      `;
    })
    .join("");
}

function renderCalendar(dates, selectedMonth, selectedDate) {
  const year = selectedMonth.year;
  const month = selectedMonth.month;
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const startingOffset = (firstDay.getUTCDay() + 6) % 7;
  const gridStart = new Date(firstDay);
  gridStart.setUTCDate(gridStart.getUTCDate() - startingOffset);
  const datesByDay = new Map(
    dates
      .filter((entry) => typeof entry.date === "string")
      .map((entry) => [entry.date, entry]),
  );

  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const day = new Date(gridStart);
    day.setUTCDate(gridStart.getUTCDate() + index);
    const key = day.toISOString().slice(0, 10);
    const outsideMonth = day.getUTCMonth() + 1 !== month;
    const entry = datesByDay.get(key);
    const beside =
      entry && typeof entry.beside === "string" ? entry.beside.trim() : "";
    const underneath =
      entry && typeof entry.underneath === "string"
        ? entry.underneath.trim()
        : "";

    cells.push(`
      <div class="calendar-day${outsideMonth ? " outside-month" : ""}${entry ? " has-event" : ""}" id="calendar-${key}">
        ${
          entry
            ? `<a href="/dates?view=calendar&amp;month=${selectedMonth.key}&amp;date=${key}" aria-label="Show details for ${escapeHtml(formatDate(key))}">
              <time datetime="${key}">${day.getUTCDate()}</time>
              <div class="calendar-event">
                ${beside ? `<strong>${escapeHtml(beside)}</strong>` : ""}
                ${underneath ? `<span>${escapeHtml(underneath)}</span>` : ""}
              </div>
            </a>`
            : `<time datetime="${key}">${day.getUTCDate()}</time>`
        }
      </div>
    `);
  }

  const previousMonth = shiftMonth(selectedMonth, -1);
  const nextMonth = shiftMonth(selectedMonth, 1);
  const monthName = formatMonth(year, month);
  const canGoBack =
    selectedMonth.year > EARLIEST_MONTH.year ||
    (selectedMonth.year === EARLIEST_MONTH.year &&
      selectedMonth.month > EARLIEST_MONTH.month);

  return `
    <div class="calendar-toolbar">
      ${
        canGoBack
          ? `<a href="/dates?view=calendar&amp;month=${previousMonth.key}" aria-label="Previous month">&larr;</a>`
          : `<span class="calendar-nav-disabled" aria-disabled="true">&larr;</span>`
      }
      <!--<a class="calendar-month-link" href="/dates?view=list&amp;month=${selectedMonth.key}#month-${selectedMonth.key}" title="Show all dates, starting at this month"> -->
        <h2>${escapeHtml(monthName)}</h2>
      </a>
      <a href="/dates?view=calendar&amp;month=${nextMonth.key}" aria-label="Next month">&rarr;</a>
    </div>
    <div class="calendar-grid" role="table" aria-label="${escapeHtml(monthName)}">
      ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        .map(
          (day) =>
            `<div class="calendar-weekday" role="columnheader">${day}</div>`,
        )
        .join("")}
      ${cells.join("")}
    </div>
    ${selectedDate ? renderEventDialog(datesByDay.get(selectedDate), selectedMonth) : ""}
  `;
}

function renderEventDialog(event, selectedMonth) {
  if (!event) {
    return "";
  }

  const date = event.date;
  const beside = typeof event.beside === "string" ? event.beside.trim() : "";
  const underneath =
    typeof event.underneath === "string" ? event.underneath.trim() : "";
  const closeUrl = `/dates?view=calendar&amp;month=${selectedMonth.key}`;

  return `
    <div class="event-overlay">
      <a class="event-backdrop" href="${closeUrl}" aria-label="Close event details"></a>
      <section class="event-dialog" role="dialog" aria-modal="true" aria-labelledby="event-dialog-title" tabindex="-1">
        <a class="event-dialog-close" href="${closeUrl}" aria-label="Close event details">&times;</a>
        <p class="eyebrow">Upcoming meet-up</p>
        <h2 id="event-dialog-title">${escapeHtml(formatDate(date))}</h2>
        ${beside ? `<p class="event-dialog-beside">${escapeHtml(beside)}</p>` : ""}
        ${underneath ? `<p>${escapeHtml(underneath)}</p>` : ""}
      </section>
    </div>
  `;
}

async function renderPage({
  authenticated,
  error = "",
  dates = [],
  view = "calendar",
  selectedMonth = null,
  selectedDate = "",
}) {
  let content;

  if (authenticated) {
    const month = selectedMonth || getDefaultMonth(dates);
    const viewTabs = `
      <nav class="dates-view-tabs" aria-label="Dates view">
        <a class="${view === "calendar" ? "active" : ""}" href="/dates?view=calendar&amp;month=${month.key}">Calendar</a>
        <a class="${view === "list" ? "active" : ""}" href="/dates?view=list&amp;month=${month.key}#month-${month.key}">All dates</a>
      </nav>
    `;

    content =
      viewTabs +
      (view === "list"
        ? renderList(dates)
        : renderCalendar(dates, month, selectedDate));
  } else {
    content = `<p>Enter the password to see the upcoming dates & updates.</p>
<p>don't know the password please email us to find out</p>
        <form class="password-form" method="post" action="/dates">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required>
          <button class="button button-primary" type="submit">Show dates</button>
          <p class="form-error" role="alert">${error}</p>
        </form>`;
  }

  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <meta name="theme-color" content="#fbf8ef">
  <title>Dates | Andover's Pride Nights</title>
  <link rel="stylesheet" href="/src/css/styles.css">
  <link rel="icon" href="https://assets.andoverpridenights.co.uk/images/logos/andover-pride-nights-new-logo.ico" type="image/png">
  <style>
    .dates-list { padding-left: 1.4rem; }
    .dates-list li { margin: 0.9rem 0; color: var(--muted); }
    .date-link { color: var(--ink); text-decoration: none; }
    .date-link:hover strong { color: var(--plum); text-decoration: underline; text-underline-offset: 4px; }
    .date-update-beside { margin-left: 0.55rem; color: var(--plum); font-weight: 700; }
    .date-update-underneath { margin: 0.35rem 0 0; color: var(--muted); }
    .dates-view-tabs { display: flex; gap: 8px; margin-bottom: 18px; color: black;}
    .dates-view-tabs a { padding: 8px 16px; border: 1px solid var(--ink); border-radius: 999px; text-decoration: none; color: black; }
    .dates-view-tabs a.active { background: var(--plum); color: white; }
    .dates-list-month { margin: 0 0 12px; font-family: var(--serif); font-size: clamp(24px, 4vw, 38px); font-weight: 400; }
    .dates-list-month a { text-decoration: none; color: black;}
    .dates-list-month a:hover { color: var(--plum); text-decoration: underline; text-underline-offset: 5px; }
    .dates-month-group + .dates-month-group { margin-top: 42px; padding-top: 28px; border-top: 1px solid var(--line); }
    .calendar-toolbar { display: grid; grid-template-columns: 48px 1fr 48px; align-items: center; margin-bottom: 18px; text-align: center; }
    .calendar-toolbar > a { display: grid; width: 44px; height: 44px; place-items: center; border: 1px solid var(--ink); border-radius: 50%; color: var(--ink); text-decoration: none; }
    .calendar-nav-disabled { display: grid; width: 44px; height: 44px; place-items: center; border: 1px solid var(--line); border-radius: 50%; color: #aaa69e; }
    .calendar-toolbar > a:hover { background: var(--ink); color: white; }
    .calendar-toolbar .calendar-month-link { width: auto; height: auto; border: 0; border-radius: 0; color:  black; }
    .calendar-toolbar .calendar-month-link:hover { background: transparent; color: var(--plum); }
    .calendar-toolbar h2 { margin: 0; font-family: var(--serif); font-size: clamp(24px, 4vw, 38px); font-weight: 400; }
    .calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-top: 1px solid var(--line); border-left: 1px solid var(--line); background: var(--paper-light); }
    .calendar-weekday { min-height: 42px; padding: 12px 8px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12px; font-weight: 700; text-align: center; text-transform: uppercase; }
    .calendar-day { min-height: 132px; padding: 8px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); font-size: 13px; }
    .calendar-day a { display: block; min-height: 115px; color: inherit; text-decoration: none; }
    .calendar-day time { display: inline-grid; width: 28px; height: 28px; place-items: center; border-radius: 50%; }
    .calendar-day.has-event time { background: var(--plum); color: white; font-weight: 700; }
    .calendar-day.outside-month { background: #f1eee3; color: #aaa69e; }
    .calendar-event { display: grid; gap: 4px; margin-top: 8px; padding: 8px; border-left: 3px solid var(--purple); background: var(--paper); color: var(--ink); }
    .calendar-event strong { color: var(--plum); font-size: 12px; }
    .calendar-event span { font-size: 12px; line-height: 1.35; }
    .event-overlay { position: fixed; inset: 0; z-index: 10; display: grid; place-items: center; padding: 24px; }
    .event-backdrop { position: absolute; inset: 0; background: rgb(33 31 27 / 48%); backdrop-filter: blur(7px); }
    .event-dialog { position: relative; z-index: 1; width: min(100%, 560px); padding: clamp(28px, 6vw, 48px); border: 1px solid var(--ink); background: var(--paper-light); box-shadow: 12px 14px 0 rgb(33 31 27 / 35%); animation: event-dialog-in 180ms ease-out; }
    .event-dialog:focus { outline: none; }
    .event-dialog .eyebrow { margin-bottom: 14px; }
    .event-dialog h2 { margin: 0 36px 16px 0; font-family: var(--serif); font-size: clamp(32px, 6vw, 48px); font-weight: 400; line-height: 1.1; }
    .event-dialog p:last-child { margin-bottom: 0; color: var(--muted); line-height: 1.7; }
    .event-dialog .event-dialog-beside { margin-bottom: 10px; color: var(--plum); font-weight: 700; }
    .event-dialog-close { position: absolute; top: 12px; right: 16px; color: var(--ink); font-size: 32px; line-height: 1; text-decoration: none; }
    .event-dialog-close:hover { color: var(--plum); }
    @keyframes event-dialog-in { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }
    @media (prefers-reduced-motion: reduce) { .event-dialog { animation: none; } }
    @media (max-width: 600px) {
      .calendar-grid { grid-template-columns: repeat(7, minmax(42px, 1fr)); overflow-x: auto; }
      .calendar-day { min-height: 105px; padding: 5px; }
      .calendar-day a { min-height: 95px; }
      .calendar-event { margin-top: 5px; padding: 5px; }
      .calendar-event strong, .calendar-event span { font-size: 9px; }
      .calendar-toolbar h2 { font-size: 22px; }
      .event-overlay { padding: 16px; }
    }
    .password-form { display: grid; gap: 12px; max-width: 380px; }
    .password-form label { font-weight: 700; }
    .password-form input { min-height: 46px; padding: 11px 12px; border: 1px solid #c9c3b7; border-radius: 2em; font: inherit; }
    .password-form .button { width: max-content; border: 0; cursor: pointer; }
    .form-error { min-height: 1.5em; margin: 0; color: var(--plum); }
.legal-subheading {
    font-size: 1.5em;
    text-align: center;
  }

  </style>
</head>
<body class="legal-page">
  <header class="site-header">
    <a class="wordmark" href="/" aria-label="Andover's Pride Nights home">
      <img class="wordmark-logo" src="https://assets.andoverpridenights.co.uk/images/logos/andover-pride-nights-logo.png" alt="Andover's Pride Nights">
    </a>
 <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-navigation">
      <span class="nav-toggle-label">Menu</span>
      <span class="nav-toggle-icon" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </span>
    </button>
    <nav class="site-nav" id="site-navigation" aria-label="Main navigation">
      <a href="https://www.facebook.com/groups/1618357456269886/?ref=share">Facebook</a>
      <a href="https://chat.whatsapp.com/DTv6O6o61bpIRokKMU7D2p">Whatsapp</a>
      <a href="https://andoverpridenights.co.uk/dates">Dates</a>
      <a class="nav-cta" href="#contact">Get in touch <svg xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 640 640"><!--!Font Awesome Free v7.3.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.-->
          <path
            d="M125.4 128C91.5 128 64 155.5 64 189.4C64 190.3 64 191.1 64.1 192L64 192L64 448C64 483.3 92.7 512 128 512L512 512C547.3 512 576 483.3 576 448L576 192L575.9 192C575.9 191.1 576 190.3 576 189.4C576 155.5 548.5 128 514.6 128L125.4 128zM528 256.3L528 448C528 456.8 520.8 464 512 464L128 464C119.2 464 112 456.8 112 448L112 256.3L266.8 373.7C298.2 397.6 341.7 397.6 373.2 373.7L528 256.3zM112 189.4C112 182 118 176 125.4 176L514.6 176C522 176 528 182 528 189.4C528 193.6 526 197.6 522.7 200.1L344.2 335.5C329.9 346.3 310.1 346.3 295.8 335.5L117.3 200.1C114 197.6 112 193.6 112 189.4z" />
        </svg></a>
    </nav>
  </header>
  <main class="legal-main">
    <a class="legal-back" href="/">← Back to home</a>
    <h1 class="legal-heading">Dates</h1>
<p class="legal-subheading"> check out Upcoming dates & updates </p>
    <section class="legal-copy" aria-label="Upcoming dates/changes">${content}</section>
  </main>
<footer class="site-footer legal-footer">
    <a class="footer-brand" href="../index.html"><img class="footer-logo"
        src="https://assets.andoverpridenights.co.uk/images/logos/andover-pride-nights-logo.png"
        alt="Andover's Pride Nights"></a>
    <p>A welcoming, inclusive space to connect in Andover.</p>
    <nav class="footer-links" aria-label="Legal">
      <a href="terms.html">Terms &amp; conditions</a>
      <a href="privacy-policy.html">Privacy policy</a>
    </nav>
    <span class="footer-age">18+</span>
  </footer>
  <script>
    const eventDialog = document.querySelector(".event-dialog");
    if (eventDialog) {
      eventDialog.focus();
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          window.location.href = document.querySelector(".event-dialog-close").href;
        } else if (event.key === "Tab") {
          event.preventDefault();
          document.querySelector(".event-dialog-close").focus();
        }
      });
    }
    const navToggle = document.querySelector(".nav-toggle");
    const siteNavigation = document.querySelector("#site-navigation");

    if (navToggle && siteNavigation) {
      navToggle.addEventListener("click", () => {
        const isOpen = navToggle.getAttribute("aria-expanded") === "true";
        navToggle.setAttribute("aria-expanded", String(!isOpen));
        siteNavigation.classList.toggle("is-open", !isOpen);
      });

      siteNavigation.addEventListener("click", (event) => {
        if (event.target.closest("a")) {
          navToggle.setAttribute("aria-expanded", "false");
          siteNavigation.classList.remove("is-open");
        }
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && navToggle.getAttribute("aria-expanded") === "true") {
          navToggle.setAttribute("aria-expanded", "false");
          siteNavigation.classList.remove("is-open");
          navToggle.focus();
        }
      });
    }
  </script>
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
      const view = req.query && req.query.view === "list" ? "list" : "calendar";
      const requestedMonth =
        req.query && typeof req.query.month === "string"
          ? parseMonth(req.query.month)
          : null;
      const selectedMonth =
        ensureMinimumMonth(requestedMonth) || getDefaultMonth(dates);
      const selectedDate =
        req.query && typeof req.query.date === "string" ? req.query.date : "";

      res.status(200).send(
        await renderPage({
          authenticated: true,
          dates,
          view,
          selectedMonth,
          selectedDate,
        }),
      );
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
