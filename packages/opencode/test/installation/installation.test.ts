import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { AppProcess } from "@opencode-ai/core/process"
import { Installation } from "../../src/installation"
import { TUNNELCODE } from "../../src/gptunnel/urls"
import { testEffect } from "../lib/effect"

const encoder = new TextEncoder()

function mockHttpClient(handler: (request: HttpClientRequest.HttpClientRequest) => Response) {
  const client = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handler(request))))
  return Layer.succeed(HttpClient.HttpClient, client)
}

function mockSpawner(
  handler: (cmd: string, args: readonly string[]) => string | { code: number; stdout?: string; stderr?: string } = () =>
    "",
) {
  const spawner = ChildProcessSpawner.make((command) => {
    const std = ChildProcess.isStandardCommand(command) ? command : undefined
    const result = handler(std?.command ?? "", std?.args ?? [])
    const output = typeof result === "string" ? { code: 0, stdout: result, stderr: "" } : result
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(output.code)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
        stdout: output.stdout ? Stream.make(encoder.encode(output.stdout)) : Stream.empty,
        stderr: output.stderr ? Stream.make(encoder.encode(output.stderr)) : Stream.empty,
        all: Stream.empty,
        getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    )
  })
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

function testLayer(
  http: (request: HttpClientRequest.HttpClientRequest) => Response,
  spawn?: (cmd: string, args: readonly string[]) => string | { code: number; stdout?: string; stderr?: string },
) {
  const app = AppProcess.layer.pipe(Layer.provide(mockSpawner(spawn)))
  return Installation.layer.pipe(Layer.provide(mockHttpClient(http)), Layer.provide(app))
}

describe("installation", () => {
  describe("latest", () => {
    const unknown: string[] = []
    testEffect(
      testLayer((request) => {
        unknown.push(request.url)
        return new Response("1.2.3\n", { status: 200 })
      }),
    ).effect("reads TunnelCode release version from latest.txt", () =>
      Effect.gen(function* () {
        const result = yield* Installation.use.latest("unknown")
        expect(result).toBe("1.2.3")
        expect(unknown).toEqual([TUNNELCODE.LATEST_URL])
      }),
    )

    const manager: string[] = []
    testEffect(
      testLayer((request) => {
        manager.push(request.url)
        return new Response("2.3.4\n", { status: 200 })
      }),
    ).effect("uses TunnelCode latest.txt even when a package manager method is detected", () =>
      Effect.gen(function* () {
        const result = yield* Installation.use.latest("scoop")
        expect(result).toBe("2.3.4")
        expect(manager).toEqual([TUNNELCODE.LATEST_URL])
      }),
    )
  })

  describe("upgrade", () => {
    testEffect(testLayer(() => new Response("", { status: 200 }))).effect(
      "blocks package manager upgrades because TunnelCode is distributed by the curl installer",
      () =>
        Effect.gen(function* () {
          const err = yield* Effect.flip(Installation.use.upgrade("npm", "9.9.9"))
          expect(err).toBeInstanceOf(Installation.UpgradeFailedError)
          expect(err.stderr).toContain("bundled installer")
          expect(err.stderr).toContain(TUNNELCODE.INSTALL_URL)
          expect(err.message).toBe(err.stderr)
        }),
    )

    testEffect(
      testLayer(
        () => new Response("install script", { status: 200 }),
        (cmd, args) => {
          if (cmd === "bash" && args[0] === "--version") return "GNU bash"
          if (cmd === "bash") return { code: 1, stderr: "script failed" }
          return ""
        },
      ),
    ).effect("returns installer stderr when the curl install script fails", () =>
      Effect.gen(function* () {
        const err = yield* Effect.flip(Installation.use.upgrade("curl", "9.9.9"))
        expect(err).toBeInstanceOf(Installation.UpgradeFailedError)
        expect(err.stderr).toBe("script failed")
        expect(err.message).toBe(err.stderr)
      }),
    )

    const commands: string[] = []
    testEffect(
      testLayer(
        () => new Response("install script", { status: 200 }),
        (cmd, args) => {
          commands.push([cmd, ...args].join(" "))
          if (cmd === "bash" && args[0] === "--version") return { code: 1, stderr: "missing" }
          if (cmd === "bash") return { code: 1, stderr: "should not execute installer with bash" }
          if (cmd === "sh") return "ok"
          return ""
        },
      ),
    ).effect("falls back to sh when bash is unavailable during curl upgrade", () =>
      Effect.gen(function* () {
        yield* Installation.use.upgrade("curl", "9.9.9")
        expect(commands).toContain("bash --version")
        expect(commands).toContain("sh")
      }),
    )
  })
})
