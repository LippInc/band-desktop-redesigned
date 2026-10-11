import type { SeriesLine } from '@/lib/analytics'
import { cn } from '@/lib/utils'

/**
 * The charts Analytics draws, in ZCode's idiom: hairline axes at the quieter ink, no frame, and the series on the five
 * chart tokens (`docs/DESIGN.md`). They are drawn here rather than brought in, because a bar and a line over a shared
 * axis are all the screen needs and a chart library would decide the look.
 *
 * A chart is given every series and the keys of the ones hidden, never a filtered list: a line's colour is its place in
 * the whole series, so hiding one does not hand its colour to the next and leave the names beneath saying otherwise.
 *
 * Each one is one image to a screen reader, named by what it shows, because a bar at a time says nothing useful; the
 * numbers themselves are in the tables under the charts.
 */

const STEPS = 4
const HEIGHT = 180
const AXIS = 34
const PAD = 8
const PLOT = 600

/**
 * The axis under a chart: a round step, and a top that is a whole number of those steps at or above the highest value.
 * The step is what has to read well - 0, 20, 40, 60 rather than 0, 15, 30, 44 - so the number of steps varies and the
 * step itself does not. A chart with nothing in it gets Jam's own empty axis, 0.0 to 1.0.
 */
export function axisScale(highest: number): { top: number; step: number } {
  if (!Number.isFinite(highest) || highest <= 0) return { top: 1, step: 0.2 }
  const rough = highest / STEPS
  const size = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((part) => size * part).find((part) => part >= rough) ?? size * 10
  return { top: Math.ceil(highest / step) * step, step }
}

/** The axis labels, highest first, as the chart writes them down the left edge. */
export function axisTicks(top: number, step: number): number[] {
  const count = Math.max(1, Math.round(top / step))
  return Array.from({ length: count + 1 }, (_, index) => ((count - index) * top) / count)
}

/** How many decimals a step needs to be written exactly: a step of 2.5 needs one, one of 0.0025 needs four. */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || Number.isInteger(step)) return 0
  const text = step.toFixed(12).replace(/0+$/, '')
  const dot = text.indexOf('.')
  return dot < 0 ? 0 : Math.min(10, text.length - dot - 1)
}

/**
 * A label written to its own step's precision. Rounding every step to whole numbers turned a gridline at 7.5 into an
 * 8, and one decimal everywhere turned 0.75 into 0.8: the bar was drawn right and its own axis disagreed.
 */
export function tickText(value: number, step: number): string {
  const places = stepDecimals(step)
  return places === 0 ? Math.round(value).toLocaleString() : value.toFixed(places)
}

/**
 * How many labels to skip so they stay apart. A label is about 43 units wide in the chart's own coordinates against a
 * 600-unit plot, so the stride follows the count rather than one threshold: a month writes every third day, a year
 * does not write three hundred of them over each other.
 */
export function labelStride(count: number): number {
  if (count <= 1) return 1
  return Math.max(1, Math.ceil(count / 14))
}

function Axis({
  top,
  step,
  labels,
  at,
  edges,
}: {
  top: number
  step: number
  labels: readonly string[]
  /** Where a label's own point sits, so a label never drifts away from what it names. */
  at: (index: number) => number
  /** The first and last points sit on the plot's own edges, so their labels turn inwards instead of being cut off. */
  edges?: boolean
}) {
  const stride = labelStride(labels.length)
  const ticks = axisTicks(top, step)
  return (
    <>
      {ticks.map((tick, index) => {
        const y = PAD + (index * (HEIGHT - PAD)) / (ticks.length - 1)
        return (
          <g key={tick}>
            <text x={AXIS - 6} y={y + 3} textAnchor="end" className="fill-foreground-subtlest text-ui-xs">
              {tickText(tick, step)}
            </text>
            {index === ticks.length - 1 ? (
              <line x1={AXIS} y1={y} x2={AXIS + PLOT} y2={y} className="stroke-line-strong" />
            ) : null}
          </g>
        )
      })}
      {labels.map((label, index) =>
        index % stride === 0 ? (
          // A label loses its year, so two points twelve months apart share one; the point is the key.
          <text
            key={index}
            x={at(index)}
            y={HEIGHT + 14}
            textAnchor={edges && index === 0 ? 'start' : edges && index === labels.length - 1 ? 'end' : 'middle'}
            className="fill-foreground-subtlest text-ui-xs"
          >
            {label}
          </text>
        ) : null,
      )}
    </>
  )
}

interface ChartProps {
  labels: readonly string[]
  /** Every series, in its own order; a line's colour is its place here. */
  lines: readonly SeriesLine[]
  /** The keys not drawn. They keep their colour, so the names under the chart stay true. */
  hidden?: ReadonlySet<string>
  label: string
  className?: string
}

const SERIES_CLASS = ['fill-chart-1', 'fill-chart-2', 'fill-chart-3', 'fill-chart-4', 'fill-chart-5'] as const
const STROKE_CLASS = ['stroke-chart-1', 'stroke-chart-2', 'stroke-chart-3', 'stroke-chart-4', 'stroke-chart-5'] as const

/** The colour of the nth series, wrapping round once the five are used. */
export function seriesClass(index: number): string {
  return SERIES_CLASS[index % SERIES_CLASS.length] ?? SERIES_CLASS[0]
}

/** The axis every series of a chart shares: stacked bars are measured by their totals, lines by their own highest. */
function axisFor(lines: readonly SeriesLine[], stacked: boolean): { top: number; step: number } {
  const points = lines[0]?.values.length ?? 0
  const highest = stacked
    ? Math.max(
        0,
        ...Array.from({ length: points }, (_, at) => lines.reduce((sum, line) => sum + (line.values[at] ?? 0), 0)),
      )
    : Math.max(0, ...lines.flatMap((line) => line.values))
  return axisScale(highest)
}

/** The series a chart draws, each keeping the colour its place in the whole series gives it. */
function shownOf(lines: readonly SeriesLine[], hidden: ReadonlySet<string> | undefined) {
  return lines.map((line, colour) => ({ line, colour })).filter(({ line }) => !hidden?.has(line.key))
}

/** Bars over one axis; several series stack, as Jam's per-type chart does. */
export function BarChart({ labels, lines, hidden, label, className }: ChartProps) {
  const drawn = shownOf(lines, hidden)
  const { top, step } = axisFor(
    drawn.map(({ line }) => line),
    true,
  )
  const band = labels.length > 0 ? PLOT / labels.length : PLOT
  const width = band * 0.62
  const at = (index: number) => AXIS + band * index + band / 2
  return (
    <svg
      viewBox={`0 0 ${AXIS + PLOT} ${HEIGHT + 22}`}
      role="img"
      aria-label={label}
      className={cn('w-full', className)}
    >
      <Axis top={top} step={step} labels={labels} at={at} />
      {labels.map((point, index) => {
        let base = HEIGHT
        return (
          <g key={index}>
            {drawn.map(({ line, colour }) => {
              const value = line.values[index] ?? 0
              const height = ((HEIGHT - PAD) * value) / top
              base -= height
              return height <= 0 ? null : (
                <rect
                  key={line.key}
                  x={at(index) - width / 2}
                  y={base}
                  width={width}
                  height={height}
                  className={seriesClass(colour)}
                />
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}

/** A filled line per series, as Jam's per-agent chart draws them. */
export function AreaChart({ labels, lines, hidden, label, className }: ChartProps) {
  const drawn = shownOf(lines, hidden)
  const { top, step } = axisFor(
    drawn.map(({ line }) => line),
    false,
  )
  const gap = labels.length > 1 ? PLOT / (labels.length - 1) : PLOT / 2
  // The labels take the points' own spacing, so each one sits under what it names.
  const at = (index: number) => AXIS + gap * index
  const height = (value: number) => HEIGHT - ((HEIGHT - PAD) * value) / top
  return (
    <svg
      viewBox={`0 0 ${AXIS + PLOT} ${HEIGHT + 22}`}
      role="img"
      aria-label={label}
      className={cn('w-full', className)}
    >
      <Axis top={top} step={step} labels={labels} at={at} edges />
      {drawn.map(({ line, colour }) => {
        const points = line.values.map((value, index) => `${at(index)},${height(value)}`)
        if (points.length === 0) return null
        // A single point has no line to draw, so it is drawn as the point it is.
        if (points.length === 1) {
          return (
            <circle key={line.key} cx={at(0)} cy={height(line.values[0] ?? 0)} r={3} className={seriesClass(colour)} />
          )
        }
        return (
          <g key={line.key}>
            <path
              d={`M${AXIS},${HEIGHT} L${points.join(' L')} L${at(line.values.length - 1)},${HEIGHT} Z`}
              className={cn(seriesClass(colour), 'opacity-15')}
            />
            <path
              d={`M${points.join(' L')}`}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              className={STROKE_CLASS[colour % STROKE_CLASS.length]}
            />
          </g>
        )
      })}
    </svg>
  )
}

/** The small line beside the Activity number, with no axis of its own. */
export function Sparkline({ values, label }: { values: readonly number[]; label: string }) {
  const { top } = axisScale(Math.max(0, ...values))
  if (values.length === 0) return null
  const y = (value: number) => 20 - (18 * value) / top
  if (values.length === 1) {
    return (
      <svg viewBox="0 0 60 22" role="img" aria-label={label} className="h-6 w-16 shrink-0">
        <circle cx={30} cy={y(values[0] ?? 0)} r={2} className="fill-chart-1" />
      </svg>
    )
  }
  const step = 60 / (values.length - 1)
  const points = values.map((value, index) => `${step * index},${y(value)}`)
  return (
    <svg viewBox="0 0 60 22" role="img" aria-label={label} className="h-6 w-16 shrink-0">
      <path
        d={`M${points.join(' L')}`}
        fill="none"
        strokeWidth={1.5}
        strokeLinejoin="round"
        className="stroke-chart-1"
      />
    </svg>
  )
}

/** The names under a chart, each a switch that shows or hides its own series, as Jam's are. */
export function ChartLegend({
  lines,
  hidden,
  onToggle,
  label,
}: {
  lines: readonly SeriesLine[]
  hidden: ReadonlySet<string>
  onToggle: (key: string) => void
  label: string
}) {
  if (lines.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1" role="group" aria-label={label}>
      {lines.map((line, index) => (
        <button
          key={line.key}
          type="button"
          aria-pressed={!hidden.has(line.key)}
          onClick={() => onToggle(line.key)}
          className="flex items-center gap-1.5 rounded-md py-0.5 text-ui-sm text-foreground-subtle transition-colors hover:text-foreground"
        >
          <svg
            viewBox="0 0 8 8"
            aria-hidden="true"
            className={cn('size-2 shrink-0', hidden.has(line.key) && 'opacity-30')}
          >
            <rect width="8" height="8" rx="2" className={seriesClass(index)} />
          </svg>
          <span className={cn(hidden.has(line.key) && 'line-through opacity-60')}>{line.name}</span>
        </button>
      ))}
    </div>
  )
}
