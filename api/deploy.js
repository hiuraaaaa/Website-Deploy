// api/deploy.js
const { Redis } = require("@upstash/redis");

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// helper: baca body JSON (Vercel Node function tidak auto-parse)
async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        const json = data ? JSON.parse(data) : {};
        resolve(json);
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res
      .status(405)
      .json({ success: false, error: "Method not allowed" });
  }

  try {
    const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
    if (!VERCEL_TOKEN) {
      return res.status(500).json({
        success: false,
        error: "VERCEL_TOKEN belum diset di Environment Variables.",
      });
    }

    const body = await readJsonBody(req);
    const projectName = (body.projectName || "").trim() || "untitled-project";
    const files = Array.isArray(body.files) ? body.files : [];

    if (!files.length) {
      return res.status(400).json({
        success: false,
        error: "Tidak ada file yang dikirim.",
      });
    }

    const hasIndex = files.some(
      (f) => f.name && f.name.toLowerCase() === "index.html"
    );
    if (!hasIndex) {
      return res.status(400).json({
        success: false,
        error: "File index.html tidak ditemukan di payload.",
      });
    }

    const filesForVercel = files.map((f) => ({
      file: f.name,
      data: f.content, // sudah base64 dari frontend
      encoding: "base64",
    }));

    const url = "https://api.vercel.com/v13/deployments";

    const payload = {
      name: projectName,
      files: filesForVercel,
      projectSettings: {
        framework: null,
        outputDirectory: null,
      },
    };

    const apiRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const apiJsonText = await apiRes.text();
    let apiJson;

    try {
      apiJson = JSON.parse(apiJsonText);
    } catch (e) {
      // kalau Vercel balas HTML/error aneh
      return res.status(apiRes.status || 500).json({
        success: false,
        error: "Response dari Vercel bukan JSON.",
        details: apiJsonText.slice(0, 400),
      });
    }

    if (!apiRes.ok) {
      return res.status(apiRes.status).json({
        success: false,
        error:
          (apiJson.error && apiJson.error.message) ||
          apiJson.error ||
          "Failed to deploy to Vercel",
        details: apiJson,
      });
    }

    const deploymentUrl = apiJson.url
      ? apiJson.url.startsWith("http")
        ? apiJson.url
        : `https://${apiJson.url}`
      : null;

    // simpan history (best-effort)
    try {
      const historyItem = {
        projectName,
        url: deploymentUrl,
        fileCount: files.length,
        time: Date.now(),
      };
      await redis.lpush("deploy_history", JSON.stringify(historyItem));
      await redis.ltrim("deploy_history", 0, 49); // simpan max 50
    } catch (e) {
      console.error("Failed to write deploy history:", e);
    }

    return res.status(200).json({
      success: true,
      url: deploymentUrl,
      deployment: apiJson,
    });
  } catch (err) {
    console.error("Deploy API error:", err);
    return res.status(500).json({
      success: false,
      error: "Unexpected error in deploy endpoint",
      details: err.message || String(err),
    });
  }
};
