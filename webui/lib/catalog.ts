export type FieldValue = string | number | boolean;

export type FieldType = "text" | "textarea" | "number" | "checkbox" | "url" | "select";

export interface ModelField {
  name: string;
  label: string;
  type: FieldType;
  value?: string;
  checked?: boolean;
  options?: string[];
  required?: boolean;
  span?: "full";
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}

export interface Model {
  id: string;
  name: string;
  vendor: string;
  modality: string;
  path: string;
  fields: ModelField[];
}

export const catalog: Model[] = [
  {
    id: "qwen3-8-27b",
    name: "Qwen 3.8 27B",
    vendor: "Qwen",
    modality: "Chat",
    path: "/v1/chat/completions",
    fields: [
      { name: "system", label: "System prompt", type: "textarea", value: "You are a helpful assistant." },
      { name: "prompt", label: "User message", type: "textarea", value: "Explain inference APIs in three concise bullet points.", required: true },
      { name: "temperature", label: "Temperature", type: "number", value: "0.7", min: 0, max: 2, step: 0.1 },
      { name: "max_tokens", label: "Max tokens", type: "number", value: "1024", min: 1, step: 1 },
      { name: "stream", label: "Stream response", type: "checkbox", checked: true },
    ],
  },
  {
    id: "qwen-image-2-1",
    name: "Qwen Image 2.1",
    vendor: "Qwen",
    modality: "Image",
    path: "/v1/images/generations",
    fields: [
      { name: "prompt", label: "Prompt", type: "textarea", value: "A minimalist product photo of a ceramic coffee cup on a linen surface.", required: true },
      { name: "size", label: "Size", type: "select", value: "1024x1024", options: ["1024x1024", "1280x720", "720x1280"] },
      { name: "steps", label: "Steps", type: "number", value: "25", min: 1, max: 100, step: 1 },
      { name: "guidance", label: "Guidance scale", type: "number", value: "7", min: 0, max: 20, step: 0.1 },
    ],
  },
  {
    id: "yue2-3b",
    name: "YuE 2 3B",
    vendor: "m-a.p",
    modality: "Music",
    path: "/v1/audio/generations",
    fields: [
      { name: "prompt", label: "Prompt", type: "textarea", value: "Warm lo-fi hip-hop with soft drums and vinyl crackle.", required: true },
      { name: "style", label: "Style", type: "text", value: "instrumental" },
      { name: "duration", label: "Duration (seconds)", type: "number", value: "30", min: 1, max: 300, step: 1 },
    ],
  },
  {
    id: "minimax-h3-singularity",
    name: "Minimax H3 Singularity",
    vendor: "WarmBloodAban",
    modality: "Video",
    path: "/v1/videos/generations",
    fields: [
      { name: "prompt", label: "Prompt", type: "textarea", value: "Slow cinematic camera orbit around the subject.", required: true },
      { name: "image_url", label: "Start image URL", type: "url", value: "https://example.com/start-image.jpg", required: true },
      { name: "duration", label: "Duration (seconds)", type: "number", value: "5", min: 1, max: 30, step: 1 },
    ],
  },
  {
    id: "glm-ocr",
    name: "GLM OCR",
    vendor: "zai-org",
    modality: "OCR",
    path: "/v1/ocr",
    fields: [
      { name: "image_url", label: "Image URL", type: "url", value: "https://example.com/document.jpg", required: true },
      { name: "language", label: "Language", type: "text", value: "auto" },
    ],
  },
  {
    id: "deepseek-ocr",
    name: "DeepSeek OCR",
    vendor: "deepseek-ai",
    modality: "OCR",
    path: "/v1/ocr",
    fields: [
      { name: "image_url", label: "Image URL", type: "url", value: "https://example.com/document.jpg", required: true },
      { name: "language", label: "Language", type: "text", value: "auto" },
    ],
  },
];
