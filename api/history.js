// api/history.js
const { Redis } = require("@upstash/redis/nodejs");

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res
      .status(405)
      .json({ success: false, error: "Method not allowed" });
  }

  try {
    // Ambil max 50 history terbaru (index 0–49)
    const raw = await redis.lrange("deploy_history", 0, 49);
    const items =
      (raw || [])
        .map((s) => {
          try {
            return JSON.parse(s);
          } catch {
            return null;
          }
        })
        .filter(Boolean) || [];

    return res.status(200).json({
      success: true,
      items,
    });
  } catch (err) {
    console.error("History API error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to load history",
      details: err.message || String(err),
    });
  }
};
