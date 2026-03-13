import { assert, describe, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/Encoding"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import {
  HttpClient,
  type HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http"
import * as KeyValueStore from "effect/unstable/persistence/KeyValueStore"
import {
  CodexAuth,
  CodexAuthError,
  ISSUER,
  STORE_PREFIX,
  STORE_TOKEN_KEY,
  TOKEN_EXPIRY_BUFFER_MS,
  TokenData,
  extractAccountIdFromClaims,
  extractAccountIdFromToken,
  parseJwtClaims,
  toCodexAuthKeyValueStore,
  toTokenStore,
} from "./CodexAuth.ts"

const createJwt = (payload: string): string =>
  `${Encoding.encodeBase64Url(JSON.stringify({ alg: "none" }))}.${Encoding.encodeBase64Url(payload)}.sig`

const createTestJwt = (payload: Record<string, unknown>): string =>
  createJwt(JSON.stringify(payload))

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  })

const getBody = (request: HttpClientRequest.HttpClientRequest): string => {
  if (request.body._tag !== "Uint8Array") {
    throw new Error("Expected request body to be a Uint8Array payload")
  }

  return new TextDecoder().decode(request.body.body)
}

const makeClient = Effect.fn("makeClient")(function* (
  handler: (
    request: HttpClientRequest.HttpClientRequest,
    attempt: number,
  ) => Response,
) {
  const attempts = yield* Ref.make(0)
  const requests = yield* Ref.make<Array<HttpClientRequest.HttpClientRequest>>(
    [],
  )
  const client = HttpClient.make((request) =>
    Effect.gen(function* () {
      const attempt = yield* Ref.updateAndGet(attempts, (count) => count + 1)
      yield* Ref.update(requests, (current) => [...current, request])
      return HttpClientResponse.fromWeb(request, handler(request, attempt))
    }),
  )

  return {
    attempts,
    client,
    requests,
  } as const
})

const makeEffectClient = Effect.fn("makeEffectClient")(function* (
  handler: (
    request: HttpClientRequest.HttpClientRequest,
    attempt: number,
  ) => Effect.Effect<Response>,
) {
  const attempts = yield* Ref.make(0)
  const requests = yield* Ref.make<Array<HttpClientRequest.HttpClientRequest>>(
    [],
  )
  const client = HttpClient.make((request) =>
    Effect.gen(function* () {
      const attempt = yield* Ref.updateAndGet(attempts, (count) => count + 1)
      yield* Ref.update(requests, (current) => [...current, request])
      return HttpClientResponse.fromWeb(
        request,
        yield* handler(request, attempt),
      )
    }),
  )

  return {
    attempts,
    client,
    requests,
  } as const
})

describe("CodexAuth", () => {
  it.effect(
    "persists token data through the prefixed schema store",
    Effect.fn(function* () {
      const kvs = yield* KeyValueStore.KeyValueStore
      const tokenStore = toTokenStore(kvs)
      const token = new TokenData({
        access: "access-token",
        refresh: "refresh-token",
        expires: 1_700_000_000_000,
        accountId: Option.some("account_123"),
      })

      yield* Effect.orDie(tokenStore.set(STORE_TOKEN_KEY, token))

      const stored = yield* Effect.orDie(tokenStore.get(STORE_TOKEN_KEY))

      assert.strictEqual(Option.isSome(stored), true)
      if (Option.isNone(stored)) {
        return
      }

      assert.strictEqual(stored.value.access, token.access)
      assert.strictEqual(stored.value.refresh, token.refresh)
      assert.strictEqual(stored.value.expires, token.expires)
      assert.strictEqual(Option.isSome(stored.value.accountId), true)
      if (Option.isSome(stored.value.accountId)) {
        assert.strictEqual(stored.value.accountId.value, "account_123")
      }

      const rawValue = yield* Effect.orDie(
        kvs.get(`${STORE_PREFIX}${STORE_TOKEN_KEY}`),
      )
      const unprefixedValue = yield* Effect.orDie(kvs.get(STORE_TOKEN_KEY))

      assert.strictEqual(typeof rawValue, "string")
      assert.strictEqual(unprefixedValue, undefined)
    }, Effect.provide(KeyValueStore.layerMemory)),
  )

  it.effect(
    "round-trips missing account ids as Option.none",
    Effect.fn(function* () {
      const kvs = yield* KeyValueStore.KeyValueStore
      const prefixedStore = toCodexAuthKeyValueStore(kvs)
      const tokenStore = toTokenStore(kvs)
      const token = new TokenData({
        access: "access-token",
        refresh: "refresh-token",
        expires: 1_700_000_000_000,
        accountId: Option.none(),
      })

      yield* Effect.orDie(tokenStore.set(STORE_TOKEN_KEY, token))

      const stored = yield* Effect.orDie(tokenStore.get(STORE_TOKEN_KEY))

      assert.strictEqual(Option.isSome(stored), true)
      if (Option.isNone(stored)) {
        return
      }

      assert.strictEqual(Option.isNone(stored.value.accountId), true)
      assert.strictEqual(
        yield* Effect.orDie(prefixedStore.has(STORE_TOKEN_KEY)),
        true,
      )
    }, Effect.provide(KeyValueStore.layerMemory)),
  )

  it("marks tokens expired using the refresh buffer", () => {
    const now = Date.now()
    const expiredSoon = new TokenData({
      access: "access-token",
      refresh: "refresh-token",
      expires: now + TOKEN_EXPIRY_BUFFER_MS - 1_000,
      accountId: Option.none(),
    })
    const stillValid = new TokenData({
      access: "access-token",
      refresh: "refresh-token",
      expires: now + TOKEN_EXPIRY_BUFFER_MS + 60_000,
      accountId: Option.none(),
    })

    assert.strictEqual(expiredSoon.isExpired(), true)
    assert.strictEqual(stillValid.isExpired(), false)
  })

  it("constructs CodexAuthError with the expected tagged shape", () => {
    const error = new CodexAuthError({
      reason: "RefreshFailed",
      message: "Could not refresh the token",
    })

    assert.strictEqual(error._tag, "CodexAuthError")
    assert.strictEqual(error.reason, "RefreshFailed")
    assert.strictEqual(error.message, "Could not refresh the token")
  })

  it("parses valid JWT claims from a base64url payload", () => {
    assert.deepStrictEqual(
      Option.getOrUndefined(
        parseJwtClaims(
          createTestJwt({
            email: "test@example.com",
            chatgpt_account_id: "acc-123",
          }),
        ),
      ),
      {
        chatgpt_account_id: "acc-123",
      },
    )
  })

  it("returns none for JWTs without three parts", () => {
    assert.strictEqual(Option.isNone(parseJwtClaims("invalid")), true)
    assert.strictEqual(Option.isNone(parseJwtClaims("only.two")), true)
  })

  it("returns none for invalid base64url payloads", () => {
    assert.strictEqual(Option.isNone(parseJwtClaims("a.!!!invalid!!!.b")), true)
  })

  it("returns none for invalid JSON payloads", () => {
    assert.strictEqual(
      Option.isNone(parseJwtClaims(createJwt("not json"))),
      true,
    )
  })

  it("ignores malformed claim types instead of failing the parse", () => {
    assert.deepStrictEqual(
      Option.getOrUndefined(
        parseJwtClaims(createTestJwt({ chatgpt_account_id: 123 })),
      ),
      {},
    )
  })

  it("keeps valid account ids when other claim locations are malformed", () => {
    assert.strictEqual(
      Option.getOrUndefined(
        extractAccountIdFromToken(
          createTestJwt({
            chatgpt_account_id: "acc-root",
            "https://api.openai.com/auth": "invalid",
          }),
        ),
      ),
      "acc-root",
    )
    assert.strictEqual(
      Option.getOrUndefined(
        extractAccountIdFromToken(
          createTestJwt({
            "https://api.openai.com/auth": {
              chatgpt_account_id: "acc-nested",
            },
            organizations: [123],
          }),
        ),
      ),
      "acc-nested",
    )
  })

  it("extracts account ids from the documented claim locations", () => {
    assert.strictEqual(
      Option.getOrUndefined(
        extractAccountIdFromClaims({ chatgpt_account_id: "acc-root" }),
      ),
      "acc-root",
    )
    assert.strictEqual(
      Option.getOrUndefined(
        extractAccountIdFromClaims({
          "https://api.openai.com/auth": {
            chatgpt_account_id: "acc-nested",
          },
        }),
      ),
      "acc-nested",
    )
    assert.strictEqual(
      Option.getOrUndefined(
        extractAccountIdFromClaims({
          organizations: [{ id: "org-123" }, { id: "org-456" }],
        }),
      ),
      "org-123",
    )
  })

  it("prefers root claims over nested and organization fallbacks", () => {
    assert.strictEqual(
      Option.getOrUndefined(
        extractAccountIdFromClaims({
          chatgpt_account_id: "acc-root",
          "https://api.openai.com/auth": {
            chatgpt_account_id: "acc-nested",
          },
          organizations: [{ id: "org-123" }],
        }),
      ),
      "acc-root",
    )
  })

  it("treats empty root and nested account ids as missing", () => {
    assert.strictEqual(
      Option.getOrUndefined(
        extractAccountIdFromClaims({
          chatgpt_account_id: "",
          "https://api.openai.com/auth": {
            chatgpt_account_id: "acc-nested",
          },
        }),
      ),
      "acc-nested",
    )
    assert.strictEqual(
      Option.getOrUndefined(
        extractAccountIdFromClaims({
          chatgpt_account_id: "",
          "https://api.openai.com/auth": {
            chatgpt_account_id: "",
          },
          organizations: [{ id: "org-123" }],
        }),
      ),
      "org-123",
    )
  })

  it("treats empty organization ids as missing", () => {
    assert.strictEqual(
      Option.isNone(
        extractAccountIdFromClaims({
          organizations: [{ id: "" }],
        }),
      ),
      true,
    )
  })

  it("returns none when no account id claim is present", () => {
    assert.strictEqual(
      Option.isNone(
        extractAccountIdFromClaims({
          organizations: [],
        }),
      ),
      true,
    )
  })

  it("extracts account ids directly from JWTs", () => {
    assert.strictEqual(
      Option.getOrUndefined(
        extractAccountIdFromToken(
          createTestJwt({
            "https://api.openai.com/auth": {
              chatgpt_account_id: "acc-token",
            },
          }),
        ),
      ),
      "acc-token",
    )
    assert.strictEqual(
      Option.isNone(extractAccountIdFromToken("invalid")),
      true,
    )
  })

  it.effect(
    "preserves the stored account id when refreshed tokens omit parseable claims",
    () =>
      Effect.gen(function* () {
        const kvs = yield* KeyValueStore.KeyValueStore
        const tokenStore = toTokenStore(kvs)
        yield* Effect.orDie(
          tokenStore.set(
            STORE_TOKEN_KEY,
            new TokenData({
              access: "stale-access-token",
              refresh: "stale-refresh-token",
              expires: Date.now() - 60_000,
              accountId: Option.some("persisted-account"),
            }),
          ),
        )

        const { attempts, client } = yield* makeClient(() =>
          jsonResponse({
            id_token: "invalid",
            access_token: "also-invalid",
            refresh_token: "next-refresh-token",
            expires_in: 120,
          }),
        )

        const auth = yield* CodexAuth.make.pipe(
          Effect.provideService(HttpClient.HttpClient, client),
        )

        const token = yield* auth.get

        assert.strictEqual(token.refresh, "next-refresh-token")
        assert.strictEqual(
          Option.getOrUndefined(token.accountId),
          "persisted-account",
        )
        assert.strictEqual(yield* Ref.get(attempts), 1)

        const stored = yield* Effect.orDie(tokenStore.get(STORE_TOKEN_KEY))
        assert.strictEqual(Option.isSome(stored), true)
        if (Option.isNone(stored)) {
          return
        }

        assert.strictEqual(
          Option.getOrUndefined(stored.value.accountId),
          "persisted-account",
        )
      }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  )

  it.effect(
    "falls back to device auth when refreshing an expired token fails",
    () =>
      Effect.gen(function* () {
        const kvs = yield* KeyValueStore.KeyValueStore
        const tokenStore = toTokenStore(kvs)
        yield* Effect.orDie(
          tokenStore.set(
            STORE_TOKEN_KEY,
            new TokenData({
              access: "stale-access-token",
              refresh: "stale-refresh-token",
              expires: Date.now() - 60_000,
              accountId: Option.some("stale-account"),
            }),
          ),
        )

        const { client, requests } = yield* makeClient((request) => {
          if (request.url === `${ISSUER}/api/accounts/deviceauth/usercode`) {
            return jsonResponse({
              device_auth_id: "device-auth-id",
              user_code: "WXYZ-9876",
              interval: "1",
            })
          }

          if (request.url === `${ISSUER}/api/accounts/deviceauth/token`) {
            return jsonResponse({
              authorization_code: "authorization-code",
              code_verifier: "code-verifier",
            })
          }

          if (request.url === `${ISSUER}/oauth/token`) {
            const body = new URLSearchParams(getBody(request))
            if (body.get("grant_type") === "refresh_token") {
              return new Response(null, { status: 401 })
            }

            return jsonResponse({
              id_token: createTestJwt({
                chatgpt_account_id: "account-from-id",
              }),
              access_token: createTestJwt({
                chatgpt_account_id: "account-from-access",
              }),
              refresh_token: "next-refresh-token",
              expires_in: 120,
            })
          }

          return new Response(null, { status: 500 })
        })

        const auth = yield* CodexAuth.make.pipe(
          Effect.provideService(HttpClient.HttpClient, client),
        )

        const token = yield* auth.get

        assert.strictEqual(token.refresh, "next-refresh-token")
        assert.strictEqual(
          Option.getOrUndefined(token.accountId),
          "account-from-id",
        )

        const stored = yield* Effect.orDie(tokenStore.get(STORE_TOKEN_KEY))
        assert.strictEqual(Option.isSome(stored), true)
        if (Option.isSome(stored)) {
          assert.strictEqual(stored.value.refresh, "next-refresh-token")
        }

        const seenRequests = yield* Ref.get(requests)
        assert.strictEqual(seenRequests.length, 4)
        assert.strictEqual(seenRequests[0]?.url, `${ISSUER}/oauth/token`)
        assert.strictEqual(
          new URLSearchParams(getBody(seenRequests[0]!)).get("grant_type"),
          "refresh_token",
        )
        assert.strictEqual(
          new URLSearchParams(getBody(seenRequests[3]!)).get("grant_type"),
          "authorization_code",
        )
      }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  )

  it.effect("clears corrupted persisted tokens before re-authenticating", () =>
    Effect.gen(function* () {
      const kvs = yield* KeyValueStore.KeyValueStore
      yield* Effect.orDie(
        kvs.set(`${STORE_PREFIX}${STORE_TOKEN_KEY}`, "not-json"),
      )

      const { attempts, client } = yield* makeClient((request) => {
        if (request.url === `${ISSUER}/api/accounts/deviceauth/usercode`) {
          return jsonResponse({
            device_auth_id: "device-auth-id",
            user_code: "ABCD-EFGH",
            interval: "1",
          })
        }

        if (request.url === `${ISSUER}/api/accounts/deviceauth/token`) {
          return jsonResponse({
            authorization_code: "authorization-code",
            code_verifier: "code-verifier",
          })
        }

        if (request.url === `${ISSUER}/oauth/token`) {
          return jsonResponse({
            access_token: createTestJwt({
              chatgpt_account_id: "fresh-account",
            }),
            refresh_token: "fresh-refresh-token",
            expires_in: 120,
          })
        }

        return new Response(null, { status: 500 })
      })

      const auth = yield* CodexAuth.make.pipe(
        Effect.provideService(HttpClient.HttpClient, client),
      )

      assert.strictEqual(
        yield* Effect.orDie(kvs.get(`${STORE_PREFIX}${STORE_TOKEN_KEY}`)),
        undefined,
      )
      assert.strictEqual(yield* Ref.get(attempts), 0)

      const token = yield* auth.get

      assert.strictEqual(token.refresh, "fresh-refresh-token")
      assert.strictEqual(
        Option.getOrUndefined(token.accountId),
        "fresh-account",
      )
      assert.strictEqual(yield* Ref.get(attempts), 3)
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  )

  it.effect("serializes concurrent get calls behind one refresh", () =>
    Effect.gen(function* () {
      const kvs = yield* KeyValueStore.KeyValueStore
      const tokenStore = toTokenStore(kvs)
      yield* Effect.orDie(
        tokenStore.set(
          STORE_TOKEN_KEY,
          new TokenData({
            access: "expired-access-token",
            refresh: "refresh-token",
            expires: Date.now() - 60_000,
            accountId: Option.none(),
          }),
        ),
      )

      const refreshStarted = yield* Deferred.make<void>()
      const releaseRefresh = yield* Deferred.make<void>()
      const { attempts, client } = yield* makeEffectClient((request) => {
        if (request.url !== `${ISSUER}/oauth/token`) {
          return Effect.succeed(new Response(null, { status: 500 }))
        }

        const body = new URLSearchParams(getBody(request))
        if (body.get("grant_type") !== "refresh_token") {
          return Effect.succeed(new Response(null, { status: 500 }))
        }

        return Effect.gen(function* () {
          yield* Deferred.succeed(refreshStarted, void 0)
          yield* Deferred.await(releaseRefresh)
          return jsonResponse({
            access_token: createTestJwt({
              chatgpt_account_id: "fresh-account",
            }),
            refresh_token: "fresh-refresh-token",
            expires_in: 120,
          })
        })
      })

      const auth = yield* CodexAuth.make.pipe(
        Effect.provideService(HttpClient.HttpClient, client),
      )

      const firstFiber = yield* auth.get.pipe(
        Effect.forkChild({ startImmediately: true }),
      )
      yield* Deferred.await(refreshStarted)

      const secondFiber = yield* auth.get.pipe(
        Effect.forkChild({ startImmediately: true }),
      )
      yield* Effect.yieldNow

      assert.strictEqual(yield* Ref.get(attempts), 1)

      yield* Deferred.succeed(releaseRefresh, void 0)

      const first = yield* Fiber.join(firstFiber)
      const second = yield* Fiber.join(secondFiber)

      assert.strictEqual(yield* Ref.get(attempts), 1)
      assert.strictEqual(first.refresh, "fresh-refresh-token")
      assert.strictEqual(second.refresh, "fresh-refresh-token")
      assert.strictEqual(
        Option.getOrUndefined(first.accountId),
        "fresh-account",
      )
      assert.strictEqual(
        Option.getOrUndefined(second.accountId),
        "fresh-account",
      )
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  )

  it.effect(
    "forces device auth on authenticate and clears cache plus storage on logout",
    () =>
      Effect.gen(function* () {
        const kvs = yield* KeyValueStore.KeyValueStore
        const tokenStore = toTokenStore(kvs)
        yield* Effect.orDie(
          tokenStore.set(
            STORE_TOKEN_KEY,
            new TokenData({
              access: "cached-access-token",
              refresh: "cached-refresh-token",
              expires: Date.now() + 600_000,
              accountId: Option.some("cached-account"),
            }),
          ),
        )

        let deviceFlowCount = 0
        const { attempts, client } = yield* makeClient((request) => {
          if (request.url === `${ISSUER}/api/accounts/deviceauth/usercode`) {
            deviceFlowCount += 1
            return jsonResponse({
              device_auth_id: `device-auth-${deviceFlowCount}`,
              user_code: `CODE-${deviceFlowCount}`,
              interval: "1",
            })
          }

          if (request.url === `${ISSUER}/api/accounts/deviceauth/token`) {
            return jsonResponse({
              authorization_code: `authorization-code-${deviceFlowCount}`,
              code_verifier: `code-verifier-${deviceFlowCount}`,
            })
          }

          if (request.url === `${ISSUER}/oauth/token`) {
            return jsonResponse({
              access_token: createTestJwt({
                chatgpt_account_id: `device-account-${deviceFlowCount}`,
              }),
              refresh_token: `device-refresh-${deviceFlowCount}`,
              expires_in: 120,
            })
          }

          return new Response(null, { status: 500 })
        })

        const auth = yield* CodexAuth.make.pipe(
          Effect.provideService(HttpClient.HttpClient, client),
        )

        const cachedToken = yield* auth.get
        assert.strictEqual(cachedToken.refresh, "cached-refresh-token")
        assert.strictEqual(yield* Ref.get(attempts), 0)

        const authenticated = yield* auth.authenticate
        assert.strictEqual(authenticated.refresh, "device-refresh-1")
        assert.strictEqual(
          Option.getOrUndefined(authenticated.accountId),
          "device-account-1",
        )
        assert.strictEqual(yield* Ref.get(attempts), 3)

        yield* auth.logout
        const storedAfterLogout = yield* Effect.orDie(
          tokenStore.get(STORE_TOKEN_KEY),
        )
        assert.strictEqual(Option.isNone(storedAfterLogout), true)

        const tokenAfterLogout = yield* auth.get
        assert.strictEqual(tokenAfterLogout.refresh, "device-refresh-2")
        assert.strictEqual(
          Option.getOrUndefined(tokenAfterLogout.accountId),
          "device-account-2",
        )
        assert.strictEqual(yield* Ref.get(attempts), 6)
      }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  )
})
