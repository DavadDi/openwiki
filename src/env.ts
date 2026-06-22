import {mkdir, readFile, writeFile, chmod} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const openWikiEnvDir = path.join(os.homedir(), ".openwiki");
export const openWikiEnvPath = path.join(openWikiEnvDir, ".env");

type EnvMap = Record<string, string>;

const managedEnvKeys = [
  "OPENAI_API_KEY",
  "LANGSMITH_API_KEY",
  "LANGCHAIN_PROJECT",
  "LANGCHAIN_TRACING_V2"
];

export async function loadOpenWikiEnv(): Promise<EnvMap> {
  const env = await readOpenWikiEnv();

  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return env;
}

export async function saveOpenWikiEnv(updates: EnvMap): Promise<void> {
  const currentEnv = await readOpenWikiEnv();
  const nextEnv = {
    ...currentEnv,
    ...updates
  };

  await mkdir(openWikiEnvDir, {
    recursive: true,
    mode: 0o700
  });
  await chmod(openWikiEnvDir, 0o700);

  await writeFile(openWikiEnvPath, formatEnv(nextEnv), {
    encoding: "utf8",
    mode: 0o600
  });
  await chmod(openWikiEnvPath, 0o600);

  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;
  }
}

async function readOpenWikiEnv(): Promise<EnvMap> {
  try {
    return parseEnv(await readFile(openWikiEnvPath, "utf8"));
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {};
    }

    throw error;
  }
}

function parseEnv(content: string): EnvMap {
  const env: EnvMap = {};

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");

    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    const rawValue = line.slice(equalsIndex + 1).trim();

    if (!/^[A-Z_][A-Z0-9_]*$/u.test(key)) {
      continue;
    }

    env[key] = parseEnvValue(rawValue);
  }

  return env;
}

function parseEnvValue(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value
      .slice(1, -1)
      .replace(/\\n/gu, "\n")
      .replace(/\\"/gu, '"')
      .replace(/\\\\/gu, "\\");
  }

  return value;
}

function formatEnv(env: EnvMap): string {
  const keys = [
    ...managedEnvKeys.filter((key) => env[key] !== undefined),
    ...Object.keys(env)
      .filter((key) => !managedEnvKeys.includes(key))
      .sort()
  ];

  return `${keys.map((key) => `${key}=${formatEnvValue(env[key] ?? "")}`).join("\n")}\n`;
}

function formatEnvValue(value: string): string {
  return `"${value
    .replace(/\\/gu, "\\\\")
    .replace(/"/gu, '\\"')
    .replace(/\n/gu, "\\n")}"`;
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
