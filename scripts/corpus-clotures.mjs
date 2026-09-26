/**
 * GENERATEUR DU CORPUS DE CLOTURES REELLES (conv-787, 2026-09-22).
 *
 * A QUOI IL SERT. Le banc `src/renderer/src/components/chat-auto-mode.corpus-reel.test.ts` rejoue
 * les regles d'arret du mode auto sur des clotures REELLEMENT ecrites, et non sur des phrases
 * imaginees. Ce script fabrique ce corpus a partir des conversations du poste.
 *
 * POURQUOI IL EXISTE. Deux regles trop larges sont passees en production le meme jour — « Voici le
 * message du bandeau… » lue comme une demande de secret, « Rien de plus sur ce sujet… » ignoree
 * comme fin de chaine. Aucune n'aurait survecu a un rejeu sur les vraies clotures.
 *
 * CE QU'IL NE GARDE PAS. Le corpus est REDUIT a ce que les regles lisent : les rubriques « Fait »,
 * « Reste a faire », « Recommande » (2 lignes chacune, 100 caracteres par ligne) et la ligne de
 * prompt suivant. La rubrique « Maintenant » et tout le corps des messages sont ecartes — ils ne
 * sont jamais lus, et ce sont eux qui portent le contenu de travail.
 *
 * USAGE : node scripts/corpus-clotures.mjs [chemin/vers/conversations.json]
 * Les chiffres du banc sont propres au poste : apres regeneration, RE-MESURE les bornes au lieu de
 * les rattraper a l'aveugle (la marche a suivre est en tete du fichier de test).
 */
import fs from 'node:fs'
import path from 'node:path'

const SOURCE = process.argv[2] ?? path.join('.autowin-data', 'autowin-os', 'conversations.json')
const DESTINATION = path.join(
  'src',
  'renderer',
  'src',
  'components',
  '__corpus__',
  'clotures-reelles.json'
)

const EN_TETE =
  /^\s*\**\s*(?:✅|⚠️?|📍|⏳|👉)\s*\**\s*(Fait|Maintenant|Reste à faire|Recommandé)\b/u
const TECH = /^\s*AUTOWIN_PROMPT_V1\s*:/u
/** Combien de lignes de contenu on garde par rubrique : seules les premieres portent un verdict. */
const LIGNES_PAR_RUBRIQUE = 2
/** Au-dela, la ligne raconte le travail et non la decision. */
const LARGEUR = 100

/** Les messages d'agent qui portent un bloc de cloture, dans toutes les conversations. */
function messagesDeCloture(donnees) {
  const conversations = Array.isArray(donnees)
    ? donnees
    : (donnees.conversations ?? Object.values(donnees)[0] ?? [])
  const sortie = []
  for (const conversation of conversations) {
    for (const message of conversation?.messages ?? []) {
      if (message?.role !== 'assistant') continue
      const texte = typeof message.content === 'string' ? message.content : ''
      if (texte.includes('👉') && /(Recommand|Reste à faire)/u.test(texte)) sortie.push(texte)
    }
  }
  return sortie
}

/** La DERNIERE cloture du message, reduite aux lignes que les regles lisent. */
function clotureReduite(texte) {
  const lignes = texte.split('\n')
  let debut = -1
  for (let i = 0; i < lignes.length; i++) {
    const entete = lignes[i].match(EN_TETE)
    if (entete && entete[1] === 'Fait') debut = i
  }
  if (debut < 0) return null
  const sortie = []
  let rubrique = null
  let compte = 0
  for (const ligne of lignes.slice(debut)) {
    const entete = ligne.match(EN_TETE)
    if (entete) {
      rubrique = entete[1]
      compte = 0
      if (rubrique !== 'Maintenant') sortie.push(ligne.slice(0, LARGEUR))
      continue
    }
    if (!rubrique || rubrique === 'Maintenant' || !ligne.trim()) continue
    if (compte++ < LIGNES_PAR_RUBRIQUE) sortie.push(ligne.slice(0, LARGEUR))
  }
  const prompt = lignes.find((ligne) => TECH.test(ligne))
  if (prompt) sortie.push(prompt.slice(0, 170))
  const garde = sortie.join('\n')
  return garde.trim() ? garde : null
}

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`Source introuvable : ${SOURCE}`)
    process.exitCode = 1
    return
  }
  const messages = messagesDeCloture(JSON.parse(fs.readFileSync(SOURCE, 'utf8')))
  const vus = new Set()
  const corpus = []
  for (const message of messages) {
    const reduite = clotureReduite(message)
    if (!reduite) continue
    const cle = reduite.replace(/\s+/gu, ' ').toLowerCase()
    if (vus.has(cle)) continue
    vus.add(cle)
    corpus.push(reduite)
  }
  fs.mkdirSync(path.dirname(DESTINATION), { recursive: true })
  fs.writeFileSync(DESTINATION, JSON.stringify(corpus))
  const octets = Buffer.byteLength(JSON.stringify(corpus), 'utf8')
  console.log(
    `${corpus.length} clotures distinctes sur ${messages.length} messages → ${DESTINATION} (${Math.round(octets / 1024)} ko)`
  )
}

main()
