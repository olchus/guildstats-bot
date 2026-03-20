const axios = require("axios");
const cheerio = require("cheerio");

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

const COLUMN_ALIASES = {
  name: ["nick", "name"],
  level: ["lvl", "level", "poziom"],
  expDaily: ["exp yesterday", "exp wczoraj"],
  expWeekly: ["exp 7 days", "exp 7 dni"],
  expMonthly: ["exp 30 days", "exp 30 dni"],
};

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeHeader(value) {
  return normalizeText(value).toLowerCase();
}

function looksLikeUnavailableExp(text) {
  const normalized = normalizeHeader(text);
  if (!normalized) return true;
  return /too low|not in top|experience data|no data|n\/a|brak danych/.test(normalized);
}

function parseInteger(value) {
  const normalized = normalizeText(value).replace(/,/g, "");
  if (!normalized || !/^[-+]?\d+$/.test(normalized)) return null;
  return Number(normalized);
}

function parseNumericCell($cell) {
  const sortValue = parseInteger($cell.attr("data-sort-value"));
  if (sortValue !== null) return sortValue;
  return parseInteger($cell.text());
}

function parseExperienceCell($cell) {
  const text = normalizeText($cell.text());
  if (looksLikeUnavailableExp(text)) return null;

  const sortValue = parseInteger($cell.attr("data-sort-value"));
  if (sortValue !== null) return sortValue;

  return parseInteger(text);
}

function formatSignedNumber(value) {
  if (value === null || value === undefined) return "-";
  if (value === 0) return "0";
  const abs = NUMBER_FORMAT.format(Math.abs(value));
  return value > 0 ? `+${abs}` : `-${abs}`;
}

function formatPlainNumber(value) {
  if (value === null || value === undefined) return "-";
  return NUMBER_FORMAT.format(value);
}

function buildGuildTabUrl(sourceUrl, tab) {
  const originMatch = String(sourceUrl).match(/^https?:\/\/[^/]+/i);
  const guildMatch = String(sourceUrl).match(/guild=([^&#/]+)/i);

  if (!originMatch || !guildMatch) {
    return null;
  }

  const origin = originMatch[0];
  const guildName = decodeURIComponent(guildMatch[1].replace(/\+/g, " "));
  const params = new URLSearchParams({ guild: guildName, tab });
  return `${origin}/include/guild/tab.php?${params.toString()}`;
}

async function fetchHtmlWithRetry(url, { label, referer, tries = 3 } = {}) {
  let lastErr = null;

  for (let i = 1; i <= tries; i += 1) {
    try {
      const response = await axios.get(url, {
        timeout: 25000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          Referer: referer || "https://guildstats.eu/",
        },
        validateStatus: () => true,
      });

      if (response.status === 200) {
        return String(response.data);
      }

      const snippet = String(response.data).slice(0, 200).replace(/\s+/g, " ");
      lastErr = new Error(`${label || "GuildStats request"} failed with HTTP ${response.status}. Body: ${snippet}`);
    } catch (error) {
      lastErr = new Error(`${label || "GuildStats request"} failed: ${error.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000 * i));
  }

  throw lastErr || new Error(`${label || "GuildStats request"} failed for an unknown reason.`);
}

function findMatchingTable($) {
  let match = null;

  $("table").each((_, table) => {
    const $table = $(table);
    const headers = $table
      .find("thead th")
      .map((__, th) => normalizeHeader($(th).text()))
      .get();

    if (
      resolveColumnIndex(headers, COLUMN_ALIASES.name) !== -1 &&
      resolveColumnIndex(headers, COLUMN_ALIASES.level) !== -1 &&
      resolveColumnIndex(headers, COLUMN_ALIASES.expDaily) !== -1 &&
      resolveColumnIndex(headers, COLUMN_ALIASES.expMonthly) !== -1
    ) {
      match = $table;
      return false;
    }

    return undefined;
  });

  return match;
}

function resolveColumnIndex(headers, aliases) {
  return headers.findIndex((header) => aliases.includes(header));
}

function parseTimeonlineTableHtml(html, { allowMissingTable = false } = {}) {
  const $ = cheerio.load(html);
  const $table = findMatchingTable($);

  if (!$table || !$table.length) {
    if (allowMissingTable) return null;
    throw new Error("[guildstats] Timeonline table was not found in the HTML. Selectors may have changed.");
  }

  const headers = $table
    .find("thead th")
    .map((_, th) => normalizeHeader($(th).text()))
    .get();

  const columnIndex = {
    name: resolveColumnIndex(headers, COLUMN_ALIASES.name),
    level: resolveColumnIndex(headers, COLUMN_ALIASES.level),
    expDaily: resolveColumnIndex(headers, COLUMN_ALIASES.expDaily),
    expWeekly: resolveColumnIndex(headers, COLUMN_ALIASES.expWeekly),
    expMonthly: resolveColumnIndex(headers, COLUMN_ALIASES.expMonthly),
  };

  const missingColumns = Object.entries(columnIndex)
    .filter(([, index]) => index === -1)
    .map(([key]) => key);

  if (missingColumns.length) {
    throw new Error(
      `[guildstats] Timeonline table is missing required columns: ${missingColumns.join(", ")}. Headers: ${headers.join(" | ")}`
    );
  }

  const rows = [];

  $table.find("tbody tr").each((_, tr) => {
    const $cells = $(tr).find("td");
    if (!$cells.length) return;

    const $nameCell = $cells.eq(columnIndex.name);
    const name =
      normalizeText($nameCell.find('a[href*="character/"]').first().text()) ||
      normalizeText($nameCell.text()).replace(/\s*compare character$/i, "");

    if (!name) return;

    rows.push({
      name,
      level: parseNumericCell($cells.eq(columnIndex.level)),
      expDaily: parseExperienceCell($cells.eq(columnIndex.expDaily)),
      expWeekly: parseExperienceCell($cells.eq(columnIndex.expWeekly)),
      expMonthly: parseExperienceCell($cells.eq(columnIndex.expMonthly)),
      isTotal: normalizeHeader(name) === "total",
    });
  });

  return rows;
}

async function fetchGuildStatsData({ sourceUrl }) {
  const pageHtml = await fetchHtmlWithRetry(sourceUrl, {
    label: "[guildstats] Guild page request",
    referer: "https://guildstats.eu/",
  });

  const staticRows = parseTimeonlineTableHtml(pageHtml, { allowMissingTable: true });
  if (staticRows) {
    return staticRows;
  }

  console.warn("[guildstats] Timeonline table is not present in the static DOM. Falling back to the guild tab endpoint.");

  const endpointUrl = buildGuildTabUrl(sourceUrl, "timeonline");
  if (!endpointUrl) {
    throw new Error(`[guildstats] Could not determine the timeonline endpoint from source URL: ${sourceUrl}`);
  }

  const endpointHtml = await fetchHtmlWithRetry(endpointUrl, {
    label: "[guildstats] Timeonline endpoint request",
    referer: sourceUrl,
  });

  return parseTimeonlineTableHtml(endpointHtml);
}

function compareForMode(mode) {
  const metricKey = mode === "monthly" ? "expMonthly" : "expDaily";

  return (left, right) => {
    if (left.isTotal && !right.isTotal) return 1;
    if (!left.isTotal && right.isTotal) return -1;

    const leftMetric = left[metricKey];
    const rightMetric = right[metricKey];

    if (leftMetric === null && rightMetric !== null) return 1;
    if (leftMetric !== null && rightMetric === null) return -1;
    if (leftMetric !== rightMetric) return (rightMetric || 0) - (leftMetric || 0);

    const leftMonthly = left.expMonthly ?? Number.NEGATIVE_INFINITY;
    const rightMonthly = right.expMonthly ?? Number.NEGATIVE_INFINITY;
    if (leftMonthly !== rightMonthly) return rightMonthly - leftMonthly;

    return left.name.localeCompare(right.name, "pl");
  };
}

function applyDecorations(entries, mode) {
  const medals = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];
  let medalIndex = 0;

  return entries.map((entry) => {
    const decorated = { ...entry };

    if (!decorated.isTotal && medalIndex < medals.length) {
      decorated.displayName = `${medals[medalIndex]} ${decorated.name}`;
      medalIndex += 1;
    } else {
      decorated.displayName = decorated.name;
    }

    if (mode === "daily" && decorated.expDaily !== null && decorated.expDaily < 0) {
      decorated.displayName = `\u2620\uFE0F ${decorated.displayName}`;
    }

    return decorated;
  });
}

async function buildRows({ sourceUrl, mode = "daily" } = {}) {
  const entries = await fetchGuildStatsData({ sourceUrl });
  const sorted = [...entries].sort(compareForMode(mode));
  const decorated = applyDecorations(sorted, mode);

  const header = ["Nick", "Lvl", "Exp yesterday", "Exp 7 days", "Exp 30 days"];
  const rows = decorated.map((entry) => [
    entry.displayName,
    formatPlainNumber(entry.level),
    formatSignedNumber(entry.expDaily),
    formatSignedNumber(entry.expWeekly),
    formatSignedNumber(entry.expMonthly),
  ]);

  return [header, ...rows];
}

module.exports = {
  buildRows,
  fetchGuildStatsData,
  __testing: {
    buildGuildTabUrl,
    formatSignedNumber,
    parseTimeonlineTableHtml,
  },
};
