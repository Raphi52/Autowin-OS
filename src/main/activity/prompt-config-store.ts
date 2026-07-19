import { appendConvActivity, loadConvActivity, type ConvActivityEntry } from './conv-activity'

export const GLOBAL_PROMPT_ACTIVITY = '__global_prompt_config__'

export function appendPromptConfigActivity(
  label: string,
  change: unknown,
  root?: string
): void {
  appendConvActivity(GLOBAL_PROMPT_ACTIVITY, {
    kind: 'configuration-change', label, text: JSON.stringify(change)
  }, root)
}

export function loadPromptConfigActivity(root?: string): ConvActivityEntry[] {
  return loadConvActivity(GLOBAL_PROMPT_ACTIVITY, root)
}
