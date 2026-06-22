export type HelpRow = {
  label: string;
  description: string;
};

export type HelpContent = {
  title: string;
  description: string;
  usage: string[];
  commands: HelpRow[];
  developmentOptions: HelpRow[];
  examples: string[];
  developmentExamples: string[];
};

export type CliCommand =
  | {kind: "help"; exitCode: 0}
  | {kind: "init"; exitCode: 0; dryRun: boolean}
  | {kind: "update"; exitCode: 0; dryRun: boolean}
  | {
      kind: "error";
      exitCode: 1;
      message: string;
    };

const supportedCommands = new Set(["init", "update"]);

export function parseCommand(argv: string[]): CliCommand {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return {kind: "help", exitCode: 0};
  }

  const [command, ...args] = argv;

  if (command === undefined || !supportedCommands.has(command)) {
    return {
      kind: "error",
      exitCode: 1,
      message: `Unknown command: ${command ?? ""}`.trim()
    };
  }

  return parseActionCommand(command as "init" | "update", args);
}

function parseActionCommand(
  command: "init" | "update",
  args: string[]
): CliCommand {
  let dryRun = false;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      return {kind: "help", exitCode: 0};
    }

    if (arg === "--dry-run") {
      if (!isDevelopmentMode()) {
        return {
          kind: "error",
          exitCode: 1,
          message: `Unknown ${command} option: ${arg}`
        };
      }

      dryRun = true;
      continue;
    }

    return {
      kind: "error",
      exitCode: 1,
      message: `Unknown ${command} option: ${arg}`
    };
  }

  return {kind: command, exitCode: 0, dryRun};
}

export function isDevelopmentMode(): boolean {
  return process.env.NODE_ENV === "development" || process.env.OPENWIKI_DEV === "1";
}

export const helpContent: HelpContent = {
  title: "OpenWiki",
  description:
    "Run a documentation agent that generates and maintains a project wiki.",
  usage: ["openwiki <command>"],
  commands: [
    {
      label: "init",
      description: "Create initial docs in openwiki/."
    },
    {
      label: "update",
      description: "Refresh openwiki/ from repo changes."
    }
  ],
  developmentOptions: [
    {
      label: "--dry-run",
      description: "Show what would run without invoking the agent."
    }
  ],
  examples: ["openwiki init", "openwiki update"],
  developmentExamples: ["openwiki init --dry-run", "openwiki update --dry-run"]
};

export function getHelpText(): string {
  const helpSections = [
    helpContent.title,
    `  ${helpContent.description}`,
    "",
    "Usage",
    ...helpContent.usage.map((line) => `  ${line}`),
    "",
    "Commands",
    ...formatRows(helpContent.commands),
    ""
  ];

  if (isDevelopmentMode()) {
    helpSections.push(
      "Development Options",
      ...formatRows(helpContent.developmentOptions),
      ""
    );
  }

  helpSections.push(
    "Examples",
    ...helpContent.examples.map((line) => `  ${line}`)
  );

  if (isDevelopmentMode()) {
    helpSections.push(
      ...helpContent.developmentExamples.map((line) => `  ${line}`)
    );
  }

  return helpSections.join("\n");
}

function formatRows(rows: HelpRow[]): string[] {
  const labelWidth = Math.max(...rows.map((row) => row.label.length));

  return rows.map(
    (row) => `  ${row.label.padEnd(labelWidth)}  ${row.description}`
  );
}
