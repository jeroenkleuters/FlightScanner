/**
 * A tiny evaluator for the handful of MapLibre expression forms this project
 * uses, so style expressions can be tested by their **results** rather than by
 * their shape.
 *
 * Asserting that `icon-color` is a particular nested array proves the array was
 * typed correctly, not that an aircraft at 17,000 ft comes out the right
 * colour. The done-whens are written in terms of altitudes, so the tests are
 * too.
 *
 * Lives in `src/test/` with the rest of the test infrastructure rather than
 * beside the style module: it is scaffolding, not part of the app.
 *
 * This mirrors MapLibre's documented semantics for `case`, `has`, `get`,
 * `coalesce`, `interpolate` with `linear`, `step`, and `zoom` - including
 * `interpolate`'s clamping at both ends. It is a test helper and is deliberately
 * not exported from the style module: production rendering is MapLibre's job.
 */

export interface EvalContext {
  properties?: Record<string, unknown>
  zoom?: number
}

type Expression = unknown

function isExpression(value: Expression): value is unknown[] {
  return Array.isArray(value)
}

/** Mixes two `#rrggbb` colours, matching `interpolate`'s per-channel blend. */
function mixHex(from: string, to: string, ratio: number): string {
  const channel = (hex: string, index: number) =>
    Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16)

  const mixed = [0, 1, 2].map((index) => {
    const value = Math.round(
      channel(from, index) +
        (channel(to, index) - channel(from, index)) * ratio,
    )
    return value.toString(16).padStart(2, '0')
  })

  return `#${mixed.join('')}`
}

function interpolate(input: number, stops: unknown[]): unknown {
  const points: Array<{ at: number; value: unknown }> = []
  for (let i = 0; i < stops.length; i += 2) {
    points.push({ at: stops[i] as number, value: stops[i + 1] })
  }

  // Clamped, not extrapolated: this is what keeps a negative altitude at the
  // ground colour rather than off the bottom of the ramp.
  if (input <= points[0].at) return points[0].value
  const last = points[points.length - 1]
  if (input >= last.at) return last.value

  for (let i = 0; i < points.length - 1; i += 1) {
    const lower = points[i]
    const upper = points[i + 1]
    if (input >= lower.at && input <= upper.at) {
      const ratio = (input - lower.at) / (upper.at - lower.at)
      if (typeof lower.value === 'number' && typeof upper.value === 'number') {
        return lower.value + (upper.value - lower.value) * ratio
      }
      return mixHex(lower.value as string, upper.value as string, ratio)
    }
  }

  return last.value
}

export function evaluate(
  expression: Expression,
  context: EvalContext,
): unknown {
  if (!isExpression(expression)) return expression

  const [operator, ...args] = expression
  const properties = context.properties ?? {}

  switch (operator) {
    case 'get':
      return properties[args[0] as string]
    case 'has':
      return Object.prototype.hasOwnProperty.call(properties, args[0] as string)
    case 'zoom':
      return context.zoom
    case 'coalesce': {
      for (const arg of args) {
        const value = evaluate(arg, context)
        if (value !== undefined && value !== null) return value
      }
      return null
    }
    case 'case': {
      // [condition, result] pairs, then a trailing fallback.
      for (let i = 0; i + 1 < args.length; i += 2) {
        if (evaluate(args[i], context)) return evaluate(args[i + 1], context)
      }
      return evaluate(args[args.length - 1], context)
    }
    case 'interpolate': {
      const input = evaluate(args[1], context) as number
      return interpolate(input, args.slice(2))
    }
    case 'step': {
      const input = evaluate(args[0], context) as number
      let result = args[1]
      for (let i = 2; i + 1 < args.length + 1; i += 2) {
        const threshold = args[i] as number
        if (input >= threshold) result = args[i + 1]
        else break
      }
      return evaluate(result, context)
    }
    default:
      return expression
  }
}
