#!/usr/bin/env node
/**
 * Génère (ou repeint) une image par OpenRouter (conv-446 : Falaise de l'Accueil floue à repeindre nette).
 *
 * Usage : node scripts/generer-image.mjs --prompt "<texte>" --sortie <fichier.png>
 *           [--reference <image>] [--modele google/gemini-3-pro-image] [--ratio 16:9] [--taille 4K]
 *
 * La clé se lit dans OPENROUTER_API_KEY, puis, à défaut, dans la variable d'environnement UTILISATEUR de
 * Windows (posée sans redémarrer l'app). Elle n'est jamais affichée ni écrite.
 * API : https://openrouter.ai/docs/features/multimodal/image-generation (modalities + image_config).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { extname } from 'node:path'

const args = process.argv.slice(2)
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : d
}
const prompt = opt('prompt')
const sortie = opt('sortie')
if (!prompt || !sortie) {
  console.error('usage : --prompt "<texte>" --sortie <fichier.png> [--reference <image>]')
  process.exit(2)
}

function cle() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY
  if (process.platform !== 'win32') return ''
  return execFileSync(
    'powershell',
    ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY','User')"],
    { encoding: 'utf8' }
  ).trim()
}
const k = cle()
if (!k) {
  console.error('OPENROUTER_API_KEY absente (ni processus, ni variable utilisateur Windows)')
  process.exit(3)
}

const contenu = [{ type: 'text', text: prompt }]
const ref = opt('reference')
if (ref) {
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[
    extname(ref).toLowerCase()
  ]
  if (!mime) {
    console.error('référence : png, jpg ou webp seulement')
    process.exit(2)
  }
  contenu.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${readFileSync(ref).toString('base64')}` } })
}

const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: opt('modele', 'google/gemini-3-pro-image'),
    modalities: ['image', 'text'],
    messages: [{ role: 'user', content: contenu }],
    image_config: { aspect_ratio: opt('ratio', '16:9'), image_size: opt('taille', '4K') }
  })
})
const j = await r.json()
if (!r.ok) {
  console.error(`HTTP ${r.status} : ${JSON.stringify(j.error ?? j).slice(0, 500)}`)
  process.exit(1)
}
const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url
if (!url) {
  console.error(`aucune image rendue : ${JSON.stringify(j.choices?.[0]?.message?.content ?? j).slice(0, 500)}`)
  process.exit(4)
}
writeFileSync(sortie, Buffer.from(url.split(',')[1], 'base64'))
console.log(JSON.stringify({ sortie, modele: j.model, cout: j.usage?.cost ?? null }))
