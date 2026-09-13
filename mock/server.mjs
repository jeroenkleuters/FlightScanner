/**
 * The dev-only mock feed server.
 *
 * It impersonates **OpenSky upstream**, not this project's proxy. Point
 * `OPENSKY_API_BASE` and `OPENSKY_AUTH_URL` at it and the whole real stack runs
 * unchanged: the proxy's validation and error classification, the client's
 * positional decoding, the store, the map. A mock that stood in for our own
 * proxy would bypass exactly the layer the polling and status features have to
 * trust.
 *
 * Nothing under `src/` or `api/` may import this file. See docs/mock-feed.md.
 */

import { createServer } from 'node:http'
import { loadFixtureStates, visibleStates } from './feed.mjs'

const HOST = '127.0.0.1'
const DEFAULT_PORT = 8787
const DEFAULT_CREDITS = 4000

/** How far into the past the `stale` fault backdates every contact time. */
const STALE_BACKDATE_SECONDS = 600

const CREDIT_HEADER = 'X-Rate-Limit-Remaining'

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  // Deliberately no Access-Control-Allow-Origin. The app reaches this server
  // through the proxy, server to server; nothing should call it from a page.
}

export const FAULT_MODES = [
  'off',
  'server-error',
  'rate-limited',
  'unauthorized',
  'malformed',
  'empty',
  'stale',
]

const states = loadFixtureStates()

function positiveInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function createMockState({ credits }) {
  return {
    startedAtMs: Date.now(),
    fault: 'off',
    credits,
    configuredCredits: credits,
  }
}

const elapsedSeconds = (state) => (Date.now() - state.startedAtMs) / 1000
const nowSeconds = () => Math.floor(Date.now() / 1000)

function send(response, status, body, headers = {}) {
  response.writeHead(status, { ...JSON_HEADERS, ...headers })
  response.end(body === undefined ? '' : JSON.stringify(body))
}

const sendError = (response, code, status, headers = {}) =>
  send(response, status, { error: code }, headers)

function finiteParam(params, key) {
  const raw = params.get(key)
  if (raw === null || raw.trim() === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/**
 * The same four parameters the real endpoint takes. Filtering for real matters:
 * without it the feed would look identical whatever box the client asked for,
 * and a wrong box would never show up as wrong.
 */
function parseBoundingBox(params) {
  const lamin = finiteParam(params, 'lamin')
  const lomin = finiteParam(params, 'lomin')
  const lamax = finiteParam(params, 'lamax')
  const lomax = finiteParam(params, 'lomax')

  if (
    lamin === undefined ||
    lomin === undefined ||
    lamax === undefined ||
    lomax === undefined
  ) {
    return undefined
  }
  if (lamin > lamax || lomin > lomax) return undefined

  return { lamin, lomin, lamax, lomax }
}

const LONGITUDE = 5
const LATITUDE = 6
const TIME_POSITION = 3
const LAST_CONTACT = 4

/**
 * Positionless vectors are kept whatever the box says, which is what OpenSky
 * does and what the store's locked rule expects: an aircraft without a fix
 * still counts and may get one in a later snapshot.
 */
function insideBox(vector, box) {
  const lat = vector[LATITUDE]
  const lon = vector[LONGITUDE]
  if (typeof lat !== 'number' || typeof lon !== 'number') return true

  return (
    lat >= box.lamin && lat <= box.lamax && lon >= box.lomin && lon <= box.lomax
  )
}

function backdate(vector) {
  const aged = vector.slice()
  aged[TIME_POSITION] -= STALE_BACKDATE_SECONDS
  aged[LAST_CONTACT] -= STALE_BACKDATE_SECONDS
  return aged
}

function snapshot(state, box) {
  const now = nowSeconds()
  const visible = visibleStates(states, elapsedSeconds(state), now).filter(
    (vector) => insideBox(vector, box),
  )

  const shaped = state.fault === 'stale' ? visible.map(backdate) : visible

  // Null, not [], for an empty box. That is OpenSky's shape, and both the proxy
  // handler and the client decoder are written against it.
  return { time: now, states: shaped.length === 0 ? null : shaped }
}

function handleStates(state, params, response) {
  if (state.fault === 'server-error') {
    response.writeHead(503, JSON_HEADERS)
    response.end()
    return
  }
  if (state.fault === 'unauthorized') {
    return sendError(response, 'unauthorized', 401)
  }
  if (state.fault === 'rate-limited' || state.credits <= 0) {
    return sendError(response, 'rate-limited', 429, { [CREDIT_HEADER]: '0' })
  }

  const box = parseBoundingBox(params)
  if (box === undefined) return sendError(response, 'invalid-request', 400)

  state.credits = Math.max(0, state.credits - 1)
  const headers = { [CREDIT_HEADER]: String(state.credits) }

  if (state.fault === 'malformed') {
    // A 200 whose body the proxy cannot use, which is a different failure from
    // an upstream that is simply down.
    return send(response, 200, { time: 'soon' }, headers)
  }
  if (state.fault === 'empty') {
    return send(response, 200, { time: nowSeconds(), states: null }, headers)
  }

  return send(response, 200, snapshot(state, box), headers)
}

function handleToken(state, response) {
  if (state.fault === 'unauthorized') {
    return sendError(response, 'unauthorized', 401)
  }

  // The two fields src/server/openskyToken.ts reads: it throws without
  // access_token and treats a missing expires_in as an immediate expiry.
  return send(response, 200, {
    access_token: 'mock-access-token',
    expires_in: 1800,
  })
}

function controlState(state) {
  return {
    fault: state.fault,
    credits: state.credits,
    elapsedSeconds: Math.floor(elapsedSeconds(state)),
    visible: visibleStates(states, elapsedSeconds(state), nowSeconds()).length,
  }
}

function readJsonBody(request) {
  return new Promise((resolve) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      if (raw.trim() === '') return resolve({})
      try {
        const parsed = JSON.parse(raw)
        resolve(
          typeof parsed === 'object' && parsed !== null ? parsed : undefined,
        )
      } catch {
        resolve(undefined)
      }
    })
    request.on('error', () => resolve(undefined))
  })
}

async function handleControlUpdate(state, request, response) {
  const body = await readJsonBody(request)
  if (body === undefined) return sendError(response, 'invalid-request', 400)

  // Validated before anything is applied, so a bad field cannot leave the mock
  // half-changed and quietly lying about its own state.
  if (body.fault !== undefined && !FAULT_MODES.includes(body.fault)) {
    return sendError(response, 'invalid-request', 400)
  }
  if (body.credits !== undefined && !positiveInteger(body.credits)) {
    return sendError(response, 'invalid-request', 400)
  }

  if (body.fault !== undefined) state.fault = body.fault
  if (body.credits !== undefined) state.credits = body.credits

  return send(response, 200, controlState(state))
}

function handleReset(state, response) {
  state.startedAtMs = Date.now()
  state.fault = 'off'
  state.credits = state.configuredCredits
  return send(response, 200, controlState(state))
}

export function createMockFeedServer({ credits = DEFAULT_CREDITS } = {}) {
  const state = createMockState({ credits })

  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${HOST}`)
    const { pathname } = url
    const method = request.method ?? 'GET'

    if (pathname === '/states/all' && method === 'GET') {
      return handleStates(state, url.searchParams, response)
    }
    if (pathname === '/token' && method === 'POST') {
      return handleToken(state, response)
    }
    if (pathname === '/__mock/control' && method === 'GET') {
      return send(response, 200, controlState(state))
    }
    if (pathname === '/__mock/control' && method === 'POST') {
      return void handleControlUpdate(state, request, response)
    }
    if (pathname === '/__mock/reset' && method === 'POST') {
      return handleReset(state, response)
    }

    return sendError(response, 'not-found', 404)
  })
}

const port = Number(process.env.MOCK_PORT ?? DEFAULT_PORT)
const startingCredits = Number(process.env.MOCK_CREDITS ?? DEFAULT_CREDITS)

// Loopback only, and not a default worth overriding: this server has no
// authentication and its control routes let any caller reshape the feed.
createMockFeedServer({ credits: startingCredits }).listen(port, HOST, () => {
  console.log(`mock OpenSky feed on http://${HOST}:${port}`)
  console.log(
    `  ${states.length} aircraft from docs/fixtures/opensky-states-nl.json`,
  )
  console.log(`  set OPENSKY_API_BASE=http://${HOST}:${port} and`)
  console.log(`      OPENSKY_AUTH_URL=http://${HOST}:${port}/token in .env`)
  console.log(`  faults: curl -X POST http://${HOST}:${port}/__mock/control \\`)
  console.log(`            -d '{"fault":"rate-limited"}'`)
})
