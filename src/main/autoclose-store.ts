import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ensureAutowinAppData } from './app-data'
import type { AutoCloseReport } from './run-autoclose'

/**
 * Persistance disque de l'interrupteur « clôture automatique d'un run vert ».
 *
 * Sans elle, le réglage n'était qu'un booléen en mémoire : il retombait à OFF à chaque lancement, et
 * il aurait fallu le réarmer à la main à chaque fois — exactement l'étape manuelle que la
 * fonctionnalité est censée supprimer.
 *
 * Reste OFF par défaut : un fichier absent ou illisible ne doit jamais faire publier une machine
 * toute seule. Fichier : %APPDATA%\autowin-os\autoclose.json.
 */
function autoClosePath(): string {
  return join(ensureAutowinAppData(), 'autoclose.json')
}

/** État persisté, ou `false` si rien n'a jamais été réglé (défaut sûr). */
export function loadAutoClose(path = autoClosePath()): boolean {
  if (!existsSync(path)) return false
  try {
    // Le BOM est retiré AVANT le parse : sous Windows, presque tout ce qui écrit un fichier à la
    // main (Notepad, `Set-Content`, redirection PowerShell) en ajoute un, et `JSON.parse` le refuse.
    // Sans ça, un réglage parfaitement valide retombait silencieusement à OFF. Constaté en vrai.
    const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
    return (JSON.parse(raw) as { enabled?: unknown }).enabled === true
  } catch {
    return false // fichier corrompu : on retombe sur le défaut sûr, jamais sur « publie »
  }
}

/**
 * LE DERNIER RAPPORT DE PUBLICATION SURVIT AU REDÉMARRAGE.
 *
 * Vécu le 2026-10-01 (conv-770) : le commit automatique du tour 235b91bd n'a pas publié le correctif
 * du garde Python, et le POURQUOI (tests rouges, autre fil, fichier non revendiqué…) a disparu au
 * redémarrage suivant : le rapport ne vivait qu'en mémoire. Le panneau Git relit ce fichier au
 * démarrage. Fichier : %APPDATA%\autowin-os\autoclose-last.json.
 */
function lastReportPath(): string {
  return join(ensureAutowinAppData(), 'autoclose-last.json')
}

/** Le dernier rapport persisté, ou `undefined` (absent, illisible ou de forme inattendue). */
export function loadLastAutoCloseReport(path = lastReportPath()): AutoCloseReport | undefined {
  if (!existsSync(path)) return undefined
  try {
    const brut = readFileSync(path, 'utf8')
    // BOM retiré, comme pour l'interrupteur (Notepad, PowerShell en ajoutent un).
    const value = JSON.parse(brut.charCodeAt(0) === 0xfeff ? brut.slice(1) : brut) as unknown
    if (!value || typeof value !== 'object') return undefined
    const r = value as Record<string, unknown>
    const project = r.project as Record<string, unknown> | undefined
    if (typeof r.runId !== 'string' || typeof r.branch !== 'string' || typeof r.at !== 'string')
      return undefined
    if (!project || typeof project !== 'object' || typeof project.status !== 'string')
      return undefined
    return value as AutoCloseReport
  } catch {
    return undefined
  }
}

/** Écrit le rapport ; `false` si le disque ne le porte pas (le rapport reste alors en mémoire). */
export function saveLastAutoCloseReport(report: AutoCloseReport, path = lastReportPath()): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(report, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

/** Écrit l'état et dit explicitement si le disque porte réellement le réglage demandé. */
export function saveAutoClose(enabled: boolean, path = autoClosePath()): boolean {
  // fix-ok: l'appelant ne doit modifier l'état mémoire qu'après confirmation de la persistance.
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ enabled }, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}
