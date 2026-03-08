import { OpenAiClient } from "@effect/ai-openai"
import { Layer } from "effect"
import { CodexAuth } from "./CodexAuth.ts"

export const CodexAiClient = OpenAiClient.layer({
  apiUrl: "https://chatgpt.com/backend-api/codex",
}).pipe(Layer.provide(CodexAuth.layerClient))
