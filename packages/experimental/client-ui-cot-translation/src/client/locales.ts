/** Locale-owned copy for reasoning translation and its preferences. */
import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Dictionary namespace for this plugin. */
export const NS = 'cotTranslation'

/** English copy and key source. */
export const en = {
  provider: 'Translation service', google: 'Google', bing: 'Bing', targetLanguage: 'Target language',
  targetLanguageHint: 'auto follows the UI language; language codes such as zh, en, and ja also work.',
  privacy: 'Expanded reasoning is sent to the selected service. It may contain private code or conversation details.',
  translation: 'Translation', original: 'Original', retry: 'Retry', failed: 'Translation failed. The original is still available.',
  translating: 'Translating reasoning', invalidProvider: 'Choose a translation service.', invalidLanguage: 'Enter auto or a language code, such as zh, en, or ja.',
  overridden: 'Overridden', reset: 'Reset to default',
  unavailable: 'Translation preferences are unavailable.', readOnly: 'This deployment stores settings read-only.',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.', save: 'Save', saving: 'Saving…',
  copy: 'Copy', copied: 'Copied', codeTitle: 'Code block', wrap: 'Wrap lines', unwrap: 'Unwrap lines', footnotes: 'Footnotes',
}

/** Locale dictionary key union. */
export type CotTranslationKey = keyof typeof en

/** Chinese copy. */
export const zh: Record<CotTranslationKey, string> = {
  provider: '翻译服务', google: 'Google', bing: 'Bing', targetLanguage: '目标语言',
  targetLanguageHint: 'auto 使用界面语言；也可填写语言代码，例如 zh、en、ja',
  privacy: '展开的思考内容会发送给所选翻译服务，可能包含私有代码或对话细节。',
  translation: '译文', original: '原文', retry: '重试', failed: '翻译失败，已保留原文',
  translating: '正在翻译思考内容', invalidProvider: '请选择翻译服务', invalidLanguage: '请填写 auto 或语言代码，例如 zh、en、ja',
  overridden: '已覆盖', reset: '恢复默认',
  unavailable: '翻译设置暂不可用', readOnly: '本部署的设置为只读',
  saveFailed: '本部署没有接受这些值，已保留供你修改', save: '保存', saving: '保存中…',
  copy: '复制', copied: '已复制', codeTitle: '代码块', wrap: '自动换行', unwrap: '不换行', footnotes: '脚注',
}

/**
 * Read shared form chrome from the plugin dictionary.
 * @param t - current locale reader.
 * @returns localized form labels.
 */
export function formLabels(t: (key: CotTranslationKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
