import {
  Array,
  Deferred,
  Effect,
  FileSystem,
  pipe,
  Schema,
  ServiceMap,
  Stream,
} from "effect"
import { Tool, Toolkit } from "effect/unstable/ai"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import * as Glob from "glob"
import * as Rg from "@vscode/ripgrep"

export const AgentTools = Toolkit.make(
  Tool.make("readFile", {
    description: "Read a file and optionally filter the lines to return.",
    parameters: Schema.Struct({
      path: Schema.String,
      startLine: Schema.optional(Schema.Number),
      endLine: Schema.optional(Schema.Number),
    }),
    success: Schema.String,
  }),
  Tool.make("rg", {
    description: "Search for a pattern in files using ripgrep.",
    parameters: Schema.Struct({
      pattern: Schema.String,
      glob: Schema.optional(Schema.String).annotate({
        documentation: "--glob",
      }),
      maxLines: Schema.Finite.annotate({
        documentation:
          "The total maximum number of lines to return across all files",
      }),
    }),
    success: Schema.String,
  }),
  Tool.make("glob", {
    description: "Find files matching a glob pattern.",
    parameters: Schema.String.annotate({
      identifier: "pattern",
    }),
    success: Schema.String,
  }),
  Tool.make("taskComplete", {
    description: "Call this when you have fully completed the user's task",
    parameters: Schema.String.annotate({
      identifier: "message",
    }),
  }),
)

export class CurrentDirectory extends ServiceMap.Service<
  CurrentDirectory,
  string
>()("clanka/AgentTools/CurrentDirectory") {}

export class TaskCompleteDeferred extends ServiceMap.Service<
  TaskCompleteDeferred,
  Deferred.Deferred<string>
>()("clanka/AgentTools/TaskCompleteDeferred") {}

export const AgentToolHandlers = AgentTools.toLayer(
  Effect.gen(function* () {
    const deferred = yield* TaskCompleteDeferred
    const cwd = yield* CurrentDirectory
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const fs = yield* FileSystem.FileSystem

    return AgentTools.of({
      readFile: Effect.fn("AgentTools.readFile")((options) => {
        let stream = pipe(
          fs.stream(options.path),
          Stream.decodeText,
          Stream.splitLines,
        )
        if (options.startLine) {
          stream = Stream.drop(stream, options.startLine - 1)
        }
        if (options.endLine) {
          stream = Stream.take(
            stream,
            options.endLine - (options.startLine ?? 1) + 1,
          )
        }
        return Stream.runCollect(stream).pipe(
          Effect.map(Array.join("\n")),
          Effect.orDie,
        )
      }),
      rg: Effect.fn("AgentTools.rg")((options) => {
        const args = ["--max-filesize", "700K", "--line-number"]
        if (options.glob) {
          args.push("--glob", options.glob)
        }
        args.push(options.pattern)
        let stream = spawner.streamLines(
          ChildProcess.make(Rg.rgPath, args, {
            cwd,
            stdin: "ignore",
          }),
        )
        if (options.maxLines) {
          stream = Stream.take(stream, options.maxLines)
        }
        return Stream.runCollect(stream).pipe(
          Effect.map(Array.join("\n")),
          Effect.orDie,
        )
      }),
      glob: Effect.fn("AgentTools.glob")((pattern) =>
        Effect.promise(() => Glob.glob(pattern, { cwd })).pipe(
          Effect.map(Array.join("\n")),
        ),
      ),
      taskComplete: Effect.fn("AgentTools.taskComplete")((message) =>
        Deferred.succeed(deferred, message),
      ),
    })
  }),
)
