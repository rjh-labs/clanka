import { describe, expect, it } from "vitest"
import { extractScript } from "./ScriptExtraction.ts"

describe("extractScript", () => {
  it("returns the full string when there are no code blocks", () => {
    const markdown = [
      "This is some text.",
      "",
      "There are no fenced code blocks here.",
    ].join("\n")

    expect(extractScript(markdown)).toBe(markdown)
  })

  it("extracts a single fenced code block", () => {
    expect(
      extractScript(
        [
          "Before",
          "",
          "```ts",
          'console.log("Hello, world!")',
          "```",
          "",
          "After",
        ].join("\n"),
      ),
    ).toBe('console.log("Hello, world!")')
  })

  it("concatenates multiple fenced code blocks", () => {
    expect(
      extractScript(
        [
          "Before",
          "",
          "```js",
          'console.log("Hello, world!")',
          "```",
          "",
          "Between",
          "",
          "```",
          'console.log("Goodbye, world!")',
          "```",
        ].join("\n"),
      ),
    ).toBe(
      ['console.log("Hello, world!")', 'console.log("Goodbye, world!")'].join(
        "\n\n",
      ),
    )
  })

  it("supports longer fences", () => {
    expect(
      extractScript(
        ["````md", "```ts", 'console.log("nested")', "```", "````"].join("\n"),
      ),
    ).toBe(["```ts", 'console.log("nested")', "```"].join("\n"))
  })

  it("supports empty fenced code blocks", () => {
    expect(extractScript(["```ts", "```"].join("\n"))).toBe("")
  })

  it("supports unclosed fenced code blocks", () => {
    expect(
      extractScript(["before", "", "```ts", "const answer = 42"].join("\n")),
    ).toBe("const answer = 42")
  })

  it("supports closing fences longer than the opening fence", () => {
    expect(
      extractScript(["```ts", "const answer = 42", "````"].join("\n")),
    ).toBe("const answer = 42")
  })

  it("preserves CRLF output when extracting multiple blocks", () => {
    expect(
      extractScript(
        [
          "Before",
          "",
          "```ts",
          "const a = 1",
          "```",
          "",
          "```ts",
          "const b = 2",
          "```",
        ].join("\r\n"),
      ),
    ).toBe(["const a = 1", "const b = 2"].join("\r\n\r\n"))
  })
})
