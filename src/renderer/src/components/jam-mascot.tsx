import { useId } from 'react'

import { cn } from '@/lib/utils'

/**
 * Jam's mascot, as Jam Desktop shows it above "Assign work". It is BAND's own artwork, taken from the mascot in the
 * wordmark on their public site and used unchanged: the six shapes of the mascot, with the four letterforms beside it
 * left behind. Nothing here comes out of the installed app. It keeps BAND's colours in every theme, because it is their
 * logo and not this app's palette.
 */
export function JamMascot({ className }: { className?: string }) {
  // Two mascots on one page would otherwise share one gradient id, and React's own ids carry characters that url(#...)
  // cannot take.
  const gradient = `jam-mascot-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <svg viewBox="0 0 144 144" aria-hidden="true" className={cn('size-14', className)}>
      <path
        d="M70.206 0.0919995C73.559 -0.204 77.838 0.2718 81.148 0.7039C94.893 2.3764 107.79 7.768 118.205 16.1955C133.467 28.5365 142.702 46.0074 143.833 64.68C145.167 83.082 138.46 101.212 125.203 115.038C117.458 123.253 107.638 129.589 96.608 133.486C89.094 136.166 82.374 137.304 74.336 137.765C56.543 138.158 39.2466 132.341 25.9176 121.481C15.8501 113.352 8.27011 102.937 3.93171 91.273C-8.30979 57.318 8.8634 20.2914 43.9221 5.5715C52.369 2.0251 61.019 0.5543 70.206 0.0919995Z"
        className="fill-jam-mascot-ink"
      />
      <path
        d="M68.824 5.36672C73.939 4.78522 80.288 5.66482 85.274 6.56382C95.992 8.49622 105.368 12.8547 113.761 19.2552C143.129 41.6537 147.341 82.992 122.97 110.015C111.046 123.258 95.548 130.859 76.925 132.502C59.913 133.422 43.196 128.11 30.4126 117.72C22.8638 111.692 17.1233 104.6 12.8535 96.276C-7.31448 56.96 20.6029 8.52672 68.824 5.36672Z"
        fill={`url(#${gradient})`}
      />
      <path
        d="M79.27 16.638C106.78 15.2657 130.193 36.4538 131.565 63.963C132.937 91.472 111.749 114.885 84.24 116.257C56.731 117.629 33.3182 96.441 31.9459 68.932C30.5736 41.4232 51.7616 18.0105 79.27 16.638Z"
        className="fill-jam-mascot-ink"
      />
      <path
        d="M66.1321 47.0815C68.8511 46.9275 70.5041 47.0562 72.6781 48.9438C77.0681 52.755 78.6851 58.793 79.0501 64.377C79.4691 70.811 78.5621 78.72 74.1191 83.743C72.5301 85.54 71.1691 86.746 68.7541 86.931C67.4301 87.216 64.9681 86.885 63.8801 86.148C56.4071 81.084 54.7161 68.471 56.5261 60.412C57.7271 55.067 60.5621 48.5532 66.1321 47.0815Z"
        className="fill-jam-mascot-eye"
      />
      <path
        d="M109.74 48.6211C121.222 47.7262 123.67 81.288 110.979 84.839C99.251 84.913 97.518 52.63 109.74 48.6211Z"
        className="fill-jam-mascot-eye"
      />
      <path
        d="M91.9 137.585C95.695 137.363 100.928 136.577 104.356 136.855C110.688 137.369 123.349 138.265 123.043 140.178C118.629 143.206 88.191 143.94 76.206 143.994C61.761 144.059 40.0302 143.668 27.6119 141.871C11.0856 139.479 32.3563 137.18 42.3727 136.749C43.8187 136.785 47.3707 137.193 48.9867 137.329C50.4854 137.455 51.002 137.489 52.64 137.567C50.0535 137.738 43.8548 138.248 43.0795 138.904C42.1472 139.693 49.4962 140.339 51.9585 140.489C65.833 141.337 80.729 141.305 94.49 140.362C96.117 140.251 98.868 139.849 100.362 139.647C100.619 139.524 100.882 139.396 101.016 139.262C101.242 139.033 101.063 138.792 100.517 138.592C99.224 138.128 94.249 137.698 91.9 137.585Z"
        className="fill-jam-mascot-ink"
      />
      <defs>
        <linearGradient id={gradient} x1="72.529" y1="5.17972" x2="72.529" y2="132.604" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--jam-mascot-top)" />
          <stop offset="1" stopColor="var(--jam-mascot-bottom)" />
        </linearGradient>
      </defs>
    </svg>
  )
}
