/**
 * @since 1.0.0
 */
import {
  Cause,
  Console,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Scope,
  ServiceMap,
  Stream,
} from "effect"
import { Tool, Toolkit } from "effect/unstable/ai"
import * as NodeConsole from "node:console"
import * as NodeVm from "node:vm"
import { Writable } from "node:stream"

/**
 * @since 1.0.0
 * @category Services
 */
export class Executor extends ServiceMap.Service<
  Executor,
  {
    execute<Tools extends Record<string, Tool.Any>>(options: {
      readonly tools: Toolkit.WithHandler<Tools>
      readonly script: string
    }): Stream.Stream<string, never, Tool.HandlerServices<Tools[keyof Tools]>>
  }
>()("clanka/Executor") {
  static readonly layer = Layer.effect(
    Executor,
    // oxlint-disable-next-line require-yield
    Effect.gen(function* () {
      const execute = Effect.fnUntraced(function* <
        Tools extends Record<string, Tool.Any>,
      >(options: {
        readonly tools: Toolkit.WithHandler<Tools>
        readonly script: string
      }) {
        const output = yield* Queue.unbounded<string, Cause.Done>()
        const console = yield* makeConsole(output)
        const handlerScope = Scope.makeUnsafe("parallel")
        const trackFiber = Fiber.runIn(handlerScope)

        yield* Effect.gen(function* () {
          const console = yield* Console.Console
          const services = yield* Effect.services()
          let running = 0

          const script = new NodeVm.Script(`async function main() {
${options.script}
}`)
          const sandbox: ScriptSandbox = {
            main: defaultMain,
            console,
            fetch,
            process: undefined,
          }

          for (const [name, tool] of Object.entries(options.tools.tools)) {
            const handler = services.mapUnsafe.get(
              tool.id,
            ) as Tool.Handler<string>

            const handlerServices = ServiceMap.merge(services, handler.services)
            const runFork = Effect.runForkWith(handlerServices)

            // oxlint-disable-next-line typescript/no-explicit-any
            sandbox[name] = function (params: any) {
              running++
              const fiber = trackFiber(runFork(handler.handler(params, {})))
              return new Promise((resolve, reject) => {
                fiber.addObserver((exit) => {
                  running--
                  if (exit._tag === "Success") {
                    resolve(exit.value)
                  } else {
                    reject(Cause.squash(exit.cause))
                  }
                })
              })
            }
          }

          script.runInNewContext(sandbox, {
            timeout: 1000,
          })
          yield* Effect.promise(sandbox.main)
          while (true) {
            yield* Effect.yieldNow
            if (running === 0) break
          }
        }).pipe(
          Effect.ensuring(Scope.close(handlerScope, Exit.void)),
          Effect.timeout("3 minutes"),
          Effect.catchCause(Effect.logFatal),
          Effect.provideService(Console.Console, console),
          Effect.ensuring(Queue.end(output)),
          Effect.forkScoped,
        )

        return Stream.fromQueue(output)
      }, Stream.unwrap)

      return Executor.of({
        execute,
      })
    }),
  )
}

interface ScriptSandbox {
  main: () => Promise<void>
  console: Console.Console
  [toolName: string]: unknown
}

const defaultMain = () => Promise.resolve()

const makeConsole = Effect.fn(function* (
  queue: Queue.Queue<string, Cause.Done>,
) {
  const writable = new QueueWriteStream(queue)
  const newConsole = new NodeConsole.Console(writable)
  yield* Effect.addFinalizer(() => {
    writable.end()
    return Effect.void
  })
  return newConsole
})

class QueueWriteStream extends Writable {
  readonly queue: Queue.Enqueue<string, Cause.Done>
  constructor(queue: Queue.Enqueue<string, Cause.Done>) {
    super()
    this.queue = queue
  }
  _write(
    // oxlint-disable-next-line typescript/no-explicit-any
    chunk: any,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    Queue.offerUnsafe(this.queue, chunk.toString())
    callback()
  }
}
