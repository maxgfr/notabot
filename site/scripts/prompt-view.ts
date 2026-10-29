// The exact prompt the model would get, shown before anything is sent. The prompt module only:
// the AI stack loads with the officer, when the visitor reaches it.
import { buildPrompt, type Features, SYSTEM_PROMPT } from "../../src/llm/prompt";
import { t } from "./common";

export function showPrompt(features: Features | null): void {
  const prompt = document.getElementById("prompt");
  if (!prompt) return;
  prompt.textContent = features
    ? `system:\n${SYSTEM_PROMPT}\n\nuser:\n${buildPrompt(features)}`
    : t("officer.promptPending");
}
