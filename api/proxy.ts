import { GoogleGenAI } from "@google/genai";

const SAAS_ORIGIN = "http://aibigtree.com";

export default async function handler(req: any, res: any) {
  // CORS support
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const url = req.url || "";

  // 1. Proxy SaaS Tool Routes
  if (url.startsWith("/api/tool/") || url.startsWith("/api/upload/")) {
    try {
      const saasUrl = `${SAAS_ORIGIN}${url}`;
      const response = await fetch(saasUrl, {
        method: req.method,
        headers: {
          "Content-Type": "application/json",
          ...req.headers,
          host: new URL(SAAS_ORIGIN).host, // Ensure correct host header
        },
        body: req.method === "POST" ? JSON.stringify(req.body) : undefined,
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  // 2. Gemini API Logic
  const genAI = new GoogleGenAI({ 
    apiKey: process.env.GEMINI_API_KEY || "",
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  // Helper for SaaS requests (integration check)
  async function saasFetch(endpoint: string, options: any) {
    const response = await fetch(`${SAAS_ORIGIN}${endpoint}`, {
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
    return data;
  }

  if (url === "/api/analyze" || url === "/api/gemini") {
    const { base64Image, userId, toolId } = req.body;
    try {
      // Logic from server.ts
      const verifyData = await saasFetch("/api/tool/verify", {
        method: "POST",
        body: JSON.stringify({ userId, toolId }),
      });

      if (verifyData.success === false) {
        return res.status(403).json(verifyData);
      }

      const result = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
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
      return res.json(JSON.parse(text));
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  if (url === "/api/generate") {
    const { base64Image, style, aspectRatio, resolution, perspectives, userId, toolId } = req.body;
    try {
      const verifyData = await saasFetch("/api/tool/verify", {
        method: "POST",
        body: JSON.stringify({ userId, toolId }),
      });

      if (verifyData.success === false) {
        return res.status(403).json(verifyData);
      }

      const results = [];
      for (const p of perspectives) {
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
          // 模特氛围
          let pDetail = p === "特写视角" ? "侧面特写，模特正在侧脸饮用..." : "竖构图，优雅女性中景...";
          promptPrefix = `这是一张针对饮品的时尚高端电商大片。人物解剖正确，无多掌。如果原图无吸管，生成的画面也绝对严禁出现吸管。视角：${pDetail}`;
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
            // @ts-ignore
            imageConfig: {
              aspectRatio: aspectRatio as any,
            }
          }
        });

        let generatedBase64 = "";
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            generatedBase64 = part.inlineData.data;
            break;
          }
        }


        if (!generatedBase64) continue;

        // Consume and Upload steps
        await saasFetch("/api/tool/consume", {
          method: "POST",
          body: JSON.stringify({ userId, toolId }),
        });

        const buffer = Buffer.from(generatedBase64, 'base64');
        const tokenData = await saasFetch("/api/upload/direct-token", {
          method: "POST",
          body: JSON.stringify({
            userId, toolId, source: "result", mimeType: "image/png", fileName: `result_${p}.png`, fileSize: buffer.byteLength
          }),
        });

        await fetch(tokenData.uploadUrl, {
          method: "PUT",
          headers: tokenData.headers || { "Content-Type": "image/png" },
          body: buffer
        });

        const commitData = await saasFetch("/api/upload/commit", {
          method: "POST",
          body: JSON.stringify({
            userId, toolId, source: "result", objectKey: tokenData.objectKey, fileSize: buffer.byteLength
          }),
        });

        results.push(commitData.image || commitData);
      }

      return res.json({ success: true, images: results });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  res.status(404).json({ message: "Not Found" });
}
