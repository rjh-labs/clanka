import * as Console from "effect/Console"
import type * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ServiceMap from "effect/ServiceMap"

export class DeviceCodeHandler extends ServiceMap.Service<
  DeviceCodeHandler,
  {
    onCode(options: {
      readonly verifyUrl: string
      readonly deviceCode: string
    }): Effect.Effect<void>
  }
>()("clanka/DeviceCodeHandler") {}

export const layerConsole = Layer.succeed(DeviceCodeHandler, {
  onCode: (options) =>
    Console.log(
      `Open ${options.verifyUrl} and enter code ${options.deviceCode}.`,
    ),
})
