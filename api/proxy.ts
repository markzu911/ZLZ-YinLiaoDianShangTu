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

      // NO decodeURIComponent(targetUrl) here, because searchParams.get() already decodes it once.
      const urlObj = new URL(targetUrl);

      // Simple safety check
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return res.status(400).json({ message: "Invalid protocol" });
      }

      console.log('Proxying image:', targetUrl);

      const response = await fetch(targetUrl, {
        headers: {
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) {
        console.error('Proxy fetch failed:', response.status, response.statusText, 'for', targetUrl);
        return res.status(response.status).json({ message: `Image fetch failed: ${response.statusText}`, status: response.status });
      }

      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get("content-type") || "image/png";

      res.setHeader("Content-Type", contentType);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=86400");
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

  // Helper to handle the 3-step SaaS upload
  async function performSaasUpload(base64Image: string, userId: string, toolId: string, source: string, fileName: string) {
    const buffer = Buffer.from(base64Image.split(',')[1] || base64Image, 'base64');
    
    // 1. Token
    const tokenData = await saasFetch("/api/upload/direct-token", {
      method: "POST",
      body: JSON.stringify({
        userId, toolId, source, mimeType: "image/png", fileName, fileSize: buffer.byteLength
      }),
    });

    if (!tokenData.uploadUrl) throw new Error("Failed to get upload URL from SaaS: " + JSON.stringify(tokenData));

    // 2. PUT
    const uploadResponse = await fetch(tokenData.uploadUrl, {
      method: "PUT",
      headers: tokenData.headers || { "Content-Type": "image/png" },
      body: buffer
    });

    if (!uploadResponse.ok) throw new Error("Failed to upload to storage: " + uploadResponse.statusText);

    // 3. Commit
    const commitData = await saasFetch("/api/upload/commit", {
      method: "POST",
      body: JSON.stringify({
        userId, toolId, source, objectKey: tokenData.objectKey, fileSize: buffer.byteLength
      }),
    });

    return commitData;
  }

  // Convenience endpoint for frontend to upload in one step
  if (url === "/api/proxy-upload") {
    const { base64Image, userId, toolId, source, fileName } = req.body;
    try {
      const result = await performSaasUpload(base64Image, userId, toolId, source || "beverage-ecommerce-source", fileName || "source.png");
      const resultImage = result.image || result;
      return res.json({ 
        success: true, 
        image: resultImage,
        imageUrl: resultImage.url 
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
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
        if (perspective === "正面视角") {
          perspectiveDetail = `
          视角特征：正面构图。
          布局：将原始图片中的饮品产品放置在画面【左侧】，瓶身自然地倾斜【靠在】左侧堆叠的三个青苹果上。
          留白：画面【右侧】保持大面积简洁留白，以便后续添加文字介绍。`;
        } else if (perspective === "特写视角") {
          perspectiveDetail = `
          视角特征：极近距离特写，瓶身呈对角线【倾斜】姿态。
          画面元素：仅保留饮品主体。背景中充满晶莹剔透、动感十足的【水花喷溅】效果。
          细节：瓶身表面布满密集的、清晰可见的【新鲜水珠】，体现极强的冰镇感。不需要青苹果。`;
        } else {
          perspectiveDetail = `
          视角特征：俯拍视角（Flat Lay）。
          布局：饮品产品与青苹果自然散落在背景画布上。`;
        }

        promptPrefix = `这是一张针对饮品的电商广告图。风格必须严格遵循“现代简约广告风格”。
        场景特征描述：
        1. 视角与布局：${perspectiveDetail}
        2. 背景与氛围：背景采用渐变的浅绿色，由深转浅，营造干净、清爽、健康的感觉。
        3. 细节与光效：光源来自左上方，产生柔和的高光。画面整体色调以青绿色、黄色为主。`;
      } else if (style === '奢华高级') {
        promptPrefix = `这是一张针对饮品的高端电商图。风格定位为“奢华高级感”，背景为深红色渐变。
        场景特征描述：
        1. 构图与机位：竖构图，机位略微偏低，仰视角度，使产品显得高大挺拔。透视效果明显，体现立体感。
        2. 主体整合：将原始图片中的饮品产品无缝融入画面中央。产品表面应有光滑的质感和亮丽的高光反射。
        3. 辅助元素：画面中缠绕着几条深红色的丝带，丝带带有细微织物纹理，表面印有金色的品牌字样。丝带以动态的方式盘旋环绕在产品周围，增加画面的层次感和动感。
        4. 背景与氛围：纯粹的、深红色的渐变背景，从画面中心向四周逐渐变深，营造出深邃感、神秘感和聚焦感。
        5. 光影：光源来自上方偏左前方，光线柔和且有方向性，在产品侧面形成明显的高光点。色温偏暖，色调以深红、金色为主。`;
      } else {
        // 模特氛围
        let pDetail = "";
        if (perspective === "特写视角") {
          pDetail = "侧面特写，镜头聚焦于红唇与产品边缘，通过浅景深营造梦幻感";
        } else if (perspective === "正面视角") {
          pDetail = "正面半身构图，人物姿态优雅平衡";
        } else {
          pDetail = "中景构图，展现电影感十足的画面布局";
        }

        promptPrefix = `这是一张针对饮品的时尚高端电商大片。风格定位为“现代时尚广告”，营造神秘、优雅且高级的质感。
        场景特征描述：
        1. 构图与人物：${pDetail}，画面中心是一位优雅女性，头戴墨绿色宽檐帽（遮住上半脸，仅露出饱和度极高的红唇），佩戴白色珍珠耳钉，身着深红色露肩纹理毛衣。
        2. 人物要求：人物解剖结构必须精准正确，严格禁止出现多只手或畸形肢体。
        3. 主体整合：将原始图片中的饮品产品自然整合。如果原始图片中没有【吸管】，则生成的画面中【绝对严禁出现吸管】。
        4. 背景与色彩：背景为纯粹、无纹理的深红色，营造出浓郁的视觉冲击力。`;
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
      const consumeData = await saasFetch("/api/tool/consume", {
        method: "POST",
        body: JSON.stringify({ userId, toolId }),
      });

      if (!consumeData.success) {
        return res.status(403).json({ success: false, message: consumeData.message || "扣费失败" });
      }

      try {
        const commitData = await performSaasUpload(generatedBase64, userId, toolId, "beverage-ecommerce-result", `result_${p}.png`);
        const resultImage = commitData.image || commitData;
        return res.json({ 
          success: true, 
          image: resultImage,
          imageUrl: resultImage.url 
        });
      } catch (uploadError: any) {
         // Even if upload failed here, the image was generated. 
         // But since we didn't return it yet, we just return the error.
         console.error("Upload after generation failed", uploadError);
         return res.status(500).json({ success: false, message: "图片已生成但保存失败，请稍后刷新尝试找回: " + uploadError.message });
      }
    } catch (error: any) {
      const errorMsg = error.message || "";
      if (errorMsg.includes("fetch failed") || errorMsg.includes("timeout")) {
        return res.status(504).json({ success: false, message: "网关超时：图片可能已生成，请刷新历史记录尝试查看。" });
      }
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  res.status(404).json({ message: "Not Found" });
}
