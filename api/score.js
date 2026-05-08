/**
 * Vercel Serverless Function — Proxy vers Google Sheets
 * 
 * GET /api/score → scores + éliminations
 * POST /api/score → enregistre un score (match_id, score1, score2)
 * POST /api/elimination → enregistre une sélection élimination (match_id, team1, team2)
 */

const SHEET_ID = "188QYWII-cW_R-q3Cs12A33D2lqcdrCkcIPPAG80MJ9o";
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

async function getAccessToken() {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN, grant_type: "refresh_token",
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Token refresh failed: ${data.error} — ${data.error_description}`);
  return data.access_token;
}

async function readSheet(accessToken, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Sheets API: ${data.error?.message || resp.status}`);
  return data.values || [];
}

async function writeCell(accessToken, range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?valueInputOption=RAW`;
  const resp = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Sheet update: ${data.error?.message || resp.status}`);
  return data;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const accessToken = await getAccessToken();

    if (req.method === "GET") {
      const [scoreRows, elimRows] = await Promise.all([
        readSheet(accessToken, "Scores!A1:C21"),
        readSheet(accessToken, "Eliminations!A1:C20"),
      ]);

      const scores = {};
      for (let i = 1; i < scoreRows.length; i++) {
        const [id, s1, s2] = scoreRows[i];
        if (s1 || s2) scores[id] = { s1: s1 || "", s2: s2 || "" };
      }

      const eliminations = {};
      for (let i = 1; i < elimRows.length; i++) {
        const [id, t1, t2] = elimRows[i];
        eliminations[id] = { team1: t1 || "", team2: t2 || "" };
      }

      return res.status(200).json({ success: true, scores, eliminations });
    }

    if (req.method === "POST") {
      const { match_id, score1, score2 } = req.body;
      if (!match_id) return res.status(400).json({ success: false, error: "match_id required" });

      const rows = await readSheet(accessToken, "Scores!A1:C21");
      let rowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(match_id)) { rowIndex = i + 1; break; }
      }
      if (rowIndex === -1) return res.status(404).json({ success: false, error: `Match ${match_id} not found` });

      await writeCell(accessToken, `Scores!B${rowIndex}:C${rowIndex}`, [[score1 || "", score2 || ""]]);
      return res.status(200).json({ success: true, match_id, score1, score2 });
    }

    if (req.method === "PATCH") {
      const { match_id, team1, team2, type } = req.body;
      if (!match_id) return res.status(400).json({ success: false, error: "match_id required" });

      if (type === "elimination") {
        const rows = await readSheet(accessToken, "Eliminations!A1:C20");
        let rowIndex = -1;
        for (let i = 1; i < rows.length; i++) {
          if (String(rows[i][0]) === String(match_id)) { rowIndex = i + 1; break; }
        }
        if (rowIndex === -1) return res.status(404).json({ success: false, error: `Elim match ${match_id} not found` });
        await writeCell(accessToken, `Eliminations!B${rowIndex}:C${rowIndex}`, [[team1 || "", team2 || ""]]);
        return res.status(200).json({ success: true, match_id, team1, team2 });
      }

      return res.status(400).json({ success: false, error: "Unknown type" });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (e) {
    console.error("API Error:", e);
    return res.status(500).json({ success: false, error: e.message });
  }
}
// token refresh 1778236870
