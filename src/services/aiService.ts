import { Type } from "@google/genai";

export interface AnalysisResult {
  productName: string;
  sellingPoints: { text: string; position: 'tl' | 'tc' | 'tr' | 'rc' | 'br' | 'bc' | 'bl' | 'lc' }[];
  suggestedColor: string;
}

export const analyzeProductImage = async (base64Image: string, userId?: string, toolId?: string): Promise<AnalysisResult> => {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64Image, userId, toolId }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Analysis failed");
  }

  return response.json();
};

export const generateEcommerceImages = async (
  base64Image: string,
  style: string,
  aspectRatio: string,
  resolution: string,
  userId?: string,
  toolId?: string
): Promise<string[]> => {
  const perspectives = ["正面视角", "俯拍视角", "特写视角"];
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      base64Image, 
      style, 
      aspectRatio, 
      resolution, 
      perspectives,
      userId,
      toolId
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Generation failed");
  }

  const data = await response.json();
  return data.images.map((img: any) => img.url);
};
