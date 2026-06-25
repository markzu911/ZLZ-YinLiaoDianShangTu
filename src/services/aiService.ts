import { Type } from "@google/genai";

export interface AnalysisResult {
  productName: string;
  sellingPoints: { text: string; position: 'tl' | 'tc' | 'tr' | 'rc' | 'br' | 'bc' | 'bl' | 'lc' }[];
  suggestedColor: string;
}

async function requestWithBetterErrorHandling(url: string, options: any) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    data = { message: text.slice(0, 300) };
  }

  if (response.status === 504) {
    throw new Error("图片可能已生成，请刷新我的图片（Gateway Timeout）");
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.message || data.error || `请求失败: ${response.status}`);
  }

  return data;
}

export const launchTool = async (userId: string, toolId: string): Promise<any> => {
  return requestWithBetterErrorHandling("/api/tool/launch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, toolId }),
  });
};

export const verifyTool = async (userId: string, toolId: string): Promise<any> => {
  return requestWithBetterErrorHandling("/api/tool/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, toolId }),
  });
};

export const consumeTool = async (userId: string, toolId: string): Promise<any> => {
  return requestWithBetterErrorHandling("/api/tool/consume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, toolId }),
  });
};

/**
 * Standard SaaS upload flow: Token -> PUT -> Commit
 */
export const uploadToSaas = async (
  base64Image: string,
  userId: string,
  toolId: string,
  source: string = "result",
  fileName: string = `result_${Date.now()}.png`
): Promise<string> => {
  // 1. Get Direct Token
  // Note: We'll call a helper endpoint in our proxy to avoid complex frontend logic
  // or proxy it step by step if we prefer. 
  // Let's assume the backend has a /api/proxy-upload to simplify.
  const data = await requestWithBetterErrorHandling("/api/proxy-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64Image, userId, toolId, source, fileName }),
  });
  
  return data.imageUrl || data.image?.url;
};

export const analyzeProductImage = async (base64Image: string, userId?: string, toolId?: string): Promise<AnalysisResult> => {
  return requestWithBetterErrorHandling("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64Image, userId, toolId }),
  });
};

export const generateOneEcommerceImage = async (
  base64Image: string,
  style: string,
  aspectRatio: string,
  resolution: string,
  perspective: string,
  userId?: string,
  toolId?: string
): Promise<string> => {
  const data = await requestWithBetterErrorHandling("/api/generate-one", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      base64Image, 
      style, 
      aspectRatio, 
      resolution, 
      perspective,
      userId,
      toolId
    }),
  });

  return data.imageUrl || data.image?.url;
};

export const generateEcommerceImages = async (
  base64Image: string,
  style: string,
  aspectRatio: string,
  resolution: string,
  userId?: string,
  toolId?: string,
  onImageGenerated?: (url: string, index: number) => void
): Promise<string[]> => {
  const perspectives = ["正面视角", "俯拍视角", "特写视角"];
  const urls: string[] = [];
  
  for (let i = 0; i < perspectives.length; i++) {
    try {
      const url = await generateOneEcommerceImage(
        base64Image,
        style,
        aspectRatio,
        resolution,
        perspectives[i],
        userId,
        toolId
      );
      urls.push(url);
      if (onImageGenerated) {
        onImageGenerated(url, i);
      }
    } catch (err) {
      console.error(`Perspective ${perspectives[i]} failed`, err);
      // Even if one fails, we continue if possible, or throw if essential
      // For now, let's just re-throw to stop the sequence if a core failure occurs
      throw err;
    }
  }

  return urls;
};

export const fetchSaasImages = async (userId: string, toolId?: string, source?: string): Promise<any[]> => {
  let url = `/api/upload/image?userId=${userId}`;
  if (toolId) url += `&toolId=${toolId}`;
  if (source) url += `&source=${source}`;
  
  const data = await requestWithBetterErrorHandling(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  return data.data || [];
};
