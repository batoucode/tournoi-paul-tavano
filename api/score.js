/**
 * Vercel Serverless Function — Proxy vers Google Sheets
 * 
 * GET /api/score → renvoie tous les scores du tournoi
 * POST /api/score → enregistre un score (body: { match_id, score1, score2 })
 */

const SHEET_ID = "188QYWII-cW_R-q3Cs12A33D2lqcdrCkcIPPAG80MJ9o";
const SHEET_RANGE = "Scores!A1:C21";

// Ces variables d'environnement sont définies dans Vercel
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

async function getAccessToken() {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Token refresh failed: ${data.error} — ${data.error_description}`);
  return data.access_token;
}

async function readScores(accessToken) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_RANGE}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Sheets API: ${data.error?.message || resp.status}`);

  const rows = data.values || [];
  const scores = {};
  for (let i = 1; i < rows.length; i++) {
    const [matchId, s1, s2] = rows[i];
    if (s1 || s2) {
      scores[matchId] = { s1: s1 || "", s2: s2 || "" };
    }
  }
  return scores;
}

async function writeScore(accessToken, matchId, score1, score2) {
  // Trouver la ligne du match
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_RANGE}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Sheets API: ${data.error?.message || resp.status}`);

  const rows = data.values || [];
  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(matchId)) {
      rowIndex = i + 1; // 1-indexed
      break;
    }
  }
  if (rowIndex === -1) throw new Error(`Match ${matchId} not found`);

  // Mettre à jour
  const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Scores!B${rowIndex}:C${rowIndex}?valueInputOption=RAW`;
  const updateResp = await fetch(updateUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      values: [[score1 || "", score2 || ""]],
    }),
  });
  const updateData = await updateResp.json();
  if (!updateResp.ok) throw new Error(`Sheet update: ${updateData.error?.message || updateResp.status}`);
  return { matchId, score1, score2 };
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const accessToken = await getAccessToken();

    if (req.method === "GET") {
      const scores = await readScores(accessToken);
      return res.status(200).json({ success: true, scores });
    }

    if (req.method === "POST") {
      const { match_id, score1, score2 } = req.body;
      if (!match_id) {
        return res.status(400).json({ success: false, error: "match_id is required" });
      }
      const result = await writeScore(accessToken, match_id, score1, score2);
      return res.status(200).json({ success: true, ...result });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (e) {
    console.error("API Error:", e);
    return res.status(500).json({ success: false, error: e.message });
  }
}
