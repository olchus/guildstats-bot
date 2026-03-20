const { Client, GatewayIntentBits, AttachmentBuilder } = require("discord.js");
const cron = require("node-cron");

const { config } = require("./config");
const cache = require("./cache");
const { buildRows } = require("./guildstats");
const { renderPng } = require("./renderPng");

function formatTimestamp(date = new Date()) {
  const dtf = new Intl.DateTimeFormat("pl-PL", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = dtf.format(date).replace(",", "");
  const [d, t] = parts.split(" ");
  const [, , yyyy] = d.split(".");
  const [dd, mm] = d.split(".");
  return `${yyyy}-${mm}-${dd} ${t} (${config.timezone})`;
}

async function buildOrGetPng({ forceRefresh = false } = {}) {
  if (!forceRefresh && cache.isValid(config.cacheTtlMin)) {
    const { pngBuffer, fetchedAt } = cache.get();
    return { pngBuffer, fetchedAt, cached: true };
  }

  const rows = await buildRows({
    sourceUrl: config.sourceUrl,
    mode: "daily",
  });
  const fetchedAt = new Date();

  const pngBuffer = await renderPng({
    rows,
    title: "GuildStats - Bambiki",
    ts: `Dane z: ${formatTimestamp(fetchedAt)}`,
    width: config.pngWidth,
    scale: config.pngScale,
    executablePath: config.puppeteerExecutablePath,
  });

  cache.set(pngBuffer, fetchedAt);
  return { pngBuffer, fetchedAt, cached: false };
}

async function sendPng(channel, { forceRefresh = false } = {}) {
  const { pngBuffer, fetchedAt, cached } = await buildOrGetPng({ forceRefresh });
  const ts = formatTimestamp(fetchedAt);
  const cachedNote = cached ? ` (cache ${cache.ageText()})` : "";
  const file = new AttachmentBuilder(pngBuffer, { name: "guildstats.png" });

  await channel.send({
    content: `GuildStats - dane z: ${ts}${cachedNote}`,
    files: [file],
  });
}

async function sendMonthlyPng(channel) {
  const rows = await buildRows({
    sourceUrl: config.sourceUrl,
    mode: "monthly",
  });

  const fetchedAt = new Date();
  const ts = formatTimestamp(fetchedAt);

  const pngBuffer = await renderPng({
    rows,
    title: "GuildStats - Podsumowanie miesi\u0105ca (Exp 30 days)",
    ts: `Dane z: ${ts}`,
    width: config.pngWidth,
    scale: config.pngScale,
    executablePath: config.puppeteerExecutablePath,
  });

  const file = new AttachmentBuilder(pngBuffer, { name: "guildstats-monthly.png" });

  await channel.send({
    content: `Miesi\u0119czne podsumowanie XP - ${ts}`,
    files: [file],
  });
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once("ready", () => {
  console.log(`Bot online jako: ${client.user.tag}`);
  console.log(`Zaplanowano wysy\u0142k\u0119: "${config.cronSchedule}" (${config.timezone})`);
  console.log(`Cache TTL: ${config.cacheTtlMin} min`);

  cron.schedule(
    config.cronSchedule,
    async () => {
      try {
        const channel = await client.channels.fetch(config.discordChannelId);
        await sendPng(channel, { forceRefresh: true });
      } catch (e) {
        console.error("CRON ERROR:", e?.message || e);
      }
    },
    { timezone: config.timezone }
  );

  console.log(`Miesi\u0119czny raport: "${config.monthlyCronSchedule}" (${config.timezone})`);

  cron.schedule(
    config.monthlyCronSchedule,
    async () => {
      try {
        const channel = await client.channels.fetch(config.discordChannelId);
        await sendMonthlyPng(channel);
      } catch (e) {
        console.error("MONTHLY CRON ERROR:", e?.message || e);
      }
    },
    { timezone: config.timezone }
  );
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const content = (msg.content || "").trim().toLowerCase();

  if (content.startsWith("!tabela")) {
    const force = content.includes("force");
    await msg.channel.send(force ? "Pobieram \u015bwie\u017ce dane..." : "Pobieram dane...");

    try {
      await sendPng(msg.channel, { forceRefresh: force });
    } catch (e) {
      const errMsg = e?.message ? String(e.message).slice(0, 500) : "unknown error";
      console.error("COMMAND ERROR:", e);
      await msg.channel.send(`Wyst\u0105pi\u0142 b\u0142\u0105d: **${errMsg}**`);
    }
    return;
  }

  if (!content.startsWith("!monthly")) return;

  await msg.channel.send("Pobieram miesi\u0119czne dane...");

  try {
    await sendMonthlyPng(msg.channel);
  } catch (e) {
    const errMsg = e?.message ? String(e.message).slice(0, 500) : "unknown error";
    console.error("MONTHLY COMMAND ERROR:", e);
    await msg.channel.send(`Wyst\u0105pi\u0142 b\u0142\u0105d: **${errMsg}**`);
  }
});

client.login(config.discordToken);
