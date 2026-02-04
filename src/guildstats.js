const axios = require("axios");
const cheerio = require("cheerio");

// Fetch z “browser-like headers”
async function fetchHtmlWithRetry(url, tries = 3) {
  let lastErr = null;

  for (let i = 1; i <= tries; i++) {
    try {
      const resp = await axios.get(url, {
        timeout: 25000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          Referer: "https://guildstats.eu/",
        },
        validateStatus: () => true,
      });

      if (resp.status === 200) return resp.data;

      const snippet = String(resp.data).slice(0, 200).replace(/\s+/g, " ");
      lastErr = new Error(`HTTP ${resp.status} | body: ${snippet}`);
      await new Promise((r) => setTimeout(r, 1000 * i));
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }

  throw lastErr || new Error("Nie udało się pobrać HTML (unknown).");
}

function toNumber(x) {
  return Number(String(x ?? "").replace(/[+,]/g, "").trim() || "0");
}

/**
 * Zwraca "rows" = Array<Array<string>>
 * row[0] = header
 * row[1..] = gracze
 * plus ewentualny wiersz Total na końcu (jeśli istnieje)
 */
async function buildRows({ sourceUrl, tableId }) {
  const html = await fetchHtmlWithRetry(sourceUrl, 3);
  const $ = cheerio.load(html);

  const raw = [];
  $(`#${tableId} tr`).each((i, row) => {
    const cols = [];
    $(row)
      .find("th, td")
      .each((j, cell) => cols.push($(cell).text().trim()));
    if (cols.length) raw.push(cols);
  });

  if (!raw.length) {
    throw new Error(`Nie znaleziono tabeli o id="${tableId}" (blokada / zmiana strony).`);
  }

  // ===== Logika jak w Twoim skrypcie JS =====
  // removeRows: usuń wiersze gdzie col[13] == '0' albo '-'
  const filtered = raw.filter((row, i) => {
    if (i === 0) return true;
    const v = row[13];
    return !(v === "0" || v === "-");
  });

  function removeColumn(data, colIndex, repeat) {
    for (let r = 0; r < repeat; r++) {
      for (const row of data) {
        if (row.length > colIndex) row.splice(colIndex, 1);
      }
    }
  }

  removeColumn(filtered, 0, 1);
  removeColumn(filtered, 2, 10);
  removeColumn(filtered, 5, 1);

  const header = filtered.shift();
  const lastRow = filtered.pop();

  // sortTable(2): malejąco po kolumnie 2 (liczbowe)
  filtered.sort((b, a) => {
    const A = (a?.[2] || "").replace(/[+,]/g, "") || "0";
    const B = (b?.[2] || "").replace(/[+,]/g, "") || "0";
    return A.localeCompare(B, undefined, { numeric: true });
  });

  let rows = [header, ...filtered, lastRow].filter(Boolean);

  // TOP3 medals
  const medals = ["🥇", "🥈", "🥉"];

  const bodyRows = rows.slice(1);
  const totalIndexInRows =
    bodyRows.length > 0 &&
    String(bodyRows[bodyRows.length - 1][0] || "").trim().toLowerCase() === "total"
      ? rows.length - 1
      : -1;

  const lastPlayerRowIndex = totalIndexInRows === -1 ? rows.length - 1 : totalIndexInRows - 1;

  for (let i = 0; i < 3; i++) {
    const rowIndex = 1 + i;
    if (rowIndex <= lastPlayerRowIndex) {
      rows[rowIndex][0] = `${medals[i]} ${String(rows[rowIndex][0] ?? "")}`;
    }
  }

    // ☠️ SKULL dla osób z ujemnym Exp yesterday
  // Po cięciach kolumn: [0]=Nick, [1]=Lvl, [2]=Exp yesterday, [3]=Exp 7 days, [4]=Exp 30 days
  // Nie dotykamy nagłówka (index 0) i wiersza Total (jeśli jest).
  for (let i = 1; i < rows.length; i++) {
    const nick = String(rows[i][0] ?? "").trim();
    if (!nick) continue;

    // pomiń Total
    if (nick.toLowerCase() === "total") continue;

    const expYesterday = toNumber(rows[i][2]);
    if (expYesterday < 0) {
      // jeśli już jest czaszka, nie duplikuj
      if (!nick.includes("☠️")) {
        rows[i][0] = `☠️ ${rows[i][0]}`;
      }
    }
  }

  return rows;
}

module.exports = { buildRows };