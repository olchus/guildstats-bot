function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Brak ${name} w .env`);
  return v;
}

const config = {
  discordToken: requireEnv("DISCORD_TOKEN"),
  discordChannelId: requireEnv("DISCORD_CHANNEL_ID"),

  cronSchedule: process.env.CRON_SCHEDULE || "0 13 * * *",
  timezone: process.env.TZ || "Europe/Warsaw",

  sourceUrl: process.env.SOURCE_URL || "https://guildstats.eu/guild=bambiki&op=3",
  tableId: process.env.TABLE_ID || "myTable2",

  // cache PNG w minutach
  cacheTtlMin: Number(process.env.CACHE_TTL_MIN || 15),

  // render PNG
  pngWidth: Number(process.env.PNG_WIDTH || 980),
  pngScale: Number(process.env.PNG_SCALE || 2),
  puppeteerExecutablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
};

module.exports = { config };