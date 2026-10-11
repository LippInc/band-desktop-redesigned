import { useEffect, useState } from 'react'

/** The current time, updated every `intervalMs`, for ages shown on screen ("3m", "9h"). */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
