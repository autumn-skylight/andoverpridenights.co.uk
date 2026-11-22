const DATES_URL =
  process.env.DATES_JSON_URL ||
  "https://api.andoverpridenights.co.uk/dates.json";

function escapeHtml(value) {
  return String(value).replace(
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

function shiftMonth({ year, month }, amount) {
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
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

function renderCalendar(dates, selectedMonth) {
  const year = selectedMonth.year;
  const month = selectedMonth.month;
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const startingOffset = (firstDay.getUTCDay() + 6) % 7;
  const gridStart = new Date(firstDay);
  gridStart.setUTCDate(gridStart.getUTCDate() - startingOffset);

  const datesByDay = new Map();
  dates.forEach((entry) => {
    if (
      entry &&
      typeof entry.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(entry.date)
    ) {
      datesByDay.set(entry.date, entry);
    }
  });

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
      <div class="calendar-day${outsideMonth ? " outside-month" : ""}${entry ? " has-event" : ""}">
        <time datetime="${key}">${day.getUTCDate()}</time>
        ${
          entry
            ? `<div class="calendar-event">
              ${beside ? `<strong>${escapeHtml(beside)}</strong>` : ""}
              ${underneath ? `<span>${escapeHtml(underneath)}</span>` : ""}
            </div>`
            : ""
        }
      </div>
    `);
  }

  const previousMonth = shiftMonth(selectedMonth, -1);
  const nextMonth = shiftMonth(selectedMonth, 1);

  return `
    <div class="calendar-toolbar">
      <a href="/dates-calendar?month=${previousMonth.key}" aria-label="Previous month">&larr;</a>
      <h2>${escapeHtml(formatMonth(year, month))}</h2>
      <a href="/dates-calendar?month=${nextMonth.key}" aria-label="Next month">&rarr;</a>
    </div>
    <div class="calendar-grid" role="table" aria-label="${escapeHtml(formatMonth(year, month))}">
      ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        .map(
          (day) =>
            `<div class="calendar-weekday" role="columnheader">${day}</div>`,
        )
        .join("")}
      ${cells.join("")}
    </div>
  `;
}

function renderPage(calendar, error = "") {
  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f7f3e9">
  <meta name="description" content="Upcoming Andover's Pride Nights dates and updates.">
  <title>Dates Calendar | Andover's Pride Nights</title>
  <link rel="stylesheet" href="/src/css/styles.css">
  <link rel="icon" href="https://assets.andoverpridenights.co.uk/images/logos/andover-pride-nights-new-logo.ico" type="image/png">
  <style>
    .calendar-main { width: min(100% - 48px, 1120px); margin: 0 auto; padding: 64px 0 96px; }
    .calendar-heading { margin: 32px 0 28px; font-family: var(--serif); font-size: clamp(44px, 7vw, 72px); font-weight: 400; letter-spacing: -0.04em; }
    .calendar-toolbar { display: grid; grid-template-columns: 48px 1fr 48px; align-items: center; margin-bottom: 18px; text-align: center; }
    .calendar-toolbar h2 { margin: 0; font-family: var(--serif); font-size: clamp(24px, 4vw, 38px); font-weight: 400; }
    .calendar-toolbar a { display: grid; width: 44px; height: 44px; place-items: center; border: 1px solid var(--ink); border-radius: 50%; text-decoration: none; }
    .calendar-toolbar a:hover { background: var(--ink); color: white; }
    .calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-top: 1px solid var(--line); border-left: 1px solid var(--line); background: var(--paper-light); }
    .calendar-weekday { min-height: 42px; padding: 12px 8px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12px; font-weight: 700; text-align: center; text-transform: uppercase; }
    .calendar-day { min-height: 132px; padding: 8px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); font-size: 13px; }
    .calendar-day time { display: inline-grid; width: 28px; height: 28px; place-items: center; border-radius: 50%; }
    .calendar-day.has-event time { background: var(--green); color: white; font-weight: 700; }
    .calendar-day.outside-month { background: #efede6; color: #aaa69e; }
    .calendar-event { display: grid; gap: 4px; margin-top: 8px; padding: 8px; border-left: 3px solid #e7d2ef; background: #f7f3e9; color: var(--ink); }
    .calendar-event strong { color: var(--green); font-size: 12px; }
    .calendar-event span { font-size: 12px; line-height: 1.35; }
    .calendar-error { color: #a3312c; }
    @media (max-width: 600px) {
      .calendar-main { width: calc(100% - 24px); padding: 38px 0 64px; }
      .calendar-heading { margin-top: 24px; }
      .calendar-grid { grid-template-columns: repeat(7, minmax(42px, 1fr)); overflow-x: auto; }
      .calendar-day { min-height: 105px; padding: 5px; }
      .calendar-event { margin-top: 5px; padding: 5px; }
      .calendar-event strong, .calendar-event span { font-size: 9px; }
    }
  </style>
</head>
<body class="legal-page">
  <header class="site-header">
    <a class="wordmark" href="/" aria-label="Andover's Pride Nights home">
      <img class="wordmark-logo" src="https://assets.andoverpridenights.co.uk/images/logos/andover-pride-nights-logo.png" alt="Andover's Pride Nights">
    </a>
<nav class="site-nav" aria-label="Main navigation">
      <a href="https://www.facebook.com/groups/1618357456269886/?ref=share">Facebook</a>
      <a href="https://chat.whatsapp.com/DTv6O6o61bpIRokKMU7D2p">Whatsapp</a>
      <a class="nav-cta" href="#contact">Get in touch <svg xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 640 640"><!--!Font Awesome Free v7.3.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.-->
          <path
            d="M125.4 128C91.5 128 64 155.5 64 189.4C64 190.3 64 191.1 64.1 192L64 192L64 448C64 483.3 92.7 512 128 512L512 512C547.3 512 576 483.3 576 448L576 192L575.9 192C575.9 191.1 576 190.3 576 189.4C576 155.5 548.5 128 514.6 128L125.4 128zM528 256.3L528 448C528 456.8 520.8 464 512 464L128 464C119.2 464 112 456.8 112 448L112 256.3L266.8 373.7C298.2 397.6 341.7 397.6 373.2 373.7L528 256.3zM112 189.4C112 182 118 176 125.4 176L514.6 176C522 176 528 182 528 189.4C528 193.6 526 197.6 522.7 200.1L344.2 335.5C329.9 346.3 310.1 346.3 295.8 335.5L117.3 200.1C114 197.6 112 193.6 112 189.4z" />
        </svg></a>
    </nav>
  </header>
  <main class="calendar-main">
    <a class="legal-back" href="/">&larr; Back to home</a>
    <h1 class="calendar-heading">Dates calendar</h1>
    ${error ? `<p class="calendar-error" role="alert">${escapeHtml(error)}</p>` : calendar}
  </main>
</body>
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
</html>`;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).send("Method not allowed");
    return;
  }

  try {
    const dates = await loadDates();
    const validDates = dates.filter(
      (entry) =>
        entry &&
        typeof entry.date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(entry.date),
    );

    let selectedMonth = parseMonth(
      req.query && typeof req.query.month === "string" ? req.query.month : "",
    );

    if (!selectedMonth) {
      const nextDate = [...validDates]
        .filter((entry) => entry.date >= new Date().toISOString().slice(0, 10))
        .sort((left, right) => left.date.localeCompare(right.date))[0];

      const defaultDate =
        nextDate?.date ||
        validDates.sort((left, right) => left.date.localeCompare(right.date))[0]
          ?.date;

      selectedMonth = parseMonth(defaultDate?.slice(0, 7) || "2026-12");
    }

    res.status(200).send(renderPage(renderCalendar(validDates, selectedMonth)));
  } catch (error) {
    res
      .status(502)
      .send(
        renderPage("", `Could not load the dates calendar: ${error.message}`),
      );
  }
};
