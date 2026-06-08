window.TIPOVACKA_CONFIG = {
  // local = data stays in the browser and can be exported/imported as JSON.
  // google = read/write data from Google Sheets using OpenSheet + Apps Script.
  mode: "local",

  // Example for google mode:
  // sheetUrl: "https://opensheet.elk.sh/YOUR_GOOGLE_SHEET_ID",
  // scriptUrl: "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec",
  sheetUrl: "",
  scriptUrl: "",

  refreshMs: 15000
};
