/** Device selection owns microphone previews only while its portaled menu is open. */
import { useEffect, useRef, useState } from 'react'
import { IconCheckOutlineRegular, IconChevronDownOutlineRegular, Menu, StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { VoiceInputInjected } from './VoiceInput.tsx'
import { RecordingError, type Recording } from './audio.ts'
import type { MicrophoneDevice } from './microphone-device.ts'
import { NS } from './locales.ts'
import css from './VoiceInput.module.css'

function InputLevel({ recording, label }: { recording: Recording; label: string }) {
  const meter = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const bars = Array.from((meter.current as HTMLSpanElement).children)
    let frame: number
    const draw = (): void => {
      const decibels = 20 * Math.log10(Math.max(recording.amplitude(), 0.00001))
      const count = Math.ceil(Math.max(0, Math.min(1, (decibels + 60) / 60)) * bars.length)
      for (const [index, bar] of bars.entries()) bar.setAttribute('data-active', String(index < count))
      frame = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(frame) }
  }, [recording])
  return <span ref={meter} className={css.inputLevel} role="img" aria-label={label}>
    {Array.from({ length: 8 }, (_, index) => <span key={index} />)}
  </span>
}

/** Render the selected input and preview its measured level without recording audio. */
export function MicrophonePicker({ useMicrophoneDevice, selectMicrophone, createRecording, t }:
  Pick<InjectFace<VoiceInputInjected>, 'useMicrophoneDevice' | 'selectMicrophone' | 'createRecording'> & PropsLocale<typeof NS>) {
  const selected = useMicrophoneDevice(value => value)
  const [open, setOpen] = useState(false), [devices, setDevices] = useState<MicrophoneDevice[]>([])
  const [preview, setPreview] = useState<Recording>(), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!open) return
    const capture = createRecording(), media = (navigator as Partial<Navigator>).mediaDevices
    const lifetime = new AbortController()
    const release = (): void => { void capture.dispose().catch(() => undefined) }
    setPreview(undefined); setError('')
    const fail = (failure: unknown): void => {
      if (lifetime.signal.aborted) return
      release(); setPreview(undefined)
      setError(failure instanceof RecordingError ? t(failure.kind) : t('failed', {
        message: failure instanceof Error ? failure.message : String(failure),
      }))
    }
    const refresh = async (): Promise<void> => {
      if (!media) throw new RecordingError('unavailable')
      const inputs = (await media.enumerateDevices()).filter(device => device.kind === 'audioinput' && device.deviceId !== '' && device.deviceId !== 'default')
      if (!lifetime.signal.aborted) setDevices(inputs.map((device, index) => ({ id: device.deviceId,
        label: device.label || t('unnamedMicrophone', { number: String(index + 1) }) })))
    }
    void (async () => {
      try {
        await capture.preview(fail)
        if (!lifetime.signal.aborted) setPreview(capture)
      } catch (failure) { fail(failure) }
      if (lifetime.signal.aborted) return
      try { await refresh() } catch (failure) { fail(failure) }
    })()
    const changed = (): void => { setRevision(value => value + 1) }
    const hidden = (): void => { if (document.hidden) setOpen(false) }
    media?.addEventListener('devicechange', changed, { signal: lifetime.signal })
    document.addEventListener('visibilitychange', hidden, { signal: lifetime.signal })
    return () => {
      lifetime.abort()
      release()
    }
  }, [open, selected.id, revision, createRecording, t])
  const choices = [{ id: '', label: t('systemMicrophone') }, ...devices]
  const title = selected.id === '' ? t('systemMicrophone') : selected.label
  return <div className={css.deviceRow}>
    <span>{t('inputDevice')}</span>
    <Menu open={open} onClose={() => { setOpen(false) }} portal autoFocus dense selection="fill"
      className={css.deviceAnchor} listClassName={css.deviceMenu} selectedId={selected.id}
      items={choices.map(device => ({ id: device.id,
        icon: <span className={css.deviceCheck}>{device.id === selected.id && <IconCheckOutlineRegular />}</span>,
        label: <span className={css.deviceOption}>
          <Tooltip label={device.label} portal><span className={css.deviceName}>{device.label}</span></Tooltip>
          {device.id === selected.id && (preview ? <InputLevel recording={preview} label={t('inputLevel')} />
            : !error && <StateDot state="ongoing" />)}
        </span>,
      }))}
      onSelect={(id) => { selectMicrophone(choices.find(item => item.id === id) as MicrophoneDevice) }}
      footer={error ? [{ id: 'error', type: 'label', text: error }] : []}
      anchor={<button type="button" className={css.deviceTrigger} aria-label={t('inputDevice')}
        aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        <span className={css.deviceName}>{title}</span><IconChevronDownOutlineRegular />
      </button>} />
  </div>
}
