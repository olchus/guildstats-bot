const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const cheerio = require("cheerio");
const cron = require("node-cron");

// ===== ENV =====
const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "0 13 * * *"; // 13:00
const TIMEZONE = process.env.TZ || "Europe/Warsaw";

const SOURCE_URL =
  process.env.SOURCE_URL || "https://guildstats.eu/guild=bambiki&op=3";
const TABLE_ID = process.env.TABLE_ID || "myTable2";

// Cache TTL w minutach (10–30 min)
const CACHE_TTL_MIN = Number(process.env.CACHE_TTL_MIN || 15);

if (!TOKEN) throw new Error("Brak DISCORD_TOKEN w .env");
if (!CHANNEL_ID) throw new Error("Brak DISCORD_CHANNEL_ID w .env");

// ===== DISCORD =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ===== HELPERS =====
function formatTimestamp(date = new Date()) {
  const dtf = new Intl.DateTimeFormat("pl-PL", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = dtf.format(date).replace(",", "");
  const [d, t] = parts.split(" ");
  const [dd, mm, yyyy] = d.split(".");
  return `${yyyy}-${mm}-${dd} ${t} (${TIMEZONE})`;
}

// ===== ANSI styling for Discord code blocks =====
const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  gray: "\u001b[90m",
  green: "\u001b[32m",
  red: "\u001b[31m",
};

function stripAnsi(s) {
  return String(s).replace(/\u001b\[[0-9;]*m/g, "");
}

function colorizeSigned(text) {
  const s = String(text ?? "").trim();
  if (s.startsWith("+")) return `${ANSI.green}${s}${ANSI.reset}`;
  if (s.startsWith("-")) return `${ANSI.red}${s}${ANSI.reset}`;
  return s;
}

function chunkAnsiBlocks(lines, maxMessageLen = 1900) {
  const chunks = [];
  let current = "```ansi\n";

  for (const line of lines) {
    const next = line + "\n";
    if ((current + next + "```").length > maxMessageLen) {
      current += "```";
      chunks.push(current);
      current = "```ansi\n" + next;
    } else {
      current += next;
    }
  }

  current += "```";
  chunks.push(current);
  return chunks;
}

// ===== SIMPLE IN-MEMORY CACHE =====
// Cache jest w RAM procesu bota: jeśli kontener się zrestartuje, cache się zeruje (to OK).
const tableCache = {
  fetchedAt: null, // Date
  chunks: null, // array of strings (```ansi ...```)
};

function isCacheValid() {
  if (!tableCache.fetchedAt || !tableCache.chunks) return false;
  const ageMs = Date.now() - tableCache.fetchedAt.getTime();
  return ageMs < CACHE_TTL_MIN * 60 * 1000;
}

function cacheAgeText() {
  if (!tableCache.fetchedAt) return "";
  const ageSec = Math.floor((Date.now() - tableCache.fetchedAt.getTime()) / 1000);
  if (ageSec < 60) return `${ageSec}s`;
  const ageMin = Math.floor(ageSec / 60);
  return `${ageMin}m`;
}

// ===== FETCH + PARSE =====
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

      console.log(`GUILDSTATS HTTP: ${resp.status}`);

      if (resp.status === 200) return resp.data;

      const snippet = String(resp.data).slice(0, 200).replace(/\s+/g, " ");
      lastErr = new Error(`HTTP ${resp.status} | body: ${snippet}`);

      await new Promise((r) => setTimeout(r, 1000 * i));
    } catch (e) {
      lastErr = e;
      console.log(`Fetch attempt ${i} failed:`, e?.message || e);
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }

  throw lastErr || new Error("Nie udało się pobrać HTML (unknown).");
}

function toNumber(x) {
  return Number(String(x ?? "").replace(/[+,]/g, "").trim() || "0");
}

/**
 * Buduje tabelę i zwraca { chunks, fetchedAt }
 * forceRefresh=true -> pomija cache, pobiera świeże dane i aktualizuje cache
 */
async function buildTableChunks({ forceRefresh = false } = {}) {
  if (!forceRefresh && isCacheValid()) {
    return { chunks: tableCache.chunks, fetchedAt: tableCache.fetchedAt, cached: true };
  }

  const html = await fetchHtmlWithRetry(SOURCE_URL, 3);
  const $ = cheerio.load(html);

  const raw = [];
  $(`#${TABLE_ID} tr`).each((i, row) => {
    const cols = [];
    $(row)
      .find("th, td")
      .each((j, cell) => cols.push($(cell).text().trim()));
    if (cols.length) raw.push(cols);
  });

  if (!raw.length) {
    console.log("DEBUG: table exists in HTML?", String(html).includes(TABLE_ID));
    throw new Error(`Nie znaleziono tabeli o id="${TABLE_ID}" (blokada / zmiana strony).`);
  }

  // --- logika jak Twój skrypt: removeRows + removeColumn + sortTable ---
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

  // sort malejąco po kolumnie 2 (EXPy)
  filtered.sort((b, a) => {
    const A = (a?.[2] || "").replace(/[+,]/g, "") || "0";
    const B = (b?.[2] || "").replace(/[+,]/g, "") || "0";
    return A.localeCompare(B, undefined, { numeric: true });
  });

  let finalTable = [header, ...filtered, lastRow].filter(Boolean);

  // ===== TOP 3 medals =====
  // Zakładamy układ: Nick | Lvl | Exp yesterday | Exp 7 days | Exp 30 days
  // Medale liczymy tylko na podstawie "wierszy graczy" (bez nagłówka i bez TOTAL jeśli istnieje)
  const medals = ["🥇", "🥈", "🥉"];

  // Wykryj, czy ostatni wiersz wygląda na Total (czasem w nicku jest "Total")
  const bodyRows = finalTable.slice(1); // bez header
  const totalIndexInFinal =
    bodyRows.length > 0 &&
    String(bodyRows[bodyRows.length - 1][0] || "").trim().toLowerCase() === "total"
      ? finalTable.length - 1
      : -1;

  // Indeksy w finalTable dla graczy: od 1 do (przed Total jeśli jest)
  const lastPlayerRowIndex = totalIndexInFinal === -1 ? finalTable.length - 1 : totalIndexInFinal - 1;

  // Oznacz TOP3 w kolumnie 0 (Nick) dla pierwszych 3 graczy
  for (let i = 0; i < 3; i++) {
    const rowIndex = 1 + i; // 1..3
    if (rowIndex <= lastPlayerRowIndex) {
      const currentNick = String(finalTable[rowIndex][0] ?? "");
      finalTable[rowIndex][0] = `${medals[i]} ${currentNick}`;
    }
  }

  // --- ANSI formatting: zielone +, czerwone -, nagłówek szary/pogrubiony ---
  const coloredTable = finalTable.map((row, idx) => {
    if (idx === 0) return row.map((c) => String(c ?? "")); // header
    return row.map((cell, cIdx) => {
      if (cIdx >= 2) return colorizeSigned(cell); // EXP columns
      return String(cell ?? "");
    });
  });

  // szerokości po tekście bez ANSI
  const colWidths = [];
  for (const row of coloredTable) {
    row.forEach((cell, i) => {
      const len = stripAnsi(cell).length;
      colWidths[i] = Math.max(colWidths[i] || 0, len);
    });
  }

  const pad = (s, len) => {
    const rawStr = String(s ?? "");
    const visibleLen = stripAnsi(rawStr).length;
    if (visibleLen >= len) return rawStr;
    return rawStr + " ".repeat(len - visibleLen);
  };

  const lines = coloredTable.map((row, i) => {
    const line = row.map((cell, c) => pad(cell, colWidths[c])).join("  ");
    if (i === 0) return `${ANSI.bold}${ANSI.gray}${line}${ANSI.reset}`;
    return line;
  });

  const chunks = chunkAnsiBlocks(lines, 1900);
  const fetchedAt = new Date();

  // update cache
  tableCache.chunks = chunks;
  tableCache.fetchedAt = fetchedAt;

  return { chunks, fetchedAt, cached: false };
}

async function sendTable(channel, { forceRefresh = false } = {}) {
  const result = await buildTableChunks({ forceRefresh });

  const tsData = formatTimestamp(result.fetchedAt);
  const cachedNote = result.cached ? ` ⚡(cache ${cacheAgeText()})` : "";
  await channel.send(`📊 **GuildStats – dane z:** ${tsData}${cachedNote}`);

  for (const chunk of result.chunks) {
    await channel.send(chunk);
  }
}

// ===== EVENTS =====
client.once("ready", () => {
  console.log(`✅ Bot online jako: ${client.user.tag}`);
  console.log(`⏰ Zaplanowano wysyłkę: "${CRON_SCHEDULE}" (${TIMEZONE})`);
  console.log(`🧠 Cache TTL: ${CACHE_TTL_MIN} min`);

  // Cron: odświeżamy dane (forceRefresh), żeby cache był zawsze świeży
  cron.schedule(
    CRON_SCHEDULE,
    async () => {
      try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        await sendTable(channel, { forceRefresh: true });
      } catch (e) {
        console.error("CRON ERROR:", e?.message || e);
      }
    },
    { timezone: TIMEZONE }
  );
});

// Komendy:
//  - !tabela -> używa cache (instant jeśli ważny)
//  - !tabela force -> wymusza świeże pobranie (omija cache)
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const content = (msg.content || "").trim();
  if (!content.startsWith("!tabela")) return;

  const force = content.toLowerCase().includes("force");

  await msg.channel.send(force ? "🏆 Pobieram świeże dane..." : "🏆 Pobieram dane...");

  try {
    await sendTable(msg.channel, { forceRefresh: force });
  } catch (e) {
    const errMsg = e?.message ? String(e.message).slice(0, 500) : "unknown error";
    console.error("COMMAND ERROR:", e);
    await msg.channel.send(`❌ Wystąpił błąd: **${errMsg}**`);
  }
});

client.login(TOKEN);