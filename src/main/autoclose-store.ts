import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ensureAutowinAppData } from './app-data'

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
    const raw = readFileSync(path, 'utf8').replace(/^﻿/, '')
    return (JSON.parse(raw) as { enabled?: unknown }).enabled === true
  } catch {
    return false // fichier corrompu : on retombe sur le défaut sûr, jamais sur « publie »
  }
}

/** Écrit l'état. Best-effort : un disque en échec ne doit pas casser le réglage en cours. */
export function saveAutoClose(enabled: boolean, path = autoClosePath()): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ enabled }, null, 2), 'utf8')
  } catch {
    /* le réglage vaut pour cette session, il ne survivra pas — sans casser quoi que ce soit */
  }
}
