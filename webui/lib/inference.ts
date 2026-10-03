import type { FieldValue, Model } from "./catalog";

export type Values = Record<string, FieldValue>;

export interface ParsedCurl {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

const defaultBaseUrl = "https://inference.ctx11.com";

export function initialValues(model: Model): Values {
  const values: Values = {};

  for (const field of model.fields) {
    if (field.type === "checkbox") {
      values[field.name] = field.checked ?? false;
    } else {
      values[field.name] = field.value ?? "";
    }
  }

  return values;
}

export function buildRequestBody(model: Model, values: Values): Record<string, unknown> {
  switch (model.id) {
    case "qwen3-8-27b":
      return {
        model: "qwen3.8-27b",
        messages: [
          ...(String(values.system ?? "").trim()
            ? [{ role: "system", content: String(values.system).trim() }]
            : []),
          { role: "user", content: String(values.prompt ?? "").trim() },
        ],
        ...(values.temperature !== "" && values.temperature !== undefined
          ? { temperature: Number(values.temperature) }
          : {}),
        ...(values.max_tokens !== "" && values.max_tokens !== undefined
          ? { max_tokens: Number(values.max_tokens) }
          : {}),
        stream: Boolean(values.stream),
      };
    case "qwen-image-2-1":
      return {
        model: "qwen-image-2.1",
        prompt: values.prompt,
        size: values.size,
        num_inference_steps: Number(values.steps),
        guidance_scale: Number(values.guidance),
      };
    case "yue2-3b":
      return {
        model: "yue2-3b",
        prompt: values.prompt,
        style: values.style,
        duration: Number(values.duration),
      };
    case "minimax-h3-singularity":
      return {
        model: "minimax-h3-singularity",
        prompt: values.prompt,
        image_url: values.image_url,
        duration: Number(values.duration),
      };
    case "glm-ocr":
      return {
        model: "glm-ocr",
        image_url: values.image_url,
        language: values.language,
      };
    case "deepseek-ocr":
      return {
        model: "deepseek-ocr",
        image_url: values.image_url,
        language: values.language,
      };
    default:
      throw new Error(`Unknown model: ${model.id}`);
  }
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function sampleCurl(model: Model): string {
  const body = JSON.stringify(buildRequestBody(model, initialValues(model)), null, 2);
  return [
    `curl '${defaultBaseUrl}${model.path}' \\`,
    "  --request POST \\",
    "  --header 'Content-Type: application/json' \\",
    `  --data ${shellSingleQuote(body)}`,
  ].join("\n");
}

function tokenizeCurl(command: string): string[] {
  const normalized = command.replace(/\\\r?\n/g, " ");
  const tokens: string[] = [];
  let current = "";
  let hasToken = false;
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (const char of normalized) {
    if (quote === "'") {
      if (char === "'") {
        quote = undefined;
      } else {
        current += char;
        hasToken = true;
      }
      continue;
    }

    if (quote === '"') {
      if (escaped) {
        if (char === '"' || char === "\\") {
          current += char;
        } else {
          current += `\\${char}`;
        }
        escaped = false;
        hasToken = true;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        quote = undefined;
        continue;
      }

      current += char;
      hasToken = true;
      continue;
    }

    if (escaped) {
      current += char;
      hasToken = true;
      escaped = false;
      continue;
    }

    if (/\s/.test(char)) {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "'") {
      quote = "'";
      hasToken = true;
      continue;
    }

    if (char === '"') {
      quote = '"';
      hasToken = true;
      continue;
    }

    current += char;
    hasToken = true;
  }

  if (hasToken) tokens.push(current);
  return tokens;
}

export function parseCurl(command: string): ParsedCurl {
  const tokens = tokenizeCurl(command);
  let url: string | undefined;
  let method = "GET";
  let body: string | undefined;
  const headers: Record<string, string> = {};

  const headerFlags = new Set(["-H", "--header"]);
  const methodFlags = new Set(["-X", "--request"]);
  const bodyFlags = new Set(["-d", "--data", "--data-raw", "--data-binary"]);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "curl") continue;

    const attached = token.startsWith("-") && token.includes("=");
    const [flag, attachedValue] = attached ? token.split(/=(.*)/, 2) : [token];
    let value = attached ? attachedValue : tokens[index + 1];

    if (headerFlags.has(flag)) {
      if (!attached) index += 1;
      const separator = value.indexOf(":");
      if (separator === -1) throw new Error("Invalid header. Expected 'Name: Value'.");
      const name = value.slice(0, separator).trim();
      const headerValue = value.slice(separator + 1).trim();
      if (!name) throw new Error("Invalid header name.");
      headers[name.toLowerCase()] = headerValue;
      continue;
    }

    if (methodFlags.has(flag)) {
      if (!attached) index += 1;
      if (!value) throw new Error("Missing HTTP method.");
      method = value.toUpperCase();
      continue;
    }

    if (bodyFlags.has(flag)) {
      if (!attached) index += 1;
      if (value === undefined) throw new Error("Missing request body.");
      body = value;
      if (method === "GET") method = "POST";
      continue;
    }

    if (/^https?:\/\//i.test(token) || (!token.startsWith("-") && !url)) {
      url = token;
    }
  }

  if (!url) throw new Error("Missing request URL.");

  delete headers["content-length"];
  delete headers.host;
  delete headers.connection;

  return { url, method, headers, body };
}

export function formatError(error: unknown): string {
  if (error instanceof TypeError) {
    return "Network or CORS error. Check the URL, network access, and whether the endpoint permits browser requests.";
  }

  if (error instanceof Error) return error.message;
  return String(error);
}

export function formatResult(model: Model, result: unknown): string {
  if (model.id === "qwen3-8-27b") {
    const completion = result as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
    };
    const message = completion.choices?.[0]?.message;
    let output = message?.content || "(No text returned.)";
    if (message?.reasoning_content) {
      output += `\n\n--- Reasoning ---\n${message.reasoning_content}`;
    }
    return output;
  }

  if (typeof result === "string") return result;

  const record = result as {
    output?: unknown;
    text?: unknown;
    content?: unknown;
    url?: unknown;
    data?: Array<{ url?: string; b64_json?: string }>;
  };

  const simple =
    record.output ??
    record.text ??
    record.content ??
    record.url ??
    record.data?.[0]?.url ??
    record.data?.[0]?.b64_json;

  return typeof simple === "string" ? simple : JSON.stringify(result, null, 2);
}
