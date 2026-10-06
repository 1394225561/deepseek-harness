/** Provider, language, and external-service disclosure on the Plugins page. */
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { useId } from 'react'
import { Button, SettingsForm, SettingsValueField, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS, formLabels } from './locales.ts'
import type { TranslationFormInjected } from './preferences-form.ts'
import css from './Translation.module.css'

export type TranslationSettingsProps = PropsRuntime<'plugins.bundle.config'> & PropsLocale<typeof NS> & InjectFace<TranslationFormInjected>

/**
 * Render staged translation preferences and name which text leaves the Host.
 * @param props - current draft fields, accepted-value metadata, and save actions.
 * @returns the bundle's translation preferences.
 */
export function TranslationSettings(props: TranslationSettingsProps) {
  const { t } = props
  const providerId = useId(), languageId = useId()
  const state = props.useTranslationForm(value => value)
  const disabled = !state.writable || state.saving
  return <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
    <p className={css.notice}>{t('privacy')}</p>
    <div className={css.field}>
      <div className={css.toolbar}>
        <label htmlFor={providerId}>{t('provider')}</label>
        {state.provider.overridden && <><Tag tone="neutral">{t('overridden')}</Tag>
          <Button size="sm" disabled={disabled} onClick={() => { props.resetField('provider') }}>{t('reset')}</Button></>}
      </div>
      <select id={providerId} value={state.provider.text} disabled={disabled} aria-invalid={state.provider.invalid || undefined}
        onChange={(event) => { props.edit('provider', event.target.value) }}>
        <option value="bing">{t('bing')}</option>
        <option value="google">{t('google')}</option>
      </select>
      {state.provider.invalid && <p role="status">{t('invalidProvider')}</p>}
    </div>
    <SettingsValueField id={languageId} label={t('targetLanguage')} hint={t('targetLanguageHint')}
      {...state.targetLanguage} overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidLanguage')}
      disabled={disabled} onEdit={(value) => { props.edit('targetLanguage', value) }} onReset={() => { props.resetField('targetLanguage') }} />
  </SettingsForm>
}
