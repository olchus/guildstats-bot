const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const cheerio = require("cheerio");
const cron = require("node-cron");

// ===== ENV =====
const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "30 11 * * *"; // 11:30
const TIMEZONE = process.env.TZ || "Europe/Warsaw";

const SOURCE_URL =
  process.env.SOURCE_URL || "https://guildstats.eu/guild=bambiki&op=3";
const TABLE_ID = process.env.TABLE_ID || "myTable2";

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
// W większości klientów Discorda działa ```ansi```.
// + zielone, - czerwone, nagłówek szary/pogrubiony.
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

async function fetchHtmlWithRetry(url, tries = 3) {
  let lastErr = null;

  for (let i = 1; i <= tries; i++) {
    try {
      // Cloudflare często blokuje domyślnego klienta -> podszywamy się pod przeglądarkę
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

      // prosty backoff
      await new Promise((r) => setTimeout(r, 1000 * i));
    } catch (e) {
      lastErr = e;
      console.log(`Fetch attempt ${i} failed:`, e?.message || e);
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }

  throw lastErr || new Error("Nie udało się pobrać HTML (unknown).");
}

async function fetchAndFormatTable() {
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
    console.log(
      "DEBUG: myTable2 exists in HTML?",
      String(html).includes(TABLE_ID)
    );
    throw new Error(
      `Nie znaleziono tabeli o id="${TABLE_ID}" (blokada / zmiana strony).`
    );
  }

  // --- logika jak Twój skrypt: removeRows + removeColumn + sortTable ---
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

  // sortTable(2): sort malejąco po kolumnie 2 (liczbowe)
  const header = filtered.shift();
  const lastRow = filtered.pop();

  filtered.sort((b, a) => {
    const A = (a?.[2] || "").replace(/[+,]/g, "") || "0";
    const B = (b?.[2] || "").replace(/[+,]/g, "") || "0";
    return A.localeCompare(B, undefined, { numeric: true });
  });

  const finalTable = [header, ...filtered, lastRow].filter(Boolean);

  // --- formatowanie ANSI: zielone +, czerwone -, nagłówek szary/pogrubiony ---
  const coloredTable = finalTable.map((row, idx) => {
    if (idx === 0) return row.map((c) => String(c ?? "")); // nagłówek bez kolorów
    return row.map((cell, cIdx) => {
      // Zakładamy układ: Nick | Lvl | Exp yesterday | Exp 7 days | Exp 30 days
      // Kolory dajemy od kolumny 2 w prawo (EXP)
      if (cIdx >= 2) return colorizeSigned(cell);
      return String(cell ?? "");
    });
  });

  // szerokości liczymy po tekście bez ANSI
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

  // Dwie spacje między kolumnami wyglądają bardziej jak tabela z UI
  const lines = coloredTable.map((row, i) => {
    const line = row.map((cell, c) => pad(cell, colWidths[c])).join("  ");
    if (i === 0) return `${ANSI.bold}${ANSI.gray}${line}${ANSI.reset}`;
    return line;
  });

  return chunkAnsiBlocks(lines, 1900);
}

async function sendTable(channel) {
  const ts = formatTimestamp(new Date());
  await channel.send(`📊 **GuildStats – dane z:** ${ts}`);

  const chunks = await fetchAndFormatTable();
  for (const chunk of chunks) {
    await channel.send(chunk);
  }
}

// ===== EVENTS =====
client.once("ready", () => {
  console.log(`✅ Bot online jako: ${client.user.tag}`);
  console.log(`⏰ Zaplanowano wysyłkę: "${CRON_SCHEDULE}" (${TIMEZONE})`);

  cron.schedule(
    CRON_SCHEDULE,
    async () => {
      try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        await sendTable(channel);
      } catch (e) {
        console.error("CRON ERROR:", e?.message || e);
      }
    },
    { timezone: TIMEZONE }
  );
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if ((msg.content || "").trim() !== "!tabela") return;

  await msg.channel.send("🏆 Pobieram dane...");

  try {
    await sendTable(msg.channel);
  } catch (e) {
    const errMsg = e?.message ? String(e.message).slice(0, 500) : "unknown error";
    console.error("COMMAND ERROR:", e);
    await msg.channel.send(`❌ Wystąpił błąd: **${errMsg}**`);
  }
});

client.login(TOKEN);
