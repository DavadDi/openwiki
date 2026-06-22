import React, {useState} from "react";
import {Box, Text, useInput} from "ink";
import {openWikiEnvPath, saveOpenWikiEnv} from "./env.js";

export type CredentialSetupResult = {
  savedOpenAIKey: boolean;
  savedLangSmithKey: boolean;
};

type CredentialSetupProps = {
  onComplete: (result: CredentialSetupResult) => void;
  onError: (message: string) => void;
};

type PromptStep = "openai" | "langsmith";

export function needsCredentialSetup(): boolean {
  return !process.env.OPENAI_API_KEY || process.env.LANGSMITH_API_KEY === undefined;
}

export function CredentialSetup({onComplete, onError}: CredentialSetupProps) {
  const [step, setStep] = useState<PromptStep>(
    process.env.OPENAI_API_KEY ? "langsmith" : "openai"
  );
  const [openAIKey, setOpenAIKey] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useInput((inputValue, key) => {
    if (isSaving) {
      return;
    }

    if (key.return) {
      void submit();
      return;
    }

    if (key.backspace || key.delete) {
      setInput((value) => value.slice(0, -1));
      return;
    }

    if (inputValue && !key.ctrl && !key.meta) {
      setInput((value) => value + inputValue);
    }
  });

  async function submit() {
    setError(null);

    if (step === "openai") {
      const trimmedInput = input.trim();

      if (trimmedInput.length === 0) {
        setError("OpenAI API key is required.");
        return;
      }

      setOpenAIKey(trimmedInput);
      setInput("");
      setStep("langsmith");
      return;
    }

    setIsSaving(true);

    try {
      const trimmedLangSmithKey = input.trim();
      const updates: Record<string, string> = {};

      if (openAIKey !== null) {
        updates.OPENAI_API_KEY = openAIKey;
      }

      if (trimmedLangSmithKey.length > 0) {
        updates.LANGSMITH_API_KEY = trimmedLangSmithKey;
        updates.LANGCHAIN_PROJECT = "openwiki";
        updates.LANGCHAIN_TRACING_V2 = "true";
      }

      if (Object.keys(updates).length > 0) {
        await saveOpenWikiEnv(updates);
      }

      onComplete({
        savedOpenAIKey: openAIKey !== null,
        savedLangSmithKey: trimmedLangSmithKey.length > 0
      });
    } catch (saveError) {
      onError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save OpenWiki credentials."
      );
    }
  }

  const prompt =
    step === "openai"
      ? "OpenAI API key"
      : "LangSmith API key (optional, press Enter to skip)";

  return (
    <Box flexDirection="column">
      <Text>OpenWiki credential setup</Text>
      <Text>Credentials will be saved to {openWikiEnvPath}</Text>
      <Box marginTop={1}>
        <Text>
          {prompt}: {mask(input)}
        </Text>
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      ) : null}
      {isSaving ? (
        <Box marginTop={1}>
          <Text>Saving credentials...</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function mask(value: string): string {
  if (value.length === 0) {
    return "";
  }

  return "*".repeat(value.length);
}
