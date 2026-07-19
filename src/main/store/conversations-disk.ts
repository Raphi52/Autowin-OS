import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Conversation, ConversationStore } from './conversations'
import { ensureAutowinAppData } from '../app-data'

/**
 * Persistance disque des conversations (sinon TOUT disparaît au restart).
 * Même pattern que role-store : le store reste PUR, le load/save vit ici.
 * Écriture atomique (tmp + rename) pour ne jamais corrompre le fichier
 * si l'app meurt en pleine écriture. Fichier : %APPDATA%\autowin-os\conversations.json.
 */
export function conversationsPath(): string {
  return join(ensureAutowinAppData(), 'conversations.json')
}

export function loadConversations(path = conversationsPath()): Conversation[] {
  if (!existsSync(path)) return []
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(data) ? (data as Conversation[]) : []
  } catch {
    return [] // fichier corrompu → on repart vide plutôt que de crasher l'app
  }
}

export function saveConversations(all: Conversation[], path = conversationsPath()): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(all, null, 1), 'utf8')
    renameSync(tmp, path)
  } catch {
    /* la persistance ne doit jamais casser la mutation qui l'a déclenchée */
  }
}

/** Branche un store sur le disque : recharge l'existant + sauve à chaque mutation. */
export function persistConversations(store: ConversationStore, path = conversationsPath()): void {
  const migrated = store.hydrate(loadConversations(path))
  let pending: Conversation[] | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = (): void => {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (!pending) return
    const snapshot = pending
    pending = undefined
    saveConversations(snapshot, path)
  }

  store.onChange = (all, urgency) => {
    pending = all
    if (urgency === 'immediate') {
      flush()
      return
    }
    if (timer) return
    timer = setTimeout(flush, 120)
    ;(timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.()
  }

  if (migrated) saveConversations(store.list(), path)
}
