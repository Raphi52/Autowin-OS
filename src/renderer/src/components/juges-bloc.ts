import { extraireVotesJuges, type StepDeRun, type VoteJuge } from './juges-votes'

/**
 * BLOC DES JUGES dans le fil — choix « 1 · Nacre » du /draft de conv-328 (2026-10-18, « un bloc
 * pour afficher les judges dans le chat »), sur la mise en page « Corrigé dans l'objection » :
 * bandeau du verdict, objections À CORRIGER avec leur ADRESSE dessous et ce qui est DÉJÀ CORRIGÉ
 * accroché dedans, état du suivi à droite, juges en pied.
 *
 * Tout vient du TEXTE du juge, rien n'est supposé :
 * - un run réparé porte UN verdict par PASSAGE. Mesuré sur la trace de conv-253 : 4 steps `judge`
 *   du même modèle, séparés par les gates « Réparation N — nouveau passage ». L'ancien panneau les
 *   montrait comme 4 juges. Le bloc montre le DERNIER passage jugé ; le précédent ne sert qu'au suivi ;
 * - l'adresse = les fichiers que le juge cite (entre backticks, ou en clair avec un dossier) ;
 * - le suivi = ses mots : « corrigée qu'en partie » → partie ; « l'objection précédente »,
 *   « reste faux »… → reprise ; rien de tel alors qu'un passage précède → nouvelle ;
 * - le déjà-corrigé = sa phrase « Ce qui est réglé … : a, et b ».
 *
 * Module PUR, testé sur la vraie trace de conv-253 (juges-bloc.test.ts).
 */

export type GraviteBloquante = 'MAJEUR' | 'MINEUR' | null
export type Suivi = 'partie' | 'reprise' | 'nouvelle'

export interface Adresse {
  /** Le chemin tel que le juge l'a écrit (absolu compris). */
  chemin: string
  /** Ce qu'on affiche : un chemin absolu est coupé à `src/` (ou à ses deux derniers segments). */
  affiche: string
  /** La fonction citée juste avant « (l.60-81) ». */
  lieu?: string
  lignes?: string
}

export interface ObjectionDuBloc {
  /** `null` = puce sans étiquette : le contrôle final la compte comme bloquante. */
  gravite: GraviteBloquante
  texte: string
  /** Ce que le juge dit déjà réglé DANS cette objection, cité tel quel. */
  corrige: string[]
  adresses: Adresse[]
  suivi?: Suivi
}

export interface ObjectionDuJuge extends ObjectionDuBloc {
  juge: string
}

export interface BlocDesJuges {
  /** Rang de réparation du passage montré (0 = le premier build). */
  reparation: number
  passagePrecedent: boolean
  /** Rang du passage jugé d'avant (un passage interrompu sans verdict ne compte pas). */
  reparationPrecedente?: number
  votes: VoteJuge[]
  objections: ObjectionDuJuge[]
  /** Les puces OK (constats vérifiés) du passage : comptées, pas listées. */
  constats: number
}

const NOUVEAU_PASSAGE = /^Réparation (\d+)(?:\/\d+)?\s+—\s+nouveau passage/

/** Les passages d'un run qui portent au moins un vote de juge, dans l'ordre. */
export function passagesJuges(
  steps: readonly StepDeRun[]
): Array<{ reparation: number; steps: StepDeRun[] }> {
  const passages: Array<{ reparation: number; steps: StepDeRun[] }> = [{ reparation: 0, steps: [] }]
  for (const step of steps) {
    const passage =
      step.step === 'gate' ? NOUVEAU_PASSAGE.exec((step.detail || step.text || '').trim()) : null
    if (passage) {
      passages.push({ reparation: Number(passage[1]), steps: [] })
      continue
    }
    if (step.step === 'judge') passages[passages.length - 1].steps.push(step)
  }
  return passages.filter((p) => extraireVotesJuges(p.steps).length > 0)
}

const ENTETE = /^\s*\**\s*OBJECTIONS\s*\**\s*:\s*/i
const PUCE = /^(\s*)(?:[-*•]|\d+[.)])\s+(.*)$/
const ETIQUETTE = /^\**\s*(MAJEUR|MINEUR|OK)\s*\**\s*:\s*\**\s*/i
const AUTRE_SECTION = /^[A-ZÉÈÀ_ ]{3,}\s*:/
// Ligne ENTIÈRE seulement, comme src/main/objections-juge.ts : « Aucune capture » est une objection.
const VIDE =
  /^(aucune?(\s+(objections?|ecarts?|defauts?|reserves?))?|rien(\s+a\s+signaler)?|neant|n\/?a|non|ras)\s*[.!]?$/

function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

/** Les puces de la section OBJECTIONS:, sous-puces et paragraphes rattachés à leur puce. */
function pucesDuVerdict(texte: string): Array<{ gravite: string | null; texte: string }> {
  const puces: Array<{ gravite: string | null; lignes: string[] }> = []
  let dans = false
  let courante: { gravite: string | null; lignes: string[] } | null = null
  let retraitRacine: number | null = null
  for (const ligne of texte.split(/\r?\n/)) {
    if (ENTETE.test(ligne)) {
      dans = true
      courante = null
      retraitRacine = null
      const reste = ligne.replace(ENTETE, '').trim()
      if (reste && !VIDE.test(normaliser(reste))) puces.push({ gravite: null, lignes: [reste] })
      continue
    }
    if (!dans) continue
    if (!ligne.trim()) {
      courante?.lignes.push('')
      continue
    }
    const puce = PUCE.exec(ligne)
    const retrait = (puce ? puce[1] : (/^\s*/.exec(ligne)?.[0] ?? '')).replace(/\t/g, '    ').length
    if (!puce && retrait === 0 && AUTRE_SECTION.test(ligne)) {
      dans = false
      courante = null
      continue
    }
    if (puce && (retraitRacine === null || retrait <= retraitRacine)) {
      retraitRacine = retrait
      const contenu = puce[2].trim()
      if (!contenu || VIDE.test(normaliser(contenu))) {
        courante = null
        continue
      }
      const etiquette = ETIQUETTE.exec(contenu)
      courante = {
        gravite: etiquette ? etiquette[1].toUpperCase() : null,
        lignes: [etiquette ? contenu.slice(etiquette[0].length) : contenu]
      }
      puces.push(courante)
      continue
    }
    courante?.lignes.push(puce ? `• ${puce[2].trim()}` : ligne.trim())
  }
  return puces.map((p) => ({
    gravite: p.gravite,
    texte: p.lignes
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }))
}

const EXTENSION =
  '(?:tsx?|jsx?|mjs|cjs|css|scss|less|html?|jsonl?|mdx?|ya?ml|toml|py|cs|xaml|csproj|ps1|psm1|sh|bat|cmd|sql|go|rs|java|kt|cc|cpp|hpp|vue|svelte)'
/** Une portion de code qui EST un chemin de fichier source, avec ses lignes éventuelles. */
const CODE_FICHIER = new RegExp(
  `^((?:[A-Za-z]:)?[\\w.@~\\-/\\\\]*?[\\w@\\-]+\\.${EXTENSION})(?::(\\d+)(?:[-–](\\d+))?)?$`
)
/** Un chemin écrit en clair : au moins un dossier, pour ne pas prendre « fichier.ts » dans une phrase. */
const CHEMIN_EN_CLAIR = new RegExp(
  `(?<![\\w/\`])((?:[A-Za-z]:)?(?:[\\w.@~-]+/)+[\\w@-]+\\.${EXTENSION})(?::(\\d+)(?:[-–](\\d+))?)?(?![\\w/])`,
  'g'
)
const LIEU = /`([A-Za-z_$][\w$]*)`\s*\(l\.\s*(\d+(?:[-–]\d+)?)\)/g
const MAX_ADRESSES = 3

function cheminAffiche(chemin: string): string {
  const p = chemin.replace(/\\/g, '/')
  if (!/^[A-Za-z]:\//.test(p) && !p.startsWith('/')) return p
  const racine = p.search(/\/(?:src|scripts|tests?|docs|skills|resources)\//)
  return racine >= 0 ? p.slice(racine + 1) : p.split('/').slice(-2).join('/')
}

function lignesDe(debut?: string, fin?: string): string | undefined {
  if (!debut) return undefined
  return fin ? `l.${debut}-${fin}` : `l.${debut}`
}

/** Les fichiers que le juge cite, dans l'ordre, sans doublon ; la fonction « (l.N-M) » s'y rattache. */
function adressesDe(texte: string): Adresse[] {
  const trouvees: Array<{ index: number; adresse: Adresse }> = []
  const code = /`([^`\n]+)`/g
  for (let m = code.exec(texte); m; m = code.exec(texte)) {
    const fichier = CODE_FICHIER.exec(m[1].trim())
    if (!fichier) continue
    const lignes = lignesDe(fichier[2], fichier[3])
    trouvees.push({
      index: m.index,
      adresse: {
        chemin: fichier[1],
        affiche: cheminAffiche(fichier[1]),
        ...(lignes ? { lignes } : {})
      }
    })
  }
  const horsCode = texte.replace(/`[^`\n]*`/g, (bloc) => ' '.repeat(bloc.length))
  CHEMIN_EN_CLAIR.lastIndex = 0
  for (let m = CHEMIN_EN_CLAIR.exec(horsCode); m; m = CHEMIN_EN_CLAIR.exec(horsCode)) {
    const lignes = lignesDe(m[2], m[3])
    trouvees.push({
      index: m.index,
      adresse: { chemin: m[1], affiche: cheminAffiche(m[1]), ...(lignes ? { lignes } : {}) }
    })
  }
  trouvees.sort((a, b) => a.index - b.index)
  LIEU.lastIndex = 0
  for (let m = LIEU.exec(texte); m; m = LIEU.exec(texte)) {
    const avant = trouvees.filter((t) => t.index < (m as RegExpExecArray).index).pop()
    if (avant && !avant.adresse.lieu) {
      avant.adresse.lieu = m[1]
      avant.adresse.lignes ??= lignesDe(...(m[2].split(/[-–]/) as [string, string?]))
    }
  }
  const parChemin = new Map<string, Adresse>()
  for (const { adresse } of trouvees) {
    const cle = adresse.affiche.toLowerCase()
    const deja = parChemin.get(cle)
    if (!deja) parChemin.set(cle, adresse)
    else if (!deja.lignes && adresse.lignes) Object.assign(deja, { lignes: adresse.lignes })
  }
  return [...parChemin.values()].slice(0, MAX_ADRESSES)
}

/** « Ce qui est réglé, testé avec … : a, et b. » — jusqu'à la phrase suivante. */
const REGLE =
  /(^|[.!?]\s+)(Ce qui (?:est |a été )?(?:réglé|corrigé|résolu|marche|fonctionne)[^:\n]{0,160}:\s*)([\s\S]+?)([.!?](?=\s+[A-ZÀÂÉÈÊÎÔÛÇ«]|\s*$)|$)/i

function separerCorrige(texte: string): { texte: string; corrige: string[] } {
  const m = REGLE.exec(texte)
  if (!m) return { texte, corrige: [] }
  const corrige = m[3]
    .split(/,\s+et\s+|\s*;\s+/)
    .map((item) => item.trim().replace(/[.!]$/, ''))
    .filter(Boolean)
  const debut = m.index + m[1].length
  const reste = `${texte.slice(0, debut)}${texte.slice(m.index + m[0].length)}`
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return { texte: reste, corrige }
}

// `\p{L}` et non `\w` : « corrigée » porte un « é », que `\w` ne reconnaît pas.
const PARTIE = /corrig\p{L}*\s+(?:qu['’]\s*)?en partie|partiellement corrig/iu
const REPRISE =
  /objection pr[ée]c[ée]dente|\b(?:reste|restent|demeure|demeurent)\s+(?:faux|fauss\w*|incorrect\w*|inexact\w*|absent\w*|manquant\w*|cass\w*|bloqu\w*|rouge\w*|ouvert\w*|vide\w*)|n['’]est (?:toujours |encore )?pas (?:encore )?corrig|toujours pas/i

function suiviDe(texte: string, passagePrecedent: boolean): Suivi | undefined {
  if (PARTIE.test(texte)) return 'partie'
  if (REPRISE.test(texte)) return 'reprise'
  return passagePrecedent ? 'nouvelle' : undefined
}

/** Les objections BLOQUANTES d'un verdict (MAJEUR, MINEUR, puce nue), prêtes à afficher. */
export function objectionsDuVerdict(texte: string, passagePrecedent: boolean): ObjectionDuBloc[] {
  const puces = pucesDuVerdict(texte)
  // Même règle que le contrôle final (objections-juge.ts) : à côté d'un MAJEUR, une puce nue est
  // un constat ; seule OK ne bloque jamais.
  const aUnMajeur = puces.some((p) => p.gravite === 'MAJEUR')
  return puces
    .filter(
      (p) => p.gravite === 'MAJEUR' || p.gravite === 'MINEUR' || (p.gravite === null && !aUnMajeur)
    )
    .map((p) => {
      const { texte: corps, corrige } = separerCorrige(p.texte)
      const suivi = suiviDe(p.texte, passagePrecedent)
      return {
        gravite: p.gravite as GraviteBloquante,
        texte: corps,
        corrige,
        adresses: adressesDe(p.texte),
        ...(suivi ? { suivi } : {})
      }
    })
}

function constatsDuVerdict(texte: string): number {
  return pucesDuVerdict(texte).filter((p) => p.gravite === 'OK').length
}

/** Le bloc à afficher : le dernier passage jugé du run, ou `null` s'il n'y a aucun vote. */
export function blocDesJuges(steps: readonly StepDeRun[]): BlocDesJuges | null {
  const passages = passagesJuges(steps)
  const dernier = passages[passages.length - 1]
  if (!dernier) return null
  const passagePrecedent = passages.length > 1
  const votes = extraireVotesJuges(dernier.steps)
  const avecVerdict = votes.filter((vote) => vote.vote !== 'echec')
  return {
    reparation: dernier.reparation,
    passagePrecedent,
    ...(passagePrecedent ? { reparationPrecedente: passages[passages.length - 2].reparation } : {}),
    votes,
    objections: avecVerdict.flatMap((vote) =>
      objectionsDuVerdict(vote.texte, passagePrecedent).map((o) => ({ ...o, juge: vote.libelle }))
    ),
    constats: avecVerdict.reduce((total, vote) => total + constatsDuVerdict(vote.texte), 0)
  }
}
