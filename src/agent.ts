import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {initChatModel} from "langchain/chat_models/universal";
import {createDeepAgent, FilesystemBackend} from "deepagents";
import {loadOpenWikiEnv} from "./env.js";

export type OpenWikiCommand = "init" | "update";

export type OpenWikiRunResult = {
  command: OpenWikiCommand;
  model: string;
};

const openWikiDir = "openwiki";
const updateMetadataPath = `${openWikiDir}/.last-update.json`;
const modelName = "gpt-5.5-mini";
const execFileAsync = promisify(execFile);

type UpdateMetadata = {
  updatedAt: string;
  command: OpenWikiCommand;
  model: string;
};

type RunContext = {
  lastUpdate: UpdateMetadata | null;
  gitSummary: string;
};

export async function runOpenWikiAgent(
  command: OpenWikiCommand,
  cwd = process.cwd()
): Promise<OpenWikiRunResult> {
  await loadOpenWikiEnv();
  ensureOpenAIKey();

  const context = await createRunContext(command, cwd);
  const model = await createModel();
  const agent = createDeepAgent({
    model,
    tools: [],
    backend: new FilesystemBackend({
      rootDir: cwd,
      virtualMode: true
    }),
    systemPrompt: createSystemPrompt(command)
  });

  await agent.invoke({
    messages: [
      {
        role: "user",
        content: createUserPrompt(command, context)
      }
    ]
  });

  await writeLastUpdateMetadata(command, cwd);

  return {
    command,
    model: modelName
  };
}

function ensureOpenAIKey(): void {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to run the OpenWiki agent.");
  }
}

async function createModel() {
  return initChatModel(modelName, {
    modelProvider: "openai",
    reasoning: {
      effort: "high"
    }
  });
}

function createSystemPrompt(command: OpenWikiCommand): string {
  return `
You are OpenWiki, an expert technical writer, software architect, and product analyst.

Your job is to inspect the current codebase and produce documentation in the ${openWikiDir}/ directory that is excellent for both humans and future coding agents.

Use only the tools available to you. Prefer built-in filesystem discovery tools such as ls, glob, grep, read_file, write_file, and edit_file. Do not invent files, modules, APIs, business rules, or behavior. Ground every important claim in source files you have inspected.

Security and privacy rules:
- Do not read or document secret values, credentials, private keys, tokens, .env files, or other sensitive material.
- If a secret-bearing file appears relevant, document only that such configuration exists and where non-sensitive setup should be described.
- Keep all documentation under ${openWikiDir}/.
- Do not modify source code outside ${openWikiDir}/.

Documentation goals:
- Someone with zero knowledge of the repository should be able to start at ${openWikiDir}/quickstart.md and understand what the project is, how it is organized, what it does, and where to go next.
- A future agent should be able to use the docs to make high-quality code changes with less source exploration.
- Capture both technical details and business/product logic.
- Explain why important code exists, not only what files contain.
- Prefer clear Markdown with stable links between pages.
- Organize the docs like human documentation, not a raw file inventory.

Required documentation structure:
- ${openWikiDir}/quickstart.md must be the entrypoint.
- ${openWikiDir}/quickstart.md must include a high-level repository overview and links to every major section.
- Create one directory per major section, for example architecture/, workflows/, domain/, api/, data-models/, operations/, integrations/, testing/, or similar names that fit the repo.
- Each section directory should contain focused Markdown pages.
- Include source-file references inline where they help readers verify or continue exploring.
- Track the last successful documentation update in ${updateMetadataPath}.

Mode-specific behavior:
${createModeInstructions(command)}
`.trim();
}

function createModeInstructions(command: OpenWikiCommand): string {
  if (command === "init") {
    return `
- This is an initial documentation run.
- Assume ${openWikiDir}/ does not yet contain useful documentation.
- Build the documentation structure from scratch.
- Create ${openWikiDir}/quickstart.md first, then the linked section pages.
- The CLI will record successful run metadata in ${updateMetadataPath} after you finish.
`.trim();
  }

  return `
- This is a maintenance update run.
- Inspect the existing ${openWikiDir}/ documentation before editing.
- Read ${updateMetadataPath} if it exists.
- Use git-oriented repository evidence to understand recent changes. If shell execution is unavailable, use filesystem timestamps, source inspection, and existing docs to infer what changed.
- Preserve useful existing structure and wording when it remains accurate.
- Update stale pages, add missing pages, remove obsolete claims, and keep quickstart links accurate.
- The CLI will record successful run metadata in ${updateMetadataPath} after you finish.
`.trim();
}

function createUserPrompt(command: OpenWikiCommand, context: RunContext): string {
  if (command === "init") {
    return `
Initialize OpenWiki documentation for this repository.

Inspect the project thoroughly, identify the major technical and business domains, and write the initial documentation under ${openWikiDir}/.

Start with ${openWikiDir}/quickstart.md as the entrypoint. Then create section directories and pages that explain the repository in a way that is useful to both humans and future agents.
`.trim();
  }

  return `
Update the existing OpenWiki documentation for this repository.

Inspect ${openWikiDir}/, identify recent source changes, and refresh the documentation so it remains accurate and complete. Use the git evidence below when available. The CLI will update ${updateMetadataPath} after you finish.

Last update metadata:
${formatLastUpdate(context.lastUpdate)}

Git change summary:
${context.gitSummary}
`.trim();
}

async function createRunContext(
  command: OpenWikiCommand,
  cwd: string
): Promise<RunContext> {
  const lastUpdate = await readLastUpdate(cwd);

  if (command === "init") {
    return {
      lastUpdate,
      gitSummary: "Not applicable for init."
    };
  }

  return {
    lastUpdate,
    gitSummary: await createGitSummary(cwd, lastUpdate)
  };
}

async function readLastUpdate(cwd: string): Promise<UpdateMetadata | null> {
  const metadataFile = path.join(cwd, updateMetadataPath);

  try {
    const rawMetadata = await readFile(metadataFile, "utf8");
    const parsedMetadata = JSON.parse(rawMetadata) as Partial<UpdateMetadata>;

    if (
      typeof parsedMetadata.updatedAt === "string" &&
      typeof parsedMetadata.command === "string" &&
      typeof parsedMetadata.model === "string"
    ) {
      return {
        updatedAt: parsedMetadata.updatedAt,
        command: parsedMetadata.command === "init" ? "init" : "update",
        model: parsedMetadata.model
      };
    }

    return null;
  } catch (error) {
    if (isFileNotFoundError(error) || error instanceof SyntaxError) {
      return null;
    }

    throw error;
  }
}

async function createGitSummary(
  cwd: string,
  lastUpdate: UpdateMetadata | null
): Promise<string> {
  const sections: string[] = [];
  const status = await runGit(cwd, ["status", "--short"]);

  sections.push(formatGitSection("git status --short", status));

  if (lastUpdate?.updatedAt) {
    const logSinceLastUpdate = await runGit(cwd, [
      "log",
      "--since",
      lastUpdate.updatedAt,
      "--name-status",
      "--oneline"
    ]);

    sections.push(
      formatGitSection(
        `git log --since ${lastUpdate.updatedAt} --name-status --oneline`,
        logSinceLastUpdate
      )
    );
  } else {
    sections.push("No prior OpenWiki update timestamp was found.");
  }

  const diff = await runGit(cwd, ["diff", "--name-status", "HEAD"]);
  sections.push(formatGitSection("git diff --name-status HEAD", diff));

  return sections.join("\n\n");
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const {stdout, stderr} = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 1024 * 1024
    });

    return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim();
  } catch (error) {
    if (isExecError(error)) {
      return [error.stdout?.trim(), error.stderr?.trim()]
        .filter(Boolean)
        .join("\n")
        .trim();
    }

    throw error;
  }
}

function formatGitSection(command: string, output: string): string {
  return [`$ ${command}`, output.length > 0 ? output : "(no output)"].join("\n");
}

function formatLastUpdate(lastUpdate: UpdateMetadata | null): string {
  if (lastUpdate === null) {
    return "No previous OpenWiki update metadata was found.";
  }

  return JSON.stringify(lastUpdate, null, 2);
}

export async function writeLastUpdateMetadata(
  command: OpenWikiCommand,
  cwd = process.cwd()
): Promise<void> {
  const metadataFile = path.join(cwd, updateMetadataPath);
  const metadata: UpdateMetadata = {
    updatedAt: new Date().toISOString(),
    command,
    model: modelName
  };

  await mkdir(path.dirname(metadataFile), {recursive: true});
  await writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function isExecError(
  error: unknown
): error is Error & {stdout?: string; stderr?: string} {
  return error instanceof Error && ("stdout" in error || "stderr" in error);
}
