
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { AnalysisResult, GeneratedSection, ReferenceImage, DouyinSectionType } from "../types";

// Initialize generic client - API Key will be injected via process.env.API_KEY
// which is populated by the window.aistudio selection in App.tsx
const getAiClient = () => {
  if (!process.env.API_KEY) {
    throw new Error("API Key not set");
  }
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export const analyzeProductData = async (
  images: ReferenceImage[],
  name: string,
  features: string,
  language: 'zh' | 'en'
): Promise<AnalysisResult> => {
  const ai = getAiClient();
  
  const targetLanguage = language === 'zh' ? 'Simplified Chinese (简体中文)' : 'English';

  const promptText = `
    Role: Senior Douyin (TikTok) E-commerce Visual Designer & Copywriter.
    Target Audience: ${targetLanguage} speakers.
    Product: ${name}
    Features: ${features}

    YOUR TASK:
    Plan the structure for a "High-Conversion Product Detail Page" (Long Image) based strictly on the following FRAMEWORK.

    FRAMEWORK (8 Modules):
    1. **Impact Header (header_impact)**: Visual shock, Promo info, Coupon. 
    2. **Product Display (product_display)**: High-quality Front or Side angle. Showing the full product cleanly.
    3. **Core Selling Points (selling_point_fabe)**: Use FABE (Feature-Advantage-Benefit-Evidence). Focus on solution.
    4. **Scenario Application (scenario_usage)**: Lifestyle context. Show user using it. 代入感.
    5. **Detail/Craftsmanship (detail_craft)**: Close-up zoom. Texture, material, stitching, quality proof.
    6. **Specs/Size (specs_size)**: Data table, size chart, package list. (Text mainly).
    7. **Trust/Endorsement (trust_endorsement)**: Brand promise, certifications, after-sales, reviews.
    8. **Promotion CTA (promotion_cta)**: Urgency, "Buy Now", final call.

    IMAGE SELECTION RULES:
    I have provided multiple images with IDs. You MUST select the most appropriate 'referenceImageId' for each section.
    - For 'product_display', prefer 'main' labeled images.
    - For 'detail_craft', prefer 'detail' or 'texture' labeled images.
    - For 'scenario_usage', prefer 'usage' labeled images if available, otherwise 'main'.

    OUTPUT REQUIREMENTS:
    - Generate 6-10 sections total.
    - 'imagePrompt': Detailed ENGLISH prompt for Gemini 3 Pro Image Generation. 
       * Include lighting (studio, natural), angle (front, flat lay), and style (C4D, photography).
       * Keep the product identity from the reference image.
    - 'overlayText': 2-5 words, punchy, poster style.
    - 'content': Persuasive sales copy.
  `;

  const parts: any[] = [];
  
  images.forEach(img => {
    parts.push({ text: `Image ID: "${img.id}" - Label: ${img.label}` });
    parts.push({ inlineData: { data: img.base64, mimeType: img.mimeType } });
  });

  parts.push({ text: promptText });

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      refinedTitle: { type: Type.STRING },
      refinedSellingPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
      priceEstimate: { type: Type.STRING },
      marketingTone: { type: Type.STRING },
      sections: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            type: { 
              type: Type.STRING, 
              enum: [
                'header_impact', 
                'product_display', 
                'selling_point_fabe', 
                'scenario_usage', 
                'detail_craft', 
                'specs_size', 
                'trust_endorsement', 
                'promotion_cta'
              ] 
            },
            title: { type: Type.STRING },
            content: { type: Type.STRING },
            overlayText: { type: Type.STRING },
            imagePrompt: { type: Type.STRING },
            referenceImageId: { type: Type.STRING }
          },
          required: ['id', 'type', 'title', 'content', 'overlayText', 'imagePrompt', 'referenceImageId']
        }
      }
    },
    required: ['refinedTitle', 'refinedSellingPoints', 'priceEstimate', 'marketingTone', 'sections']
  };

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: {
      parts: parts
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
      systemInstruction: "You are a specialized e-commerce content strategist. Generate strict JSON output."
    }
  });

  if (!response.text) throw new Error("No analysis generated");
  return JSON.parse(response.text) as AnalysisResult;
};

export const generateProductImage = async (
  referenceImageBase64: string,
  referenceMimeType: string,
  prompt: string
): Promise<string> => {
  const ai = getAiClient();

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: {
        parts: [
          {
            inlineData: {
              data: referenceImageBase64,
              mimeType: referenceMimeType,
            },
          },
          {
            text: `Generate a high-quality e-commerce image.
            CONTEXT: ${prompt}
            CONSTRAINT: The main product from the reference image MUST appear clearly.
            ASPECT RATIO: 1:1 or 3:4.
            STYLE: Commercial photography, high resolution, sharp details.` 
          },
        ],
      },
      config: {
        imageConfig: {
            aspectRatio: "1:1",
            imageSize: "2K"
        }
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    throw new Error("No image data in response");

  } catch (error) {
    console.error("Image generation failed", error);
    throw error;
  }
};
