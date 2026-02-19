// Pega este código en tu proyecto de Google Apps Script
// Reemplaza SPREADSHEET_ID y SHEET_NAME según corresponda

const SPREADSHEET_ID = 'TU_SPREADSHEET_ID';
const SHEET_NAME = 'Hoja1';

function buildTableObject(values) {
  const headers = values[0] || [];
  const cols = headers.map(h => ({ label: h || '' }));
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const c = headers.map((_, i) => {
      const v = row && row[i] !== undefined ? row[i] : '';
      return { v: v };
    });
    rows.push({ c });
  }
  return { table: { cols, rows } };
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
    sh.appendRow([
      data.id || '',
      data.nombre || '',
      data.tipo || '',
      data.problema || '',
      data.ubicacion || '',
      data.fecha || ''
    ]);
    return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: String(err) })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
    const range = sh.getDataRange();
    const values = range.getValues();
    const data = buildTableObject(values);

    const callback = e && e.parameter && e.parameter.callback;
    if (callback) {
      const out = callback + '(' + JSON.stringify(data) + ');';
      return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JAVASCRIPT);
    } else {
      return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    const msg = { error: String(err) };
    const callback = e && e.parameter && e.parameter.callback;
    if (callback) {
      return ContentService.createTextOutput(callback + '(' + JSON.stringify(msg) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
    } else {
      return ContentService.createTextOutput(JSON.stringify(msg)).setMimeType(ContentService.MimeType.JSON);
    }
  }
}
