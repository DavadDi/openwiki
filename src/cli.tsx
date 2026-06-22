#!/usr/bin/env node
import React, {useEffect, useState} from "react";
import {Box, render, Text, useApp} from "ink";
import {
  helpContent,
  isDevelopmentMode,
  parseCommand,
  type CliCommand,
  type HelpRow
} from "./commands.js";
import {
  CredentialSetup,
  needsCredentialSetup,
  type CredentialSetupResult
} from "./credentials.js";
import {loadOpenWikiEnv} from "./env.js";
import {runOpenWikiAgent, type OpenWikiRunResult} from "./agent.js";

type RunState =
  | {status: "idle"}
  | {status: "credentials-saved"; result: CredentialSetupResult}
  | {status: "running"; command: "init" | "update"}
  | {status: "success"; result: OpenWikiRunResult}
  | {status: "error"; message: string};

type AppProps = {
  command: CliCommand;
};

function App({command}: AppProps) {
  const app = useApp();
  const [runState, setRunState] = useState<RunState>({status: "idle"});
  const shouldSetupCredentials =
    command.kind === "init" &&
    !command.dryRun &&
    process.stdin.isTTY &&
    needsCredentialSetup() &&
    runState.status === "idle";

  useEffect(() => {
    if (command.kind === "help" || command.kind === "error") {
      process.exitCode = command.exitCode;
      app.exit();
      return;
    }

    if (command.dryRun) {
      process.exitCode = 0;
      app.exit();
      return;
    }

    if (shouldSetupCredentials) {
      return;
    }

    let isMounted = true;
    setRunState({status: "running", command: command.kind});

    runOpenWikiAgent(command.kind)
      .then((result) => {
        if (!isMounted) {
          return;
        }

        setRunState({status: "success", result});
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }

        setRunState({
          status: "error",
          message:
            error instanceof Error ? error.message : "OpenWiki agent run failed."
        });
      });

    return () => {
      isMounted = false;
    };
  }, [app, command, shouldSetupCredentials]);

  useEffect(() => {
    if (runState.status === "success") {
      process.exitCode = 0;
      app.exit();
      return;
    }

    if (runState.status === "error") {
      process.exitCode = 1;
      app.exit();
    }
  }, [app, runState.status]);

  if (command.kind === "help") {
    return <HelpView />;
  }

  if (command.kind === "error") {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text color="red">Error: {command.message}</Text>
        </Box>
        <HelpView />
      </Box>
    );
  }

  if (command.dryRun) {
    return <DryRunView command={command.kind} />;
  }

  if (shouldSetupCredentials) {
    return (
      <CredentialSetup
        onComplete={(result) => {
          setRunState({status: "credentials-saved", result});
        }}
        onError={(message) => {
          setRunState({status: "error", message});
        }}
      />
    );
  }

  if (runState.status === "credentials-saved") {
    return (
      <Box flexDirection="column">
        <Text>Credentials saved.</Text>
        <Text>Starting openwiki init...</Text>
      </Box>
    );
  }

  if (runState.status === "running") {
    return <Text>Running openwiki {runState.command}...</Text>;
  }

  if (runState.status === "success") {
    return (
      <Box flexDirection="column">
        <Text>
          Completed openwiki {runState.result.command} with{" "}
          {runState.result.model}.
        </Text>
        <Text>Documentation output: openwiki/</Text>
      </Box>
    );
  }

  if (runState.status === "error") {
    return <Text color="red">Error: {runState.message}</Text>;
  }

  return <Text>Starting OpenWiki...</Text>;
}

function HelpView() {
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">
          {helpContent.title}
        </Text>
        <Text>{helpContent.description}</Text>
      </Box>

      <Section title="Usage">
        {helpContent.usage.map((line) => (
          <Text key={line}>  {line}</Text>
        ))}
      </Section>

      <Section title="Commands">
        <Rows rows={helpContent.commands} />
      </Section>

      {isDevelopmentMode() ? (
        <Section title="Development Options">
          <Rows rows={helpContent.developmentOptions} />
        </Section>
      ) : null}

      <Section title="Examples">
        {helpContent.examples.map((line) => (
          <Text key={line}>  {line}</Text>
        ))}
        {isDevelopmentMode()
          ? helpContent.developmentExamples.map((line) => (
              <Text key={line}>  {line}</Text>
            ))
          : null}
      </Section>
    </Box>
  );
}

function DryRunView({command}: {command: "init" | "update"}) {
  return (
    <Box flexDirection="column">
      <Text>Dry run: openwiki {command}</Text>
      <Text>No credentials will be read or requested.</Text>
      <Text>No agent will be invoked.</Text>
      <Text>No files or metadata will be written.</Text>
      <Text>Documentation output would be openwiki/.</Text>
    </Box>
  );
}

type SectionProps = {
  title: string;
  children: React.ReactNode;
};

function Section({title, children}: SectionProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>{title}</Text>
      {children}
    </Box>
  );
}

type RowsProps = {
  rows: HelpRow[];
};

function Rows({rows}: RowsProps) {
  const labelWidth = Math.max(...rows.map((row) => row.label.length));

  return (
    <>
      {rows.map((row) => (
        <Text key={row.label}>
          {"  "}
          {row.label.padEnd(labelWidth)}
          {"  "}
          {row.description}
        </Text>
      ))}
    </>
  );
}

const parsedCommand = parseCommand(process.argv.slice(2));

if (
  (parsedCommand.kind === "init" || parsedCommand.kind === "update") &&
  !parsedCommand.dryRun
) {
  await loadOpenWikiEnv();
}

const command = resolveStartupCommand(parsedCommand);

render(<App command={command} />);

function resolveStartupCommand(command: CliCommand): CliCommand {
  if (command.kind === "update" && !command.dryRun && !process.env.OPENAI_API_KEY) {
    return {
      kind: "error",
      exitCode: 1,
      message: "OPENAI_API_KEY is required to run the OpenWiki agent."
    };
  }

  if (
    command.kind === "init" &&
    !command.dryRun &&
    !process.env.OPENAI_API_KEY &&
    !process.stdin.isTTY
  ) {
    return {
      kind: "error",
      exitCode: 1,
      message:
        "OPENAI_API_KEY is required for non-interactive init. Run openwiki init in an interactive terminal to save credentials."
    };
  }

  return command;
}
