// api/deploy.js
const { Redis } = require("@upstash/redis");

// Init Redis pakai env Upstash
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Helper: baca body JSON sendiri (jangan percaya req.body)
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
    // ⬇️ baca body beneran dari request
    const body = await readJsonBody(req);
    const { projectName, files } = body || {};

    // Validasi basic
    if (!projectName || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: "projectName & files wajib diisi",
      });
    }

    // Wajib ada index.html
    const hasIndex = files.some(
      (f) => f.name && f.name.toLowerCase() === "index.html"
    );
    if (!hasIndex) {
      return res.status(400).json({
        success: false,
        error: "File index.html tidak ditemukan di payload.",
      });
    }

    const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
    if (!VERCEL_TOKEN) {
      return res.status(500).json({
        success: false,
        error: "VERCEL_TOKEN belum diset di Environment Variables.",
      });
    }

    const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || undefined;

    // Siapkan payload files untuk API Vercel
    const filesForVercel = files.map((f) => ({
      file: f.name,
      data: f.content, // sudah base64 dari frontend
      encoding: "base64",
    }));

    const url = new URL("https://api.vercel.com/v13/deployments");
    if (VERCEL_TEAM_ID) {
      url.searchParams.set("teamId", VERCEL_TEAM_ID);
    }

    const deployBody = {
      name: projectName,
      files: filesForVercel,
      projectSettings: {
        framework: null,
        outputDirectory: null,
      },
    };

    // Panggil Vercel API
    const apiRes = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(deployBody),
    });

    const apiJson = await apiRes.json().catch(() => ({}));

    if (!apiRes.ok) {
      return res.status(apiRes.status).json({
        success: false,
        error:
          (apiJson &&
            apiJson.error &&
            (apiJson.error.message || apiJson.error.code)) ||
          apiJson.message ||
          "Failed to deploy to Vercel",
        details: apiJson,
      });
    }

    // deployment URL (Vercel ngembaliin "url" tanpa https)
    const deploymentUrl = apiJson.url
      ? apiJson.url.startsWith("http")
        ? apiJson.url
        : `https://${apiJson.url}`
      : null;

    // Simpan ke history di Redis (best-effort)
    try {
      const historyItem = {
        projectName,
        url: deploymentUrl,
        fileCount: files.length,
        time: Date.now(),
      };

      await redis.lpush("deploy_history", JSON.stringify(historyItem));
      await redis.ltrim("deploy_history", 0, 49);
    } catch (err) {
      console.error("Failed to write deploy history:", err);
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
