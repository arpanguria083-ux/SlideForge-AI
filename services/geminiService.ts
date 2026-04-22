import { GoogleGenAI, Type } from "@google/genai";
import { SlideAnalysis } from "../types";

const getGeminiClient = (): GoogleGenAI => {
  const configuredApiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (!configuredApiKey) {
    throw new Error('VITE_GEMINI_API_KEY is not configured for frontend Gemini service.');
  }
  return new GoogleGenAI({ apiKey: configuredApiKey });
};

const SYSTEM_PROMPT = `
You are SlideForge AI, an elite Consulting Deck Evaluator. 
Your task is to analyze business presentation slides (images) and provide a structured JSON assessment.
You emulate a "Council of Agents" including a Chairman (Strategy), Storyteller (Narrative), Data Auditor (Accuracy), and Designer (Visuals).

For the image provided, generate a JSON response with the following structure:
1. title: The slide title.
2. summary: A brief 1-sentence summary of the content.
3. overallScore: An integer 0-100 based on MBB (McKinsey/Bain/BCG) standards.
4. density: "Low", "Medium", or "High" based on text/data density.
5. visuals: An array of detected visual elements (charts, icons, images). For each, provide 'top', 'left', 'width', 'height' as percentages (0-100) and a 'label'.
6. fixes: An array of specific areas needing improvement (e.g., "Misaligned footer", "Unclear axis"). Provide bbox percentages and a label.
7. councilDebate: An array of exactly 4 comments from these personas: "Chairman", "Storyteller", "Data Auditor", "Designer". Each comment should have:
   - persona: string
   - text: specific critique or praise
   - sentiment: "positive", "neutral", "negative", or "critical"
   - score: 0-10 rating from that persona's perspective.
8. frameworkDetected: Name of any strategy framework detected (e.g., "SWOT", "Porter's 5 Forces") or null.
9. citationIssues: Array of strings listing any missing or malformed citations.

Ensure the Bounding Boxes (top, left, width, height) are roughly accurate estimates based on the image layout.
`;

// Helper to convert file to base64
const fileToGenerativePart = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      // Remove data url prefix (e.g. "data:image/jpeg;base64,")
      const base64Content = base64String.split(',')[1];
      resolve(base64Content);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export const analyzeSlideImage = async (file: File): Promise<SlideAnalysis> => {
  try {
    const ai = getGeminiClient();
    const base64Data = await fileToGenerativePart(file);

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", 
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: file.type,
              data: base64Data
            }
          },
          {
            text: SYSTEM_PROMPT
          }
        ]
      },
      config: {
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        // Using a loose schema definition to guide the model but allow flexibility in inner objects
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                title: { type: Type.STRING },
                summary: { type: Type.STRING },
                overallScore: { type: Type.INTEGER },
                density: { type: Type.STRING },
                visuals: { 
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            top: { type: Type.NUMBER },
                            left: { type: Type.NUMBER },
                            width: { type: Type.NUMBER },
                            height: { type: Type.NUMBER },
                            label: { type: Type.STRING }
                        }
                    }
                },
                fixes: { 
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            top: { type: Type.NUMBER },
                            left: { type: Type.NUMBER },
                            width: { type: Type.NUMBER },
                            height: { type: Type.NUMBER },
                            label: { type: Type.STRING }
                        }
                    }
                },
                councilDebate: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            persona: { type: Type.STRING },
                            text: { type: Type.STRING },
                            sentiment: { type: Type.STRING },
                            score: { type: Type.NUMBER }
                        }
                    }
                },
                frameworkDetected: { type: Type.STRING },
                citationIssues: { 
                    type: Type.ARRAY, 
                    items: { type: Type.STRING } 
                }
            }
        }
      }
    });

    let text = response.text;
    if (!text) throw new Error("No response from Gemini");

    text = text.trim();
    if (text.startsWith("```json")) {
      text = text.substring(7);
    } else if (text.startsWith("```")) {
      text = text.substring(3);
    }
    if (text.endsWith("```")) {
      text = text.substring(0, text.length - 3);
    }
    text = text.trim();
    if (!text) throw new Error("Empty response from Gemini after trimming");

    let analysisData;
    try {
      analysisData = JSON.parse(text);
    } catch (e) {
      console.error("Failed to parse JSON. Raw text:", text);
      // Attempt to fix truncated JSON by appending closing brackets
      try {
        analysisData = JSON.parse(text + '}');
      } catch (e2) {
        try {
          analysisData = JSON.parse(text + ']}');
        } catch (e3) {
          console.warn("Could not salvage JSON, returning fallback analysis.");
          analysisData = {
            title: "Analysis Failed",
            summary: "The AI model returned an incomplete or invalid response.",
            overallScore: 0,
            density: "Medium",
            visuals: [],
            fixes: [],
            councilDebate: [],
            frameworkDetected: null,
            citationIssues: []
          };
        }
      }
    }
    
    // Explicitly sanitize inputs to prevent "undefined reading length" errors in UI
    return {
      id: crypto.randomUUID(),
      title: analysisData.title || "Untitled Slide",
      summary: analysisData.summary || "No analysis available.",
      overallScore: typeof analysisData.overallScore === 'number' ? analysisData.overallScore : 0,
      density: analysisData.density || "Medium",
      visuals: Array.isArray(analysisData.visuals) ? analysisData.visuals : [],
      fixes: Array.isArray(analysisData.fixes) ? analysisData.fixes : [],
      councilDebate: Array.isArray(analysisData.councilDebate) ? analysisData.councilDebate : [],
      frameworkDetected: analysisData.frameworkDetected || null,
      citationIssues: Array.isArray(analysisData.citationIssues) ? analysisData.citationIssues : []
    };

  } catch (error) {
    console.error("Error analyzing slide:", error);
    // Return a fallback/mock if API fails or key is missing for demo purposes,
    // though in production we would throw.
    throw error;
  }
};
