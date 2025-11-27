// api/deploy.js
// Serverless Function untuk Vercel
// Terima JSON: { projectName, files: [{ name, content(base64) }, ...] }
// Lalu kirim ke Vercel Deployments API + simpan history ke KV

const { kv } = require("@vercel/kv");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.json({ error: "Method not allowed" });
  }

  const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
  const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || undefined;

  if (!VERCEL_TOKEN) {
    res.statusCode = 500;
    return res.json({ error: "VERCEL_TOKEN is not set" });
  }

  try {
    // Baca body mentah (karena ini handler low-level)
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString("utf8") || "{}";

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch (e) {
      res.statusCode = 400;
      return res.json({ error: "Invalid JSON body" });
    }

    const { projectName, files } = body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      res.statusCode = 400;
      return res.json({ error: "No files provided" });
    }

    const hasIndex = files.some(
      (f) => f.name && f.name.toLowerCase() === "index.html"
    );
    if (!hasIndex) {
      res.statusCode = 400;
      return res.json({
        error: "index.html tidak ditemukan di file yang dikirim",
      });
    }

    const safeProjectName =
      (projectName || "deployer-app")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "deployer-app";

    const url = new URL("https://api.vercel.com/v13/deployments");
    if (VERCEL_TEAM_ID) url.searchParams.set("teamId", VERCEL_TEAM_ID);

    const filesPayload = files.map((f) => ({
      file: f.name,
      data: f.content,
      encoding: "base64",
    }));

    const payload = {
      name: safeProjectName,
      files: filesPayload,
      projectSettings: {
        framework: null,
      },
    };

    const vercelRes = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await vercelRes.json();

    if (!vercelRes.ok) {
      console.error("Vercel error:", data);
      res.statusCode = 500;
      return res.json({
        error: "Vercel API error",
        details: data,
      });
    }

    const deployedUrl = data?.url ? `https://${data.url}` : null;

    // === SIMPAN HISTORY KE VERCEL KV ===
    try {
      const historyItem = {
        projectName: safeProjectName,
        url: deployedUrl,
        time: Date.now(),
        fileCount: files.length,
      };
      await kv.lpush("deploy-history", JSON.stringify(historyItem));
      await kv.ltrim("deploy-history", 0, 49); // simpan 50 terakhir
    } catch (e) {
      console.error("Error saving history to KV:", e);
      // jangan matiin response walau history gagal
    }

    res.statusCode = 200;
    return res.json({
      success: true,
      url: deployedUrl,
      deploymentId: data?.id || null,
      raw: data,
    });
  } catch (err) {
    console.error("Internal error:", err);
    res.statusCode = 500;
    return res.json({
      error: "Internal error",
      details: err.message || String(err),
    });
  }
};
