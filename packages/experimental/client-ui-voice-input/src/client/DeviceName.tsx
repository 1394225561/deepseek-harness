/** Overflowing microphone names scroll only during sustained pointer hover. */
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './VoiceInput.module.css'

/**
 * Keep the surrounding device controls stationary while revealing a long name.
 * @param props.label - the complete localized device name.
 * @param props.unavailable - whether the device is disconnected.
 * @returns an ellipsized name with a delayed, reversible hover animation.
 */
export function DeviceName({ label, unavailable }: { label: string; unavailable?: boolean | undefined }) {
  const text = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(), animation = useRef<Animation>()
  const [scrolling, setScrolling] = useState(false)
  const stop = (): void => {
    clearTimeout(timer.current)
    animation.current?.cancel()
    animation.current = undefined
    setScrolling(false)
  }
  useEffect(() => stop, [label])
  const start = (event: PointerEvent<HTMLSpanElement>): void => {
    stop()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const outer = event.currentTarget, inner = text.current as HTMLSpanElement
    timer.current = setTimeout(() => {
      const distance = inner.getBoundingClientRect().width - outer.clientWidth
      if (distance <= 0) return
      const travel = distance / 30 * 1000, pause = 600, duration = 2 * (travel + pause)
      setScrolling(true)
      animation.current = inner.animate([
        { transform: 'translateX(0)', offset: 0 },
        { transform: `translateX(${-distance}px)`, offset: travel / duration },
        { transform: `translateX(${-distance}px)`, offset: (travel + pause) / duration },
        { transform: 'translateX(0)', offset: (2 * travel + pause) / duration },
        { transform: 'translateX(0)', offset: 1 },
      ], { duration, iterations: Infinity, easing: 'linear' })
    }, 100)
  }
  return <Tooltip label={label} disabled={scrolling} portal>
    <span className={css.deviceName} data-unavailable={unavailable} data-scrolling={scrolling || undefined}
      onPointerEnter={start} onPointerLeave={stop}><span ref={text}>{label}</span></span>
  </Tooltip>
}
