// api/history.js
// GET /api/history → ambil history deploy dari KV

const { kv } = require("@vercel/kv");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.json({ error: "Method not allowed" });
  }

  try {
    const rawItems = await kv.lrange("deploy-history", 0, 49);
    const items = (rawItems || []).map((s) => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    }).filter(Boolean);

    res.statusCode = 200;
    return res.json({
      success: true,
      items,
    });
  } catch (err) {
    console.error("Error reading history from KV:", err);
    res.statusCode = 500;
    return res.json({
      success: false,
      error: "Failed to read history",
      details: err.message || String(err),
    });
  }
};
