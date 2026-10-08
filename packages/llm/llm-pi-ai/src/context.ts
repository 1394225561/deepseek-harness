/**
 * Harness request-history conversion into pi-ai's Context vocabulary.
 *
 * @module dsh-llm-pi-ai/context
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { contentHasImage, IMAGE_OFFLOAD_REQUIRED_CODE, LlmError, offloadedImageText, projectOffloadedImages, requestImageHandleText, requiredImageOffload } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, ImageAttachmentAccessResolver, Message, RequestMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type {
  AttachmentId,
  AttachmentStore,
  ImageAttachmentRef,
  ImageRequestTarget,
  RequestImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { Context as PiContext, ImageContent, Message as PiMessage, SystemMessage, TextContent, Tool as PiTool } from '@earendil-works/pi-ai'
import { toPiAssistant } from './replay.ts'
import { requestImageDimensions } from '@deepseek-ai/dsh-attachment'
import { DEFAULT_REQUEST_IMAGE_MAX_BYTES, DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET } from './config.ts'

/** Join the text blocks of a harness message. */
function flattenText(message: RequestMessage): string {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}


/** Recover the pi-ai toolResult message for one harness tool-role message. */
function toolResultOf(
  message: Extract<Message, { role: 'tool' }>,
  toolNames: Map<ToolCallId, string>,
  content: string | (TextContent | ImageContent)[],
): PiMessage {
  return {
    role: 'toolResult',
    toolCallId: message.toolCallId,
    toolName: toolNames.get(message.toolCallId) ?? 'unknown',
    content: typeof content === 'string'
      ? [{ type: 'text', text: content || '(no output)' }]
      : content,
    isError: message.isError ?? false,
    timestamp: 0,
  }
}

/** Reject misplaced tool-change blocks and unsupported image roles before replay or image offloading. */
function assertSupportedHistory(messages: readonly RequestMessage[]): void {
  for (const message of messages) {
    if (message.role !== 'developer' && message.content.some(block => block.type === 'tool-addition' || block.type === 'tool-removal')) {
      throw new LlmError('Tool-change blocks require developer role', 'UNSUPPORTED_CONTENT')
    }
    if (message.role !== 'user' && message.role !== 'tool' && contentHasImage(message.content)) {
      throw new LlmError(
        `pi-ai cannot represent an image in an in-history ${message.role} message`,
        'UNSUPPORTED_CONTENT',
      )
    }
  }
}

function userContent(
  blocks: readonly ContentBlock[],
  requestImages: ReadonlyMap<AttachmentId, RequestImageAttachment>,
  resolveImageAccess: ImageAttachmentAccessResolver,
): string | (TextContent | ImageContent)[] {
  const content: (TextContent | ImageContent)[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) content.push({ type: 'text', text: block.text })
        break
      case 'image': {
        const version = requestImages.get(block.attachment.attachmentId) as RequestImageAttachment
        content.push({
          type: 'text',
          text: requestImageHandleText(block.attachment, version, resolveImageAccess(block.attachment)),
        })
        content.push({
          type: 'image',
          data: Buffer.from(version.data).toString('base64'),
          mimeType: version.mediaType,
        })
        break
      }
      default:
        // Other merge-extensible blocks are not user-input vocabulary for pi-ai.
        break
    }
  }
  if (content.every(block => block.type === 'text')) return content.map(block => block.text).join('')
  return content
}

function collectImageRefs(
  blocks: readonly ContentBlock[],
  refs: Map<AttachmentId, ImageAttachmentRef>,
): void {
  for (const block of blocks) {
    if (block.type === 'image') {
      if (block.offloaded !== true) refs.set(block.attachment.attachmentId, block.attachment)
    }
  }
}

async function prepareRequestImages(
  messages: readonly RequestMessage[],
  attachments: AttachmentStore,
  budget: PiImageRequestBudget,
  signal?: AbortSignal,
): Promise<Map<AttachmentId, RequestImageAttachment>> {
  const refs = new Map<AttachmentId, ImageAttachmentRef>()
  for (const message of messages) collectImageRefs(message.content, refs)
  const orderedRefs = [...refs.values()]
  const prepared = await Promise.all(orderedRefs.map(
    ref => attachments.readImageRequest(ref, requestImageTarget(ref, budget), signal),
  ))
  const versions = new Map<AttachmentId, RequestImageAttachment>()
  for (const [index, ref] of orderedRefs.entries()) {
    versions.set(ref.attachmentId, prepared[index] as RequestImageAttachment)
  }
  return versions
}

/** Convert a projected declaration without its harness-owned activation marker. */
function piTool(tool: NonNullable<GenerateOptions['tools']>[number]): PiTool {
  return { name: tool.name, description: tool.description, parameters: tool.parameters }
}

/** Convert ordered history; pi-ai owns protocol placement and unsupported-model fallback. */
function conversationContext(
  options: GenerateOptions,
  history: readonly RequestMessage[],
  inputContent: (message: RequestMessage) => string | (TextContent | ImageContent)[],
  onReplayDegrade?: (reason: string) => void,
): PiContext {
  const messages: PiMessage[] = []
  const toolNames = new Map<ToolCallId, string>()
  const historySystem: string[] = []
  for (const message of history) {
    if (message.role === 'developer') {
      appendDeveloper(message, options, messages)
      continue
    }
    if (message.role === 'system') {
      if (message.content.some(block => block.type !== 'text')) {
        throw new LlmError('pi-ai cannot represent non-text system messages', 'UNSUPPORTED_CONTENT')
      }
      const text = flattenText(message)
      if (text.length === 0) continue
      if (messages.length > 0) {
        messages.push({ role: 'system', content: text, timestamp: 0 })
      } else {
        historySystem.push(text)
      }
      continue
    }
    if (message.role === 'assistant') {
      appendAssistant(message, messages, toolNames, onReplayDegrade)
      continue
    }
    const content = inputContent(message)
    if (message.role === 'tool') {
      messages.push(toolResultOf(message, toolNames, content))
    } else if (content.length > 0) {
      messages.push({ role: 'user', content, timestamp: 0 })
    }
  }
  const system = [options.system, ...historySystem].filter(Boolean).join('\n\n')
  const tools = options.tools?.filter(tool => !tool.deferLoading).map(piTool)
  // An explicit empty head keeps the first later update from becoming the initial prompt.
  if (system.length > 0 || (tools?.length ?? 0) > 0 || messages.some(message => message.role === 'system')) {
    messages.unshift({
      role: 'system',
      content: system,
      timestamp: 0,
      ...tools === undefined || tools.length === 0 ? {} : { toolsAdded: tools },
    })
  }
  return { messages }
}

/** Keep one developer event in one system update, resolving its projected tool declarations. */
function appendDeveloper(message: Extract<Message, { role: 'developer' }>, options: GenerateOptions, messages: PiMessage[]): void {
  const content: TextContent[] = []
  const toolsAdded: PiTool[] = []
  const toolsRemoved: NonNullable<SystemMessage['toolsRemoved']> = []
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) content.push({ type: 'text', text: block.text })
        break
      case 'tool-addition': {
        const tool = options.tools?.find(tool => tool.name === block.toolName)
        if (tool === undefined) throw new LlmError(`pi-ai tool update references undeclared tool "${block.toolName}"`, 'INVALID_REQUEST')
        toolsAdded.push(piTool(tool))
        break
      }
      case 'tool-removal':
        toolsRemoved.push({ name: block.toolName })
        break
      default:
        throw new LlmError(`pi-ai cannot represent developer content ${block.type}`, 'UNSUPPORTED_CONTENT')
    }
  }
  if (content.length === 0 && toolsAdded.length === 0 && toolsRemoved.length === 0) return
  messages.push({
    role: 'system',
    content,
    timestamp: 0,
    ...toolsAdded.length === 0 ? {} : { toolsAdded },
    ...toolsRemoved.length === 0 ? {} : { toolsRemoved },
  })
}

function appendAssistant(
  message: Extract<Message, { role: 'assistant' }>,
  messages: PiMessage[],
  toolNames: Map<ToolCallId, string>,
  onReplayDegrade?: (reason: string) => void,
): void {
  const assistant = toPiAssistant(message, onReplayDegrade)
  for (const block of assistant.content) {
    if (block.type === 'toolCall') toolNames.set(brandString<ToolCallId>(block.id), block.name)
  }
  messages.push(assistant)
}

function textOnlyContext(
  options: GenerateOptions,
  onReplayDegrade?: (reason: string) => void,
): PiContext {
  assertSupportedHistory(options.messages)
  if (options.messages.some(message => contentHasImage(message.content))) {
    throw new LlmError('pi-ai image conversion requires the durable attachment service', 'UNSUPPORTED_CONTENT')
  }
  return conversationContext(options, options.messages, flattenText, onReplayDegrade)
}

/** Inputs that bind deterministic request images to one current tool execution world. */
export interface PiImageRequestContext {
  /** Durable provider that resolves request-image bytes and provider-owned host objects. */
  attachments: AttachmentStore
  /** Resolve current tool access separately from deterministic request-image versions. */
  resolveImageAccess: ImageAttachmentAccessResolver
  /** Request-level bound on the base64-encoded payload of retained images; omission leaves the bound unchecked. */
  maxRequestImageBytes?: number
  /** Route pixel and raw encoded-byte budgets. */
  requestImagePolicy?: PiImageRequestBudget
}

/** Per-route budgets from which each request image's target is derived. */
export interface PiImageRequestBudget {
  /** Total-pixel budget; larger sources are downscaled proportionally. */
  maxPixels: number
  /** Encoded-byte target for one request image. */
  maxBytes: number
}

/** Deterministic request target for one source under the route budgets. */
function requestImageTarget(ref: ImageAttachmentRef, budget: PiImageRequestBudget): ImageRequestTarget {
  return { ...requestImageDimensions(ref.width, ref.height, budget.maxPixels), maxBytes: budget.maxBytes }
}

/**
 * Convert text-only harness history to a synchronous pi-ai Context. Tool
 * result names are recovered from preceding assistant tool calls.
 * @param options - projected request; one-shot system text precedes the leading history prompt.
 * @param images - absent; selects the synchronous conversion.
 * @param onReplayDegrade - forwarded to {@link toPiAssistant} for each assistant message.
 * @returns the pi-ai transcript with initial tools and ordered updates.
 * @throws {LlmError} `UNSUPPORTED_CONTENT` for images in any history role, including a leading system message.
 */
export function toPiContext(
  options: GenerateOptions,
  images?: undefined,
  onReplayDegrade?: (reason: string) => void,
): PiContext
/**
 * Convert harness history to a pi-ai Context while resolving durable images.
 * Tool result names are recovered from preceding assistant tool calls. Image
 * occurrences the surface marks offloaded become text placeholders; when the
 * retained occurrences' exact base64 payload still exceeds
 * `maxRequestImageBytes`, the call fails with `IMAGE_OFFLOAD_REQUIRED` naming
 * how many more oldest occurrences must be offloaded.
 * @param options - projected request; one-shot system text precedes the leading history prompt.
 * @param images - attachment provider, current path resolver, and request limits.
 * @param onReplayDegrade - forwarded to {@link toPiAssistant} for each assistant message.
 * @returns the asynchronously resolved pi-ai transcript.
 */
export function toPiContext(
  options: GenerateOptions,
  images: PiImageRequestContext,
  onReplayDegrade?: (reason: string) => void,
): Promise<PiContext>
export function toPiContext(
  options: GenerateOptions,
  images?: PiImageRequestContext,
  onReplayDegrade?: (reason: string) => void,
): PiContext | Promise<PiContext> {
  return images === undefined
    ? textOnlyContext(options, onReplayDegrade)
    : toPiContextWithImages(options, images, onReplayDegrade)
}

async function toPiContextWithImages(
  options: GenerateOptions,
  images: PiImageRequestContext,
  onReplayDegrade?: (reason: string) => void,
): Promise<PiContext> {
  const { attachments, resolveImageAccess, maxRequestImageBytes } = images
  const requestImagePolicy = images.requestImagePolicy ?? {
    maxPixels: DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
    maxBytes: DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  }
  assertSupportedHistory(options.messages)
  const requestImages = await prepareRequestImages(options.messages, attachments, requestImagePolicy, options.signal)
  if (maxRequestImageBytes !== undefined) {
    const offloadImages = requiredImageOffload(
      options.messages,
      { representation: 'base64', maxBytes: maxRequestImageBytes },
      block => (requestImages.get(block.attachment.attachmentId) as RequestImageAttachment).bytes,
    )
    if (offloadImages > 0) {
      throw new LlmError(
        `pi-ai request images exceed the ${maxRequestImageBytes}-byte base64 bound; ${offloadImages} more oldest occurrence(s) must be offloaded.`,
        IMAGE_OFFLOAD_REQUIRED_CODE,
        { offloadImages },
      )
    }
  }
  const exactMessages = projectOffloadedImages(
    options.messages,
    ref => offloadedImageText(ref, resolveImageAccess(ref)),
  )
  return conversationContext(
    options,
    exactMessages,
    message => userContent(message.content, requestImages, resolveImageAccess),
    onReplayDegrade,
  )
}
