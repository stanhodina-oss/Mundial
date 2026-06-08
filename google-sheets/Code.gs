const SPREADSHEET_ID = "PASTE_YOUR_GOOGLE_SHEET_ID_HERE";
const ALLOWED_PLAYERS = ["Marťa", "Míša", "Honzík", "Stáník"];

const KEY_FIELDS = {
  matches: ["id"],
  tips: ["match_id", "player"],
  players: ["name"],
  predictions: ["player"],
  tournament_results: ["category"],
  group_results: ["group"]
};

function doPost(e) {
  try {
    const sheetName = e.parameter.sheet;
    const payload = JSON.parse(e.parameter.payload || "{}");
    if (!sheetName || !KEY_FIELDS[sheetName]) throw new Error("Unsupported sheet: " + sheetName);
    validatePlayerPayload(sheetName, payload);

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error("Missing sheet: " + sheetName);

    upsertRow(sheet, payload, KEY_FIELDS[sheetName]);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json({ ok: true, message: "Tipovačka backend is alive. It has one job. Barely." });
}

function upsertRow(sheet, obj, keys) {
  const data = sheet.getDataRange().getValues();
  if (data.length === 0) throw new Error("Sheet has no header row");
  const headers = data[0].map(String);

  const rowValues = headers.map(h => obj[h] !== undefined ? obj[h] : "");
  let targetRow = -1;

  for (let i = 1; i < data.length; i++) {
    const same = keys.every(k => {
      const col = headers.indexOf(k);
      return col >= 0 && String(data[i][col]) === String(obj[k]);
    });
    if (same) { targetRow = i + 1; break; }
  }

  if (targetRow > 0) {
    keys.forEach(k => { if (obj[k] === undefined) obj[k] = getExisting(sheet, targetRow, headers, k); });
    headers.forEach((header, idx) => {
      if (obj[header] !== undefined) sheet.getRange(targetRow, idx + 1).setValue(obj[header]);
    });
  } else {
    sheet.appendRow(rowValues);
  }
}

function getExisting(sheet, row, headers, key) {
  const idx = headers.indexOf(key);
  if (idx < 0) return "";
  return sheet.getRange(row, idx + 1).getValue();
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function validatePlayerPayload(sheetName, payload) {
  const player = payload.player || payload.name || "";
  if ((sheetName === "tips" || sheetName === "predictions" || sheetName === "players") && player && ALLOWED_PLAYERS.indexOf(player) === -1) {
    throw new Error("Unsupported player: " + player);
  }
}
