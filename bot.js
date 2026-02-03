const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const cheerio = require("cheerio");
const cron = require("node-cron");

// ===== ENV =====
const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "* 11 * * *"; // 11:30
const TIMEZONE = process.env.TZ || "Europe/Warsaw";

const SOURCE_URL = process.env.SOURCE_URL || "https://guildstats.eu/guild=bambiki&op=3";
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

function chunkTextBlocks(lines, maxMessageLen = 1900) {
  const chunks = [];
  let current = "```text\n";
  for (const line of lines) {
    const next = line + "\n";
    if ((current + next + "```").length > maxMessageLen) {
      current += "```";
      chunks.push(current);
      current = "```text\n" + next;
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
      const resp = await axios.get(url, {
        timeout: 25000,
        headers: {
          // "udajemy" przeglądarkę, bo Cloudflare często blokuje defaultowego klienta
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
          "Referer": "https://guildstats.eu/",
        },
        validateStatus: () => true,
      });

      console.log(`GUILDSTATS HTTP: ${resp.status}`);

      // 200 -> OK
      if (resp.status === 200) return resp.data;

      // czasem 403/429/503 – warto spróbować ponownie po chwili
      const snippet = String(resp.data).slice(0, 200).replace(/\s+/g, " ");
      lastErr = new Error(`HTTP ${resp.status} | body: ${snippet}`);

      // proste backoff
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
    console.log("DEBUG: myTable2 exists in HTML?", String(html).includes(TABLE_ID));
    throw new Error(`Nie znaleziono tabeli o id="${TABLE_ID}" (blokada / zmiana strony).`);
  }

  // --- logika jak Twoj skrypt: removeRows + removeColumn + sortTable ---
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

  filtered.sort((b, a) => {
    const A = (a?.[2] || "").replace(/[+,]/g, "") || "0";
    const B = (b?.[2] || "").replace(/[+,]/g, "") || "0";
    return A.localeCompare(B, undefined, { numeric: true });
  });

  const finalTable = [header, ...filtered, lastRow].filter(Boolean);

  // --- ładne wyrównanie ---
  const colWidths = [];
  for (const row of finalTable) {
    row.forEach((cell, i) => {
      colWidths[i] = Math.max(colWidths[i] || 0, String(cell ?? "").length);
    });
  }

  const pad = (s, len) => {
    s = String(s ?? "");
    if (s.length > len) return s.slice(0, len);
    return s + " ".repeat(len - s.length);
  };

  const lines = finalTable.map((row) =>
    row.map((cell, i) => pad(cell, colWidths[i])).join(" | ")
  );

  return chunkTextBlocks(lines, 1900);
}

async function sendTable(channel) {
  const ts = formatTimestamp(new Date());
  await channel.send(`📊 **GuildStats – dane z:** ${ts}`);

  const chunks = await fetchAndFormatTable();
  for (const chunk of chunks) await channel.send(chunk);
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
