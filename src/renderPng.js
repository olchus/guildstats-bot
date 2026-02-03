const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

/**
 * Wczytuje CSS z pliku table.css
 */
function loadCss() {
  const cssPath = path.join(__dirname, "table.css");
  return fs.readFileSync(cssPath, "utf8");
}

/**
 * Buduje HTML pod render PNG
 */
function buildHtml({ title, ts, rows }) {
  const css = loadCss();

  const header = rows[0] || [];
  const body = rows.slice(1);

  const escapeHtml = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const formatCell = (val, colIdx) => {
    const t = String(val ?? "").trim();

    // Kolumny EXP – kolorowanie
    if (colIdx >= 2) {
      if (t.startsWith("+")) {
        return `<span class="pos">${escapeHtml(t)}</span>`;
      }
      if (t.startsWith("-")) {
        return `<span class="neg">${escapeHtml(t)}</span>`;
      }
    }

    return escapeHtml(t);
  };

  const headerHtml = header
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join("");

  const bodyHtml = body
    .map((row) => {
      const isTotal =
        String(row[0] || "").trim().toLowerCase() === "total";
      const cls = isTotal ? "total" : "";

      const cells = row
        .map((cell, i) => `<td>${formatCell(cell, i)}</td>`)
        .join("");

      return `<tr class="${cls}">${cells}</tr>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>${css}</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="top">
        <div class="title">${escapeHtml(title)}</div>
        <div class="ts">${escapeHtml(ts)}</div>
      </div>
      <table>
        <thead>
          <tr>${headerHtml}</tr>
        </thead>
        <tbody>
          ${bodyHtml}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Renderuje PNG z tabeli
 */
async function renderPng({
  rows,
  title,
  ts,
  width,
  scale,
  executablePath,
}) {
  const html = buildHtml({ title, ts, rows });

  const browser = await puppeteer.launch({
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    await page.setViewport({
      width,
      height: 800,
      deviceScaleFactor: scale,
    });

    await page.setContent(html, { waitUntil: "networkidle0" });

    // Dopasuj wysokość do contentu
    const bodyHandle = await page.$("body");
    const box = await bodyHandle.boundingBox();
    const height = Math.ceil((box?.height || 800) + 10);

    await page.setViewport({
      width,
      height,
      deviceScaleFactor: scale,
    });

    return await page.screenshot({
      type: "png",
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
}

module.exports = { renderPng };
