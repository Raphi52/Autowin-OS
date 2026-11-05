#!/usr/bin/env node
/**
 * Génère (ou repeint) une image par OpenRouter (conv-446 : Falaise de l'Accueil floue à repeindre nette).
 *
 * PAYANT à l'image : PAS la première voie. Une image 2D passe d'abord par le compte ChatGPT,
 * `node scripts/image-chatgpt.mjs` (règle de l'utilisateur, conv-1603). Ce script-ci ne sert que si
 * l'utilisateur le demande nommément ; sa clé a été retirée pour ne rien dépenser.
 *
 * Usage : node scripts/generer-image.mjs --prompt "<texte>" --sortie <fichier.png>
 *           [--reference <image>]... [--modele google/gemini-3-pro-image] [--ratio 16:9] [--taille 4K]
 *         node scripts/generer-image.mjs --images --modele openai/gpt-image-2 --prompt "<texte>" --sortie <f.png>
 *           [--reference <image>]... [--ratio 1:1] [--qualite high] [--fond transparent] [--n 3]
 *
 * `--images` passe par l'API d'images dédiée d'OpenRouter (POST /api/v1/images, conv-1534) : c'est elle qui
 * sert les modèles d'OpenAI (gpt-image-2…) — par la voie « chat », gpt-5.4-image-2 répond « Complexity 'none'
 * is not supported » — et qui accepte un fond transparent (`--fond transparent`, selon le modèle : voir
 * https://openrouter.ai/api/v1/images/models, champ supported_parameters). Avec `--n 3`, les images sont
 * écrites en <sortie>-1.png, -2.png, -3.png.
 *
 * La clé se lit dans OPENROUTER_API_KEY, puis, à défaut, dans la variable d'environnement UTILISATEUR de
 * Windows (posée sans redémarrer l'app). Elle n'est jamais affichée ni écrite.
 * API : https://openrouter.ai/docs/features/multimodal/image-generation (modalities + image_config) ;
 * https://openrouter.ai/blog/tutorials/image-generation-models/ (POST /api/v1/images, data[].b64_json).
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
    [
      '-NoProfile',
      '-Command',
      "[Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY','User')"
    ],
    { encoding: 'utf8' }
  ).trim()
}
const k = cle()
if (!k) {
  console.error(
    'OPENROUTER_API_KEY absente (ni processus, ni variable utilisateur Windows). Voie à prendre : ' +
      'node scripts/image-chatgpt.mjs (compte ChatGPT, mêmes --prompt --sortie --reference --fond --ratio --n)'
  )
  process.exit(3)
}

// Plusieurs --reference possibles : la scène à respecter, un exemple de style…
const refs = args.flatMap((a, i) => (a === '--reference' && args[i + 1] ? [args[i + 1]] : []))
const dataUrls = refs.map((ref) => {
  const mime = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp'
  }[extname(ref).toLowerCase()]
  if (!mime) {
    console.error('référence : png, jpg ou webp seulement')
    process.exit(2)
  }
  return `data:${mime};base64,${readFileSync(ref).toString('base64')}`
})

if (args.includes('--images')) {
  const corps = {
    model: opt('modele', 'openai/gpt-image-2'),
    prompt,
    aspect_ratio: opt('ratio', 'auto'),
    quality: opt('qualite', 'high'),
    n: Number(opt('n', '1'))
  }
  if (opt('fond')) corps.background = opt('fond')
  if (dataUrls.length)
    corps.input_references = dataUrls.map((url) => ({ type: 'image_url', image_url: { url } }))
  const r = await fetch('https://openrouter.ai/api/v1/images', {
    method: 'POST',
    headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corps)
  })
  // Texte lu d'abord, puis analysé : r.json() puis r.text() relirait un corps déjà consommé.
  const brut = await r.text()
  let j
  try {
    j = JSON.parse(brut)
  } catch {
    j = { error: brut.slice(0, 500) }
  }
  // process.exitCode plutôt que process.exit() : sous Windows, quitter pendant que fetch ferme ses
  // connexions fait planter node (« Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) »).
  const images = (j.data ?? []).filter((d) => d.b64_json)
  if (!r.ok) {
    console.error(`HTTP ${r.status} : ${JSON.stringify(j.error ?? j).slice(0, 500)}`)
    process.exitCode = 1
  } else if (!images.length) {
    console.error(`aucune image rendue : ${JSON.stringify(j).slice(0, 500)}`)
    process.exitCode = 4
  } else {
    const fichiers = images.map((d, i) => {
      const f =
        images.length === 1
          ? sortie
          : sortie.replace(/(\.\w+)?$/, (ext) => `-${i + 1}${ext || '.png'}`)
      writeFileSync(f, Buffer.from(d.b64_json, 'base64'))
      return f
    })
    console.log(
      JSON.stringify({ sorties: fichiers, modele: corps.model, cout: j.usage?.cost ?? null })
    )
  }
} else {
  await viaChat()
}

async function viaChat() {
  const contenu = [{ type: 'text', text: prompt }]
  for (const url of dataUrls) contenu.push({ type: 'image_url', image_url: { url } })

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
    console.error(
      `aucune image rendue : ${JSON.stringify(j.choices?.[0]?.message?.content ?? j).slice(0, 500)}`
    )
    process.exit(4)
  }
  writeFileSync(sortie, Buffer.from(url.split(',')[1], 'base64'))
  console.log(JSON.stringify({ sortie, modele: j.model, cout: j.usage?.cost ?? null }))
}
