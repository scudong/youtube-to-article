import { GoogleGenAI, Type } from '@google/genai';

const ALLOWED_MODELS = ['gemini-2.5-pro', 'gemini-2.5-flash'] as const;
type ModelId = (typeof ALLOWED_MODELS)[number];

export function validateModel(model: string): ModelId {
  if (ALLOWED_MODELS.includes(model as ModelId)) return model as ModelId;
  return 'gemini-2.5-pro';
}

export async function* streamGenerate(
  apiKey: string,
  model: string,
  prompt: string,
): AsyncGenerator<string> {
  const ai = new GoogleGenAI({ apiKey });
  const stream = await ai.models.generateContentStream({
    model,
    contents: prompt,
    config: {
      maxOutputTokens: 8192,
      temperature: 0.7,
    },
  });
  for await (const chunk of stream) {
    const text = chunk.text;
    if (text) yield text;
  }
}

const FIVE_WH_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    who: { type: Type.STRING, description: '主要涉及的人/角色' },
    what: { type: Type.STRING, description: '事件/内容主题' },
    when: { type: Type.STRING, description: '时间背景' },
    where: { type: Type.STRING, description: '发生场景/位置' },
    why: { type: Type.STRING, description: '原因/动机' },
    how: { type: Type.STRING, description: '方式/过程' },
  },
  required: ['who', 'what', 'when', 'where', 'why', 'how'],
} as const;

export interface FiveWHResult {
  who: string;
  what: string;
  when: string;
  where: string;
  why: string;
  how: string;
}

export async function generateStructured(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<FiveWHResult> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: FIVE_WH_SCHEMA,
    },
  });
  return JSON.parse(response.text ?? '{}') as FiveWHResult;
}
