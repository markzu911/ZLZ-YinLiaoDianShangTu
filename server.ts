import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;
const SAAS_ORIGIN = process.env.SAAS_ORIGIN || "https://api.example-saas.com";

app.use(express.json({ limit: '50mb' }));

// Helper for SaaS requests
async function saasFetch(endpoint: string, options: any) {
  const url = `${SAAS_ORIGIN}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    data = { error: text.slice(0, 300) };
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.message || `SaaS Request Failed: ${response.status}`);
  }
  return data;
}

// Proxy routes for SaaS
app.post("/api/tool/launch", async (req, res) => {
  try {
    const data = await saasFetch("/api/tool/launch", {
      method: "POST",
      body: JSON.stringify(req.body),
    });
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/tool/verify", async (req, res) => {
  try {
    const data = await saasFetch("/api/tool/verify", {
      method: "POST",
      body: JSON.stringify(req.body),
    });
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// AI Logic
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

app.post("/api/analyze", async (req, res) => {
  const { base64Image, userId, toolId } = req.body;
  try {
    // 1. Verify integral first (workflow step 2)
    await saasFetch("/api/tool/verify", {
      method: "POST",
      body: JSON.stringify({ userId, toolId }),
    });

    const result = await genAI.models.generateContent({
      model: "gemini-1.5-flash",
      contents: {
        role: "user",
        parts: [
          { inlineData: { mimeType: "image/png", data: base64Image.split(',')[1] || base64Image } },
          { text: "Identify the product in this image and suggest how to place marketing text around it on an e-commerce background. Provide: 1. productName, 2. 3 sellingPoints with positions ('tl', 'tc', 'tr', 'rc', 'br', 'bc', 'bl', 'lc'), 3. suggestedColor (hex). Return ONLY JSON." }
        ]
      },
      config: {
        responseMimeType: "application/json",
      }
    });

    const text = result.text;
    res.json(JSON.parse(text));
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/generate", async (req, res) => {
  const { base64Image, style, aspectRatio, resolution, perspectives, userId, toolId } = req.body;
  
  try {
    // 1. Verify integral
    await saasFetch("/api/tool/verify", {
      method: "POST",
      body: JSON.stringify({ userId, toolId }),
    });

    const results = [];

    // For simplicity, we process each perspective
    for (const p of perspectives) {
      // Prompt logic from aiService.ts
      let promptPrefix = "";
      if (style === '现代简约') {
        let perspectiveDetail = "";
        if (p === "正面视角") {
          perspectiveDetail = `视角特征：正面构图，机位略微俯视...`;
        } else if (p === "特写视角") {
          perspectiveDetail = `视角特征：极近距离特写...`;
        } else {
          perspectiveDetail = `视角特征：俯拍视角...`;
        }
        promptPrefix = `这是一张针对饮品的电商广告图... ${perspectiveDetail}`;
      } else if (style === '奢华高级') {
        promptPrefix = `这是一张针对饮品的高端电商图... 视角：${p}`;
      } else {
        promptPrefix = `这是一张针对饮品的时尚高端电商大片... 视角：${p}`;
      }

      const prompt = `${promptPrefix} 请务必保持原始图像中产品的基本形状和标签设计。输出应是一张高密度渲染背景图。`;
      
      const response = await genAI.models.generateContent({
        model: "gemini-3.1-flash-image-preview",
        contents: {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/png", data: base64Image.split(',')[1] || base64Image } },
            { text: prompt }
          ]
        },
        config: {
          imageConfig: {
            aspectRatio: aspectRatio as any,
          }
        }
      });

      // Extract image data
      let generatedBase64 = "";
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          generatedBase64 = part.inlineData.data;
          break;
        }
      }

      if (!generatedBase64) throw new Error("AI failed to generate image");

      // SPEC WORKFLOW: Step 5-9
      // 5. Consume
      await saasFetch("/api/tool/consume", {
        method: "POST",
        body: JSON.stringify({ userId, toolId }),
      });

      const buffer = Buffer.from(generatedBase64, 'base64');
      
      // 6. Direct Token
      const tokenData = await saasFetch("/api/upload/direct-token", {
        method: "POST",
        body: JSON.stringify({
          userId,
          toolId,
          source: "result",
          mimeType: "image/png",
          fileName: `result_${p}.png`,
          fileSize: buffer.byteLength
        }),
      });

      // 7. PUT to OSS
      const ossRes = await fetch(tokenData.uploadUrl, {
        method: "PUT",
        headers: tokenData.headers || { "Content-Type": "image/png" },
        body: buffer
      });

      if (!ossRes.ok) throw new Error("OSS upload failed");

      // 8. Commit
      const commitData = await saasFetch("/api/upload/commit", {
        method: "POST",
        body: JSON.stringify({
          userId,
          toolId,
          source: "result",
          objectKey: tokenData.objectKey,
          fileSize: buffer.byteLength
        }),
      });

      results.push(commitData.image || commitData);
    }

    res.json({ success: true, images: results });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
});

async function startServer() {
  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
