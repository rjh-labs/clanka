/**
 * @since 1.0.0
 */
import { Effect, Sink } from "effect"
import {
  type Output,
  SubagentComplete,
  SubagentPart,
  SubagentStart,
} from "./Agent.ts"
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
    const renderOutput = (output: Output, prefix: string): Effect.Effect<void> => {
      if (output instanceof SubagentPart) {
        if (output.part instanceof SubagentStart) {
          console.log(
            chalkSubagentHeading(
              `${subagentIcon} Subagent #${output.id} starting (${output.modelAndProvider})`,
            ),
          )
          console.log("")
          console.log(chalk.dim(output.prompt))
          console.log("")
          return Effect.void
        }
        if (output.part instanceof SubagentComplete) {
          console.log(
            chalkSubagentHeading(
              `${subagentIcon} Subagent #${output.id} complete`,
            ),
          )
          console.log("")
          console.log(output.part.summary)
          console.log("")
          return Effect.void
        }
        const nextPrefix = chalk.magenta(`Subagent #${output.id}:`) + " "
        return renderOutput(output.part, nextPrefix)
      }
      switch (output._tag) {
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
          console.log("")
          const lines = output.output.split("\n")
          const truncated =
            lines.length > 20
              ? lines.slice(0, 20).join("\n") + "\n... (truncated)"
              : output.output
          console.log(chalk.dim(truncated))
          console.log(chalk.reset(""))
          break
        }
      }
      return Effect.void
    }
    return Sink.forEach((output) => renderOutput(output, prefix))
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
