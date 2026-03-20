jest.mock("axios", () => ({
  get: jest.fn(),
}));

const axios = require("axios");
const { buildRows, fetchGuildStatsData, __testing } = require("../src/guildstats");

const SOURCE_URL = "https://guildstats.eu/guild=bambiki&op=3#timeonline";

const STATIC_PAGE_HTML = `
  <html>
    <body>
      <div id="tab-timeonline">Loading...</div>
    </body>
  </html>
`;

const TIMEONLINE_TAB_HTML = `
  <div>
    <table>
      <thead>
        <tr>
          <th>Other</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>ignore</td></tr>
      </tbody>
    </table>

    <table class="sortable-table">
      <thead>
        <tr>
          <th>Lvl</th>
          <th>Exp 30 days</th>
          <th>Nick</th>
          <th>Exp yesterday</th>
          <th>Exp 7 days</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td data-sort-value="700">700</td>
          <td data-sort-value="5000"><span class="text-green-400">+5,000</span></td>
          <td>
            <a href="character/Alpha+Knight">Alpha Knight</a>
            <span>Compare character</span>
          </td>
          <td data-sort-value="120"><span class="text-green-400">+120</span></td>
          <td data-sort-value="900"><span class="text-green-400">+900</span></td>
        </tr>
        <tr>
          <td data-sort-value="650">650</td>
          <td data-sort-value="9000"><span class="text-green-400">+9,000</span></td>
          <td>
            <a href="character/Beta+Mage">Beta Mage</a>
            <span>Compare character</span>
          </td>
          <td data-sort-value="-50"><span class="text-red-400">-50</span></td>
          <td data-sort-value="1000"><span class="text-green-400">+1,000</span></td>
        </tr>
        <tr>
          <td data-sort-value="300">300</td>
          <td data-sort-value="300"><span class="text-green-400">+300</span></td>
          <td>
            <a href="character/Gamma+Paladin">Gamma Paladin</a>
          </td>
          <td data-sort-value="0">0</td>
          <td data-sort-value="200"><span class="text-green-400">+200</span></td>
        </tr>
        <tr>
          <td data-sort-value="100">100</td>
          <td data-sort-value="0">-Level is too low to get experience data</td>
          <td>
            <a href="character/Tiny+Druid">Tiny Druid</a>
          </td>
          <td data-sort-value="0">-Level is too low to get experience data</td>
          <td data-sort-value="0">-Level is too low to get experience data</td>
        </tr>
      </tbody>
    </table>
  </div>
`;

describe("guildstats", () => {
  let warnSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    axios.get.mockImplementation((url) => {
      if (url === SOURCE_URL) {
        return Promise.resolve({ status: 200, data: STATIC_PAGE_HTML });
      }

      if (url === "https://guildstats.eu/include/guild/tab.php?guild=bambiki&tab=timeonline") {
        return Promise.resolve({ status: 200, data: TIMEONLINE_TAB_HTML });
      }

      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("buildGuildTabUrl derives the timeonline endpoint from the guild page URL", () => {
    expect(__testing.buildGuildTabUrl(SOURCE_URL, "timeonline")).toBe(
      "https://guildstats.eu/include/guild/tab.php?guild=bambiki&tab=timeonline"
    );
  });

  test("fetchGuildStatsData falls back from static HTML to the timeonline endpoint and normalizes rows", async () => {
    const rows = await fetchGuildStatsData({ sourceUrl: SOURCE_URL });

    expect(warnSpy).toHaveBeenCalledWith(
      "[guildstats] Timeonline table is not present in the static DOM. Falling back to the guild tab endpoint."
    );
    expect(rows).toEqual([
      {
        name: "Alpha Knight",
        level: 700,
        expDaily: 120,
        expWeekly: 900,
        expMonthly: 5000,
        isTotal: false,
      },
      {
        name: "Beta Mage",
        level: 650,
        expDaily: -50,
        expWeekly: 1000,
        expMonthly: 9000,
        isTotal: false,
      },
      {
        name: "Gamma Paladin",
        level: 300,
        expDaily: 0,
        expWeekly: 200,
        expMonthly: 300,
        isTotal: false,
      },
      {
        name: "Tiny Druid",
        level: 100,
        expDaily: null,
        expWeekly: null,
        expMonthly: null,
        isTotal: false,
      },
    ]);
  });

  test("buildRows creates the daily table sorted by daily exp and adds skulls only for negative daily rows", async () => {
    const rows = await buildRows({ sourceUrl: SOURCE_URL, mode: "daily" });

    expect(rows).toEqual([
      ["Nick", "Lvl", "Exp yesterday", "Exp 7 days", "Exp 30 days"],
      ["\u{1F947} Alpha Knight", "700", "+120", "+900", "+5,000"],
      ["\u{1F948} Gamma Paladin", "300", "0", "+200", "+300"],
      ["\u2620\uFE0F \u{1F949} Beta Mage", "650", "-50", "+1,000", "+9,000"],
      ["Tiny Druid", "100", "-", "-", "-"],
    ]);
  });

  test("buildRows creates the monthly table sorted by monthly exp without skulls", async () => {
    const rows = await buildRows({ sourceUrl: SOURCE_URL, mode: "monthly" });

    expect(rows).toEqual([
      ["Nick", "Lvl", "Exp yesterday", "Exp 7 days", "Exp 30 days"],
      ["\u{1F947} Beta Mage", "650", "-50", "+1,000", "+9,000"],
      ["\u{1F948} Alpha Knight", "700", "+120", "+900", "+5,000"],
      ["\u{1F949} Gamma Paladin", "300", "0", "+200", "+300"],
      ["Tiny Druid", "100", "-", "-", "-"],
    ]);
  });
});
