const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const cheerio = require("cheerio");
const cron = require("node-cron");

// ENV
const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "0 9 * * *"; // domyślnie 09:00
const TIMEZONE = process.env.TZ || "Europe/Warsaw";
const SOURCE_URL = process.env.SOURCE_URL || "https://guildstats.eu/guild=bambiki&op=3";
const TABLE_ID = process.env.TABLE_ID || "myTable2";

// Walidacja
if (!TOKEN) throw new Error("Brak DISCORD_TOKEN w zmiennych środowiskowych.");
if (!CHANNEL_ID) throw new Error("Brak DISCORD_CHANNEL_ID w zmiennych środowiskowych.");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// --- Logika: pobranie i przetworzenie tabeli jak w Twoim skrypcie ---
async function fetchAndFormatTable() {
  const html = (await axios.get(SOURCE_URL, { timeout: 20000 })).data;
  const $ = cheerio.load(html);

  const raw = [];
  $(`#${TABLE_ID} tr`).each((i, row) => {
    const cols = [];
    $(row).find("th, td").each((j, cell) => cols.push($(cell).text().trim()));
    if (cols.length) raw.push(cols);
  });

  if (!raw.length) {
    return { ok: false, text: `❌ Nie znaleziono tabeli o id="${TABLE_ID}".` };
  }

  // 1) removeRows(): usuń wiersze gdzie col[13] = '0' lub '-'
  const filtered = raw.filter((row, i) => {
    if (i === 0) return true; // nagłówek
    const v = row[13];
    return !(v === "0" || v === "-");
  });

  // 2) removeColumn(colIndex, repeat)
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

  // 3) sortTable(2) malejąco, pomiń nagłówek, nie sortuj ostatniego wiersza
  const header = filtered.shift();
  const lastRow = filtered.pop();

  filtered.sort((b, a) => {
    const A = (a[2] || "").replace(/[+,]/g, "");
    const B = (b[2] || "").replace(/[+,]/g, "");
    return (A || "0").localeCompare(B || "0", undefined, { numeric: true });
  });

  const finalTable = [header, ...filtered, lastRow].filter(Boolean);

  // --- ładne wyrównanie monospace ---
  const colWidths = [];
  for (const row of finalTable) {
    row.forEach((cell, i) => {
      colWidths[i] = Math.max(colWidths[i] || 0, (cell || "").length);
    });
  }

  const pad = (s, len) => {
    s = String(s ?? "");
    if (s.length > len) return s.slice(0, len);
    return s + " ".repeat(len - s.length);
  };

  const lines = finalTable.map(row =>
    row.map((cell, i) => pad(cell, colWidths[i])).join(" | ")
  );

  // Discord message limit: 2000 znaków -> tnij na chunki
  // Zostawiamy margines na nagłówki i ``` ```
  const chunks = [];
  let current = "```text\n";
  for (const line of lines) {
    const next = line + "\n";
    if ((current + next + "```").length > 1900) {
      current += "```";
      chunks.push(current);
      current = "```text\n" + next;
    } else {
      current += next;
    }
  }
  current += "```";
  chunks.push(current);

  return { ok: true, chunks };
}

async function postTable() {
  const channel = await client.channels.fetch(CHANNEL_ID);
  const result = await fetchAndFormatTable();

  if (!result.ok) {
    await channel.send(result.text);
    return;
  }

  const now = new Date();
  await channel.send(`📊 **GuildStats – dzienne zestawienie** (${now.toLocaleString("pl-PL", { timeZone: TIMEZONE })})`);

  for (const chunk of result.chunks) {
    await channel.send(chunk);
  }
}

client.once("ready", () => {
  console.log(`✅ Bot online jako: ${client.user.tag}`);

  // Cron (timezone)
  cron.schedule(CRON_SCHEDULE, async () => {
    try {
      await postTable();
    } catch (e) {
      console.error("Błąd CRON:", e);
    }
  }, { timezone: TIMEZONE });

  console.log(`⏰ Zaplanowano wysyłkę: "${CRON_SCHEDULE}" (${TIMEZONE})`);
});

// Komenda ręczna
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (msg.content.trim() === "!tabela") {
    try {
      await msg.channel.send("⏳ Pobieram dane...");
      const result = await fetchAndFormatTable();
      if (!result.ok) return msg.channel.send(result.text);
      for (const chunk of result.chunks) await msg.channel.send(chunk);
    } catch (e) {
      console.error(e);
      await msg.channel.send("❌ Wystąpił błąd podczas pobierania/wysyłki.");
    }
  }
});

client.login(TOKEN);