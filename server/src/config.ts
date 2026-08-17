import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// server package root — paths and .env resolve here, regardless of cwd
const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// minimal .env loader (KEY=VALUE, # comments, optional quotes) — no dependency
for (const line of readEnvFile(resolve(SERVER_ROOT, ".env"))) {
  if (!(line[0] in process.env)) process.env[line[0]] = line[1];
}

function readEnvFile(path: string): [string, string][] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => {
        const eq = l.indexOf("=");
        return eq === -1 ? null : [l.slice(0, eq).trim(), l.slice(eq + 1).trim().replace(/^"|"$/g, "")];
      })
      .filter((x): x is [string, string] => x !== null);
  } catch {
    return []; // no .env — rely on real env vars
  }
}

export interface Config {
  port: number;
  allowedOrigins: string[];
  provider: string; // registry key
  rateLimitPerIpPerMin: number;
  budgetCapDailyUsd: number;
  maxHistoryMessages: number;
  greetingText: string;
  providerConfig: {
    baseUrl: string;
    apiKey: string;
    model: string;
    pricePerMTok: number; // blended $/million tokens for budget estimation
  };
  systemPrompt: string;
  sourceMarkdown: string;
  llmLogPath: string;
  llmLogEnabled: boolean;
}

function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function loadConfig(root: string = SERVER_ROOT): Config {
  const systemPromptPath = env("SYSTEM_PROMPT_PATH", "./config/system-prompt.md");
  const sourcePath = env("SOURCE_OF_TRUTH_PATH", "./knowledge/source.md");
  return {
    port: Number(env("PORT", "8787")),
    allowedOrigins: env("ALLOWED_ORIGINS")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    provider: env("PROVIDER", "openai-compatible"),
    rateLimitPerIpPerMin: Number(env("RATE_LIMIT_PER_IP_PER_MIN", "30")),
    budgetCapDailyUsd: Number(env("BUDGET_CAP_DAILY_USD", "5")),
    maxHistoryMessages: Number(env("MAX_HISTORY_MESSAGES", "40")),
    greetingText: env("GREETING_TEXT", "Hi! I'm the site assistant — ask me anything."),
    providerConfig: {
      baseUrl: env("LLM_BASE_URL", "https://openrouter.ai/api/v1"),
      apiKey: env("LLM_API_KEY"),
      model: env("LLM_MODEL", "openai/gpt-4o-mini"),
      pricePerMTok: Number(env("LLM_PRICE_PER_MTOK", "0.2")),
    },
    systemPrompt: readFile(root, systemPromptPath),
    sourceMarkdown: readFile(root, sourcePath),
    llmLogPath: resolve(root, env("LLM_LOG_PATH", "./logs/llm.jsonl")),
    llmLogEnabled: env("LLM_LOG_ENABLED", "true") !== "false",
  };
}

function readFile(root: string, rel: string): string {
  try {
    return readFileSync(resolve(root, rel), "utf8");
  } catch {
    console.warn(`[mini-chat] could not read ${rel} — continuing without it`);
    return "";
  }
}
