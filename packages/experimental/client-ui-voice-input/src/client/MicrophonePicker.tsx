/** Device selection owns microphone previews only while its portaled menu is open. */
import { useEffect, useRef, useState } from 'react'
import { IconCheckOutlineRegular, IconChevronDownOutlineRegular, Menu, StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { VoiceInputInjected } from './VoiceInput.tsx'
import { RecordingError, type Recording } from './audio.ts'
import type { MicrophoneDevice } from './microphone-device.ts'
import { NS } from './locales.ts'
import css from './VoiceInput.module.css'

interface DeviceChoice extends MicrophoneDevice { unavailable?: boolean }

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
  const [open, setOpen] = useState(false), [devices, setDevices] = useState<DeviceChoice[]>([])
  const [preview, setPreview] = useState<Recording>(), [error, setError] = useState('')
  useEffect(() => {
    const media = (navigator as Partial<Navigator>).mediaDevices
    const lifetime = new AbortController()
    let capture: Recording | undefined, enumeration = 0
    const release = (): void => {
      if (capture) void capture.dispose().catch(() => undefined)
      capture = undefined
    }
    setPreview(undefined); setError('')
    const fail = (failure: unknown): void => {
      if (lifetime.signal.aborted) return
      setError(failure instanceof RecordingError ? t(failure.kind) : t('failed', {
        message: failure instanceof Error ? failure.message : String(failure),
      }))
    }
    const acquire = async (): Promise<void> => {
      const recording = createRecording()
      capture = recording
      const interrupted = (failure: RecordingError): void => {
        if (capture !== recording || lifetime.signal.aborted) return
        release(); setPreview(undefined); fail(failure)
        void refresh()
      }
      try {
        await recording.preview(interrupted)
        if (capture !== recording || lifetime.signal.aborted) return
        setPreview(recording); setError('')
        void refresh()
      } catch (failure) {
        if (capture !== recording || lifetime.signal.aborted) return
        release(); setPreview(undefined); fail(failure)
      }
    }
    const refresh = async (): Promise<void> => {
      const request = ++enumeration
      try {
        if (!media) throw new RecordingError('unavailable')
        const inputs = (await media.enumerateDevices()).filter(device => device.kind === 'audioinput')
        if (lifetime.signal.aborted || request !== enumeration) return
        // Before permission, browsers may hide device ids and labels; absence then does not establish disconnection.
        const known = inputs.length === 0 || inputs.some(device => device.label !== '')
        const missing = selected.id === '' ? inputs.length === 0 : known && !inputs.some(device => device.deviceId === selected.id)
        const choices: DeviceChoice[] = [{ id: '', label: t('systemMicrophone'), unavailable: inputs.length === 0 },
          ...inputs.filter(device => device.deviceId !== '' && device.deviceId !== 'default').map((device, index) => ({
            id: device.deviceId, label: device.label || t('unnamedMicrophone', { number: String(index + 1) }),
          }))]
        setDevices((previous) => {
          const next = [...choices]
          if (selected.id !== '' && !next.some(device => device.id === selected.id)) {
            next.splice(Math.max(1, previous.findIndex(device => device.id === selected.id)), 0, { ...selected, unavailable: missing })
          }
          return next
        })
        if (missing) { release(); setPreview(undefined); setError('') }
        else if (open && !document.hidden && !capture) void acquire()
      } catch (failure) { if (request === enumeration) fail(failure) }
    }
    const changed = (): void => { void refresh() }
    const hidden = (): void => { if (document.hidden) setOpen(false); else changed() }
    media?.addEventListener('devicechange', changed, { signal: lifetime.signal })
    document.addEventListener('visibilitychange', hidden, { signal: lifetime.signal })
    changed()
    return () => {
      lifetime.abort()
      release()
    }
  }, [open, selected, createRecording, t])
  const choices = devices.filter(device => !device.unavailable || device.id === selected.id || device.id === '')
  const missing = choices.find(device => device.id === selected.id)?.unavailable
  const title = selected.id === '' ? t('systemMicrophone') : selected.label
  return <div className={css.deviceRow}>
    <span>{t('inputDevice')}</span>
    <Menu open={open} onClose={() => { setOpen(false) }} portal autoFocus dense selection="fill"
      className={css.deviceAnchor} listClassName={css.deviceMenu} selectedId={selected.id}
      items={choices.map(device => ({ id: device.id, disabled: device.unavailable === true,
        icon: <span className={css.deviceCheck}>{device.id === selected.id && <IconCheckOutlineRegular />}</span>,
        label: <span className={css.deviceOption}>
          <Tooltip label={device.label} portal><span className={css.deviceName}>{device.label}</span></Tooltip>
          {device.unavailable ? <span className={css.deviceStatus}>{t('deviceUnavailable')}</span>
            : device.id === selected.id && (preview ? <InputLevel recording={preview} label={t('inputLevel')} />
              : !error && <StateDot state="ongoing" />)}
        </span>,
      }))}
      onSelect={(id) => {
        const device = choices.find(item => item.id === id) as DeviceChoice
        selectMicrophone({ id: device.id, label: device.label })
      }}
      footer={error ? [{ id: 'error', type: 'label', text: error }] : []}
      anchor={<button type="button" className={css.deviceTrigger} aria-label={t('inputDevice')}
        aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        <span className={css.deviceName} data-unavailable={missing}>{title}</span>
        {missing && <span className={css.deviceStatus}>{t('deviceUnavailable')}</span>}<IconChevronDownOutlineRegular />
      </button>} />
  </div>
}
