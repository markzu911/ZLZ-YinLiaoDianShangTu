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
        body: (req.method === "POST" || req.method === "PUT") ? JSON.stringify(req.body) : undefined,
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  // 1.5 Image Proxy
  if (url.startsWith("/api/image-proxy")) {
    try {
      const queryParams = new URL(url, "http://localhost").searchParams;
      const targetUrl = queryParams.get("url");

      if (!targetUrl) {
        return res.status(400).json({ message: "Missing url parameter" });
      }

      const urlObj = new URL(targetUrl);

      // Simple safety check
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return res.status(400).json({ message: "Invalid protocol" });
      }

      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      if (!response.ok) {
        return res.status(response.status).json({ message: `Image fetch failed: ${response.statusText}` });
      }

      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get("content-type") || "image/png";

      res.setHeader("Content-Type", contentType);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.status(200).send(Buffer.from(buffer));
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
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
      try {
        const parsed = JSON.parse(text);
        // Ensure minimal structure
        if (!parsed.productName) parsed.productName = "饮品";
        if (!parsed.sellingPoints) parsed.sellingPoints = [];
        if (!parsed.suggestedColor) parsed.suggestedColor = "#FFFFFF";
        return res.json(parsed);
      } catch (e) {
        return res.json({
          productName: "饮品",
          sellingPoints: [],
          suggestedColor: "#FFFFFF"
        });
      }
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  if (url === "/api/generate-one") {
    const { base64Image, style, aspectRatio, resolution, perspective, userId, toolId } = req.body;
    try {
      const verifyData = await saasFetch("/api/tool/verify", {
        method: "POST",
        body: JSON.stringify({ userId, toolId }),
      });

      if (verifyData.success === false) {
        return res.status(403).json(verifyData);
      }

      const p = perspective;
      let promptPrefix = "";
      if (style === '现代简约') {
        let perspectiveDetail = "";
        if (p === "正面视角") {
          perspectiveDetail = `视角特征：正面构图，机位略微俯视...`;
        } else if (p === "特写视角") {
          perspectiveDetail = `视角特征：极近距离微距视角，焦点对准瓶身标签与液滴。背景极度虚化（Bokeh），呈现柔和的自然光影。画面干净，强调材质的通透感与清爽感。`;
        } else {
          perspectiveDetail = `视角特征：饮料平躺在地上，俯拍饮料`;
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

      if (!generatedBase64) {
        return res.status(500).json({ success: false, message: "AI failed to generate image" });
      }

      // Consume and Upload steps
      await saasFetch("/api/tool/consume", {
        method: "POST",
        body: JSON.stringify({ userId, toolId }),
      });

      const buffer = Buffer.from(generatedBase64, 'base64');
      const tokenData = await saasFetch("/api/upload/direct-token", {
        method: "POST",
        body: JSON.stringify({
          userId, toolId, source: "beverage-ecommerce-result", mimeType: "image/png", fileName: `result_${p}.png`, fileSize: buffer.byteLength
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
          userId, toolId, source: "beverage-ecommerce-result", objectKey: tokenData.objectKey, fileSize: buffer.byteLength
        }),
      });

      const resultImage = commitData.image || commitData;
      return res.json({ 
        success: true, 
        image: resultImage,
        imageUrl: resultImage.url 
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  res.status(404).json({ message: "Not Found" });
}
