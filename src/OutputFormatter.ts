/**
 * @since 1.0.0
 */
import { Effect, Sink, Stream } from "effect"
import type { Output } from "./Agent.ts"
import chalk from "chalk"

/**
 * @since 1.0.0
 * @category Models
 */
export type OutputFormatter<E = never, R = never> = Sink.Sink<
  void,
  Output,
  never,
  E,
  R
>

const prettyPrefixed = (prefix: string): OutputFormatter =>
  Sink.suspend(() => {
    let hadReasoningDelta = false
    return Sink.forEach((output) => {
      switch (output._tag) {
        case "SubagentPart": {
          console.log(
            chalkSubagentHeading(
              `${subagentIcon} Subagent #${output.id} starting (${output.modelAndProvider})`,
            ),
          )
          console.log("")
          console.log(chalk.dim(output.prompt))
          console.log("")
          const prefix = chalk.magenta(`Subagent #${output.id}:`) + " "
          return output.output.pipe(
            Stream.run(prettyPrefixed(prefix)),
            Effect.catch((finished) => {
              console.log(
                chalkSubagentHeading(
                  `${subagentIcon} Subagent #${output.id} complete`,
                ),
              )
              console.log("")
              console.log(finished.summary)
              console.log("")
              return Effect.void
            }),
            Effect.forkChild,
          )
        }
        case "ReasoningDelta": {
          process.stdout.write(output.delta)
          hadReasoningDelta = true
          break
        }
        case "ReasoningEnd": {
          if (hadReasoningDelta) {
            console.log("\n")
            hadReasoningDelta = false
          }
          break
        }
        case "ScriptStart": {
          console.log(
            prefix + chalkScriptHeading(`${scriptIcon} Executing script`),
          )
          console.log("")
          console.log(chalk.dim(output.script))
          console.log("")
          break
        }
        case "ScriptEnd": {
          console.log(
            prefix + chalkScriptHeading(`${scriptIcon} Script output`),
          )
          const lines = output.output.split("\n")
          const truncated =
            lines.length > 20
              ? lines.slice(0, 20).join("\n") + "\n... (truncated)"
              : output.output
          console.log(chalk.dim(truncated))
          console.log("")
          break
        }
      }
      return Effect.void
    })
  })

/**
 * @since 1.0.0
 * @category Pretty
 */
export const pretty: OutputFormatter = prettyPrefixed("")

const chalkScriptHeading = chalk.bold.blue
const chalkSubagentHeading = chalk.bold.magenta

const scriptIcon = "\u{f0bc1}"
const subagentIcon = "\u{ee0d} "
