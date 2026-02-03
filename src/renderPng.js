const puppeteer = require("puppeteer-core");

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildHtml({ title, ts, rows }) {
  const header = rows[0] || [];
  const body = rows.slice(1);

  const formatCell = (val, colIdx) => {
    const t = String(val ?? "").trim();
    // Zakładamy: Nick | Lvl | Exp yesterday | Exp 7 days | Exp 30 days
    if (colIdx >= 2) {
      if (t.startsWith("+")) return `<span class="pos">${escapeHtml(t)}</span>`;
      if (t.startsWith("-")) return `<span class="neg">${escapeHtml(t)}</span>`;
    }
    return escapeHtml(t);
  };

  const headerHtml = header.map((h) => `<th>${escapeHtml(h)}</th>`).join("");

  const bodyHtml = body
    .map((row) => {
      const tds = row.map((c, i) => `<td>${formatCell(c, i)}</td>`).join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");

  // KISS: jeden, spójny “card style” i brak wrapów
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  :root{
    --bg:#0f1115; --panel:#151923; --text:#e9eef7; --muted:#a9b4c7;
    --pos:#43d17a; --neg:#ff5a5f; --grid:#263041;
  }
  html,body{ margin:0; background:var(--bg); color:var(--text);
    font-family: ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial; }
  .wrap{ padding:18px; }
  .card{
    background: var(--panel);
    border:1px solid rgba(255,255,255,.06);
    border-radius:16px;
    padding:14px 14px 10px;
    box-shadow: 0 8px 30px rgba(0,0,0,.35);
    width: fit-content;
    max-width: 1400px;
  }
  .top{ display:flex; justify-content:space-between; gap:16px; margin-bottom:10px; }
  .title{ font-size:18px; font-weight:700; }
  .ts{ font-size:12px; color:var(--muted); white-space:nowrap; }
  table{ border-collapse:separate; border-spacing:0; font-size:13px; }
  th,td{
    padding:10px 10px;
    border-bottom: 1px solid var(--grid);
    white-space:nowrap; /* kluczowe: nie zawijamy kolumn */
  }
  th{ text-align:left; font-size:12px; color:var(--muted); font-weight:600;
      background: rgba(255,255,255,.02);
      border-bottom: 1px solid rgba(255,255,255,.10); }
  tr:nth-child(odd) td{ background: rgba(255,255,255,.01); }
  tr:nth-child(even) td{ background: rgba(0,0,0,.06); }
  .pos{ color:var(--pos); font-weight:700; }
  .neg{ color:var(--neg); font-weight:700; }
  td:first-child{ font-weight:600; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="top">
        <div class="title">${escapeHtml(title)}</div>
        <div class="ts">${escapeHtml(ts)}</div>
      </div>
      <table>
        <thead><tr>${headerHtml}</tr></thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}

async function renderPng({ rows, title, ts, width, scale, executablePath }) {
  const html = buildHtml({ title, ts, rows });

  const browser = await puppeteer.launch({
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 800, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: "networkidle0" });

    // dopasowanie wysokości
    const bodyHandle = await page.$("body");
    const box = await bodyHandle.boundingBox();
    const height = Math.ceil((box?.height || 800) + 10);
    await page.setViewport({ width, height, deviceScaleFactor: scale });

    return await page.screenshot({ type: "png", fullPage: true });
  } finally {
    await browser.close();
  }
}

module.exports = { renderPng };