#!/usr/bin/env node
/**
 * SONDE DES MODÈLES GRATUITS D'OPENROUTER (2026-11-04, conv-1496 : « teste chaque modèle, enlève
 * ceux qui marchent pas »).
 *
 * Envoie « Say OK » (16 jetons max) à chaque modèle `:free` capable d'outils, par le MÊME chemin que
 * le CLI Claude (POST /api/v1/messages, format Anthropic), puis écrit ceux qui REFUSENT pour de bon
 * (HTTP 400/403/404) dans .autowin-data/autowin-os/openrouter-exclus.json, que l'app relit au
 * chargement du catalogue (src/main/openrouter-free-models.ts). Un 429 (limite passagère) ou une
 * panne réseau ne retire PAS le modèle.
 *
 * COÛT : une requête gratuite par modèle, sur les 50 du jour du compte (mesuré : 13 modèles).
 * Usage : node scripts/openrouter-sonde.mjs [--racine <dossier de données>] [--json]
 * Clé : OPENROUTER_API_KEY (jamais affichée ni écrite).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const ici = dirname(fileURLToPath(import.meta.url))
const racine = args.includes('--racine')
  ? resolve(args[args.indexOf('--racine') + 1])
  : join(ici, '..', '.autowin-data', 'autowin-os')
const cle = process.env.OPENROUTER_API_KEY?.trim()
if (!cle) {
  console.error('OPENROUTER_API_KEY absente : rien à sonder.')
  process.exit(2)
}

const catalogue = await (await fetch('https://openrouter.ai/api/v1/models')).json()
const ids = (catalogue.data ?? [])
  .filter((m) => m.id?.endsWith(':free') && (m.supported_parameters ?? []).includes('tools'))
  .map((m) => m.id)

const REFUS_DEFINITIFS = new Set([400, 403, 404])
const resultats = await Promise.all(
  ids.map(async (id) => {
    try {
      const reponse = await fetch('https://openrouter.ai/api/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cle}`,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: id,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Say OK' }]
        }),
        signal: AbortSignal.timeout(60_000)
      })
      const corps = await reponse.text()
      let motif = ''
      try {
        motif = JSON.parse(corps)?.error?.message ?? ''
      } catch {
        motif = corps.slice(0, 160)
      }
      return { id, http: reponse.status, motif }
    } catch (erreur) {
      return { id, http: 0, motif: String(erreur?.message ?? erreur) }
    }
  })
)

const date = new Date().toISOString()
const exclus = resultats
  .filter((r) => REFUS_DEFINITIFS.has(r.http))
  .map((r) => ({ id: r.id, http: r.http, motif: r.motif.slice(0, 200), date }))
mkdirSync(racine, { recursive: true })
writeFileSync(join(racine, 'openrouter-exclus.json'), JSON.stringify({ date, exclus }, null, 2))

if (args.includes('--json')) console.log(JSON.stringify({ resultats, exclus }, null, 2))
else
  for (const r of resultats)
    console.log(
      `${r.http === 200 ? 'OK     ' : REFUS_DEFINITIFS.has(r.http) ? 'RETIRÉ ' : 'GARDÉ  '} ${r.http} ${r.id}${r.http === 200 ? '' : ' — ' + r.motif.slice(0, 90)}`
    )
