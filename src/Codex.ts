/**
 * @since 1.0.0
 */
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import * as Layer from "effect/Layer"
import * as Struct from "effect/Struct"
import { CodexAuth } from "./CodexAuth.ts"
import { AgentModelConfig } from "./Agent.ts"
import * as Model from "effect/unstable/ai/Model"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import type * as KeyValueStore from "effect/unstable/persistence/KeyValueStore"
import type * as LanguageModel from "effect/unstable/ai/LanguageModel"

/**
 * @since 1.0.0
 * @category Layers
 */
export const layerClient = OpenAiClient.layer({
  apiUrl: "https://chatgpt.com/backend-api/codex",
}).pipe(Layer.provide(CodexAuth.layerClient))

/**
 * @since 1.0.0
 * @category Layers
 */
export const model = (
  model: (string & {}) | OpenAiLanguageModel.Model,
  options?:
    | (OpenAiLanguageModel.Config["Service"] & typeof AgentModelConfig.Service)
    | undefined,
): Model.Model<
  "openai",
  LanguageModel.LanguageModel,
  HttpClient.HttpClient | KeyValueStore.KeyValueStore
> =>
  Model.make(
    "openai",
    model,
    Layer.merge(
      OpenAiLanguageModel.layer({
        model,
        config: {
          ...Struct.omit(options ?? {}, ["reasoning"]),
          store: false,
          reasoning: {
            effort: options?.reasoning?.effort ?? "medium",
            summary: "auto",
          },
        },
      }),
      AgentModelConfig.layer({
        systemPromptTransform: (system, effect) =>
          OpenAiLanguageModel.withConfigOverride(effect, {
            instructions: system,
          }),
      }),
    ).pipe(Layer.provide(layerClient)),
  )
