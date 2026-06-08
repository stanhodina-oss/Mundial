# Mundial Tipovačka 2026 Web

GitHub Pages-ready static web version of the World Cup 2026 prediction board.

## Files

- `index.html` - main page
- `style.css` - layout and styling
- `config.js` - choose local mode or Google Sheets mode
- `data.js` - match schedule, groups, players, scoring rules
- `script.js` - app logic
- `google-sheets/` - optional Apps Script backend and CSV sheet templates

## Run locally

Open `index.html` in a browser. No build step, because sometimes civilization briefly works.

Default mode is `local`, so tips/results/predictions are stored in the browser's localStorage. Use **Export dat** and **Import dat** to move data between browsers.

## Default players

- Marťa: PIN `1111`
- Míša: PIN `2222`
- Honzík: PIN `3333`
- Stáník: PIN `4444`

Change names/PINs in `data.js`. Static-page PINs are convenience only, not real security.

## Google Sheets mode

The reference site uses Google Sheets data endpoints through OpenSheet and Apps Script. This package can be wired the same way:

1. Create a Google Sheet with tabs named:
   - `matches`
   - `tips`
   - `players`
   - `predictions`
   - `tournament_results`
   - `group_results`
2. Import the CSV files from `google-sheets/csv/` into those tabs.
3. Paste `google-sheets/Code.gs` into Apps Script attached to that Google Sheet.
4. Set your spreadsheet ID inside `Code.gs`.
5. Deploy Apps Script as a web app.
6. Edit `config.js`:

```js
window.TIPOVACKA_CONFIG = {
  mode: "google",
  sheetUrl: "https://opensheet.elk.sh/YOUR_GOOGLE_SHEET_ID",
  scriptUrl: "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec",
  refreshMs: 15000
};
```

## Deploy to GitHub Pages

Upload all files in this folder to a GitHub repository, then enable Pages for the repository. Keep `index.html` in the root.

## Scoring

- Group match exact score: 6 points
- Group match correct goal difference: 4 points
- Group match correct result: 2 points
- Knockout match points: group-match points × 2
- Group winner prediction: 5 points
- Champion: 40 points
- Runner-up: 25 points
- Third place: 15 points

Note: this build hard-filters remote/local data to the four players above.
