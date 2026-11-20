#!/usr/bin/env node
// Prépare un BROUILLON de courrier (.eml) qu'Outlook ouvre en message MODIFIABLE, prêt à envoyer :
// objet, corps et pièces jointes déjà en place. Rien n'est envoyé ni écrit dans la boîte aux lettres :
// l'utilisateur double-clique le fichier, choisit ses destinataires, relit et envoie lui-même.
//
// Pourquoi l'en-tête `X-Unsent: 1` : sans lui, Outlook ouvre un .eml comme un message REÇU, en lecture seule.
// Pourquoi pas scripts/outlook-local-nouveau.ps1 : lui ENVOIE. Ici l'envoi reste un geste de l'utilisateur,
// ce qui permet de préparer un mail à faire valider sans toucher ni à son écran ni à sa boîte.
// Cas d'origine : un mail à faire valider, avec un JSON de 281 Ko en pièce jointe.
//
// Objet et corps arrivent par des FICHIERS UTF-8 (même règle que outlook-local-nouveau.ps1 : un accent
// passé en argument peut arriver abîmé, un fichier jamais).
//
//   node scripts/brouillon-eml.mjs --objet-fichier <objet.txt> --corps-fichier <corps.txt> \
//     [--piece <chemin>]... [--a <adresse>]... [--cc <adresse>]... --sortie <brouillon.eml> [--remplacer]
//
// Codes de sortie : 0 écrit · 2 argument invalide · 3 fichier introuvable · 4 sortie déjà présente

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const CRLF = '\r\n'
const ADRESSE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}$/
const TYPES = {
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

/** Base64 coupé en lignes de 76 caractères (RFC 2045). */
const base64Ligne = (buf) => (buf.toString('base64').match(/.{1,76}/g) ?? ['']).join(CRLF)

/**
 * Texte d'en-tête : tel quel s'il est en ASCII imprimable, sinon en mots encodés UTF-8 (RFC 2047).
 * Chaque mot encodé reste sous 75 caractères : on découpe par caractère entier (jamais au milieu
 * d'un accent) en tranches de 45 octets au plus, soit 60 caractères en base64.
 */
export function enTeteEncode(texte) {
  if (/^[\x20-\x7e]*$/.test(texte)) return texte
  const mots = []
  let tranche = ''
  for (const car of texte) {
    if (Buffer.byteLength(tranche + car, 'utf8') > 45) {
      mots.push(tranche)
      tranche = ''
    }
    tranche += car
  }
  if (tranche) mots.push(tranche)
  return mots
    .map((m) => `=?UTF-8?B?${Buffer.from(m, 'utf8').toString('base64')}?=`)
    .join(`${CRLF} `)
}

/**
 * Construit le texte du .eml.
 * @param {{objet: string, corps: string, pieces?: {nom: string, contenu: Buffer}[], a?: string[], cc?: string[]}} m
 */
export function construireEml({ objet, corps, pieces = [], a = [], cc = [] }) {
  const objetPropre = String(objet ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
  if (!objetPropre) throw new Error('objet vide')
  if (!String(corps ?? '').trim()) throw new Error('corps vide')
  for (const adr of [...a, ...cc]) if (!ADRESSE.test(adr)) throw new Error(`adresse invalide : ${adr}`)
  for (const p of pieces) {
    if (!p.nom || /["\\\r\n]/.test(p.nom))
      throw new Error(`nom de pièce jointe invalide : ${p.nom}`)
  }

  // Le texte brut se transporte en fins de ligne CRLF (forme canonique RFC 2046).
  const corpsCrlf = String(corps).replace(/\r?\n/g, CRLF)
  const partieTexte = [
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Ligne(Buffer.from(corpsCrlf, 'utf8'))
  ].join(CRLF)

  const tetes = []
  if (a.length) tetes.push(`To: ${a.join(', ')}`)
  if (cc.length) tetes.push(`Cc: ${cc.join(', ')}`)
  tetes.push(`Subject: ${enTeteEncode(objetPropre)}`, 'X-Unsent: 1', 'MIME-Version: 1.0')

  if (!pieces.length) return [...tetes, partieTexte, ''].join(CRLF)

  const frontiere = `----=_aw_${randomBytes(12).toString('hex')}`
  const parties = [partieTexte]
  for (const p of pieces) {
    const type = TYPES[extname(p.nom).toLowerCase()] ?? 'application/octet-stream'
    const nom = enTeteEncode(p.nom)
    parties.push(
      [
        `Content-Type: ${type}; name="${nom}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${nom}"`,
        '',
        base64Ligne(p.contenu)
      ].join(CRLF)
    )
  }
  return [
    ...tetes,
    `Content-Type: multipart/mixed; boundary="${frontiere}"`,
    '',
    'Ceci est un message au format MIME.',
    ...parties.map((p) => `--${frontiere}${CRLF}${p}`),
    `--${frontiere}--`,
    ''
  ].join(CRLF)
}

function lireArgs(argv) {
  const o = { pieces: [], a: [], cc: [] }
  for (let i = 0; i < argv.length; i++) {
    const cle = argv[i]
    const val = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`valeur manquante après ${cle}`)
      return v
    }
    if (cle === '--objet-fichier') o.objetFichier = val()
    else if (cle === '--corps-fichier') o.corpsFichier = val()
    else if (cle === '--piece') o.pieces.push(val())
    else if (cle === '--a') o.a.push(val())
    else if (cle === '--cc') o.cc.push(val())
    else if (cle === '--sortie') o.sortie = val()
    else if (cle === '--remplacer') o.remplacer = true
    else throw new Error(`argument inconnu : ${cle}`)
  }
  if (!o.objetFichier || !o.corpsFichier || !o.sortie) {
    throw new Error('--objet-fichier, --corps-fichier et --sortie sont obligatoires')
  }
  return o
}

function principal() {
  let o
  try {
    o = lireArgs(process.argv.slice(2))
  } catch (e) {
    console.error(`ECHEC - ${e.message}`)
    return 2
  }
  for (const f of [o.objetFichier, o.corpsFichier, ...o.pieces]) {
    if (!existsSync(f)) {
      console.error(`ECHEC - fichier introuvable : ${f}`)
      return 3
    }
  }
  if (existsSync(o.sortie) && !o.remplacer) {
    console.error(`ECHEC - ${o.sortie} existe déjà (ajoute --remplacer pour l'écraser)`)
    return 4
  }
  let eml
  try {
    eml = construireEml({
      objet: readFileSync(o.objetFichier, 'utf8'),
      corps: readFileSync(o.corpsFichier, 'utf8'),
      pieces: o.pieces.map((f) => ({ nom: basename(f), contenu: readFileSync(f) })),
      a: o.a,
      cc: o.cc
    })
  } catch (e) {
    console.error(`ECHEC - ${e.message}`)
    return 2
  }
  writeFileSync(o.sortie, eml, 'utf8')
  console.log(
    JSON.stringify({
      ok: true,
      sortie: o.sortie,
      pieces: o.pieces.map((f) => basename(f)),
      octets: Buffer.byteLength(eml)
    })
  )
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = principal()
