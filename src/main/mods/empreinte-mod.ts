/**
 * VERSION DU MOD — empreinte du CONTENU de `mods/autowin` (conv-420, 2026-11-02).
 *
 * But : comparer le coût d'une demande AVANT et APRÈS une modification du harnais (pratique
 * « suivre le coût par tâche pour repérer une régression tôt », Vaughan, 2026-08-10 :
 * https://codex.danielvaughan.com/2026/08/10/dont-blame-the-model-scaffolding-evolution-coding-agent-quality-codex-cli-harness-regression-testing/).
 * Chaque ligne de `cost.jsonl` porte donc `modVersion`, posé par `CostAggregator.add`.
 *
 * Pourquoi une empreinte et pas `plugin.json#version` : ce numéro n'est bumpé par personne (il
 * vaut 0.1.0 depuis la création), deux harnais différents y partageraient la même version. Le
 * hachage des fichiers change dès qu'un octet change — c'est ce qu'on veut mesurer.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

function fichiers(racine: string): string[] {
  const out: string[] = []
  const pile = [racine]
  while (pile.length > 0) {
    const d = pile.pop() as string
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue
      const p = join(d, e.name)
      if (e.isDirectory()) pile.push(p)
      else if (e.isFile()) out.push(p)
    }
  }
  return out.sort()
}

/** 12 hex du sha256 des (chemin relatif, contenu) triés ; `undefined` si le dossier est illisible. */
export function empreinteMod(dossier: string | undefined): string | undefined {
  if (!dossier) return undefined
  try {
    const h = createHash('sha256')
    for (const f of fichiers(dossier)) {
      h.update(relative(dossier, f).replace(/\\/g, '/'))
      h.update('\0')
      h.update(readFileSync(f))
      h.update('\0')
    }
    return h.digest('hex').slice(0, 12)
  } catch {
    return undefined
  }
}

/**
 * Lecteur mis en cache : `CostAggregator.add` est sur le fil de l'interface, on ne relit pas
 * le dossier à chaque tour. Une modification du mod est vue au plus `ttlMs` plus tard.
 */
export function lecteurVersionMod(
  dossier: () => string | undefined,
  ttlMs = 30_000,
  maintenant: () => number = Date.now
): () => string | undefined {
  let valeur: string | undefined
  let lu = -Infinity
  return () => {
    const t = maintenant()
    if (t - lu >= ttlMs) {
      valeur = empreinteMod(dossier())
      lu = t
    }
    return valeur
  }
}
