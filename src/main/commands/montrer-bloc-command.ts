import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, isAbsolute, resolve } from 'node:path'

/**
 * `montrer_bloc` — POSER DANS LE FIL UN BLOC ```html-render / ```html-interactif LU DANS UN FICHIER
 * (conv-1306, 2026-10-30).
 *
 * Cause : le fil n'affiche un bloc que s'il est écrit dans le TEXTE de la réponse. Pour montrer le
 * carrousel d'un /draft (scripts/draft-carrousel.mjs, 52 ko), l'agent devait relire le fichier puis le
 * réécrire en entier : le bloc passait deux fois par sa mémoire de travail (≈ 28 600 jetons chacune).
 * Mesuré dans conv-1306 : la relecture s'est arrêtée à la ligne 162 sur 218, et l'utilisateur a reçu
 * des maquettes empilées, sans les boutons de choix.
 *
 * Le bloc part dans le fil comme un TEXTE de la réponse, sur un flux à lui (`PREFIXE_FLUX_BLOC`) :
 * même rendu, même filtre, mêmes boutons « Affiner la N » qu'un bloc écrit par l'agent, et le verrou
 * des boutons déjà envoyés (`promptsDesBoutons`, qui lit les parts texte) le retrouve après un
 * redémarrage. Il ne part JAMAIS au modèle IA : le résultat de la commande n'en donne que le résumé.
 *
 * Chaque refus est NOMMÉ, comme `show_video` : un bloc mal fermé s'afficherait en texte brut, et
 * l'agent croirait l'avoir montré.
 */

/** Préfixe du flux de texte d'un bloc posé par la commande (`<préfixe><actionId>`). */
export const PREFIXE_FLUX_BLOC = 'bloc-fichier:'

/**
 * Au-delà, une page n'a plus sa place dans le fil : la consigne du chat demande alors un artefact
 * `.html` (« Au-delà d'environ 1 Mo », chat-pilotage-prompt.ts).
 */
export const OCTETS_MAX_BLOC = 1024 * 1024

/** Les seuls langages de bloc que la commande pose : ceux qui portent des boutons de choix. */
export const LANGAGES_DU_BLOC = ['html-render', 'html-interactif'] as const
export type LangageDuBloc = (typeof LANGAGES_DU_BLOC)[number]

const EXTENSIONS_ACCEPTEES = new Set(['.md', '.html', '.htm'])

/** Vrai pour le flux d'un bloc posé par `montrer_bloc` : ce n'est pas du texte dit par le modèle. */
export function estUnFluxDeBloc(streamId: string | undefined): boolean {
  return typeof streamId === 'string' && streamId.startsWith(PREFIXE_FLUX_BLOC)
}

export function fluxDuBloc(actionId: string): string {
  return `${PREFIXE_FLUX_BLOC}${actionId}`
}

/**
 * Le texte du flux : le bloc entre deux sauts de ligne. Le fil recolle les parts texte voisines
 * (`coalesceAssistantParts`) ; sans eux, une phrase de l'agent sans retour final soudait la clôture
 * d'ouverture à sa fin de ligne, et le bloc sortait en texte brut.
 */
export function texteDuBlocDansLeFil(bloc: string): string {
  return `\n${bloc}\n`
}

function estUnLangageDuBloc(valeur: string): valeur is LangageDuBloc {
  return (LANGAGES_DU_BLOC as readonly string[]).includes(valeur)
}

/** Une ligne qui ouvre ou ferme une clôture de code Markdown (``` ou ~~~, 0 à 3 espaces devant). */
const LIGNE_DE_CLOTURE = /^ {0,3}(`{3,}|~{3,})(.*)$/

export type BlocLu = { ok: true; langage: LangageDuBloc; bloc: string } | { ok: false; raison: string }

/**
 * Le bloc complet (clôtures comprises) tiré du CONTENU d'un fichier :
 *  - un `.md` produit par draft-carrousel.mjs : UN bloc ```html-render ou ```html-interactif, rien autour ;
 *  - une page HTML brute : enveloppée dans le langage demandé (`html-render` par défaut).
 * Une ligne qui fermerait la clôture avant la fin est refusée : la suite sortirait en texte brut.
 */
export function blocDuContenu(contenu: string, langageDemande?: string): BlocLu {
  const texte = contenu.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  if (texte === '') return { ok: false, raison: 'le fichier est vide' }
  if (langageDemande !== undefined && !estUnLangageDuBloc(langageDemande))
    return {
      ok: false,
      raison: `langage « ${langageDemande} » inconnu : ${LANGAGES_DU_BLOC.join(' ou ')}`
    }
  const lignes = texte.split('\n')
  const ouverture = LIGNE_DE_CLOTURE.exec(lignes[0])
  if (!ouverture) {
    // Page brute : aucune ligne ne doit ressembler à une clôture, sinon elle fermerait le bloc.
    const fautive = lignes.findIndex((ligne) => LIGNE_DE_CLOTURE.test(ligne))
    if (fautive >= 0)
      return {
        ok: false,
        raison: `la ligne ${fautive + 1} commence par une clôture de code (\`\`\` ou ~~~) : elle couperait le bloc`
      }
    const langage = langageDemande ?? 'html-render'
    return { ok: true, langage, bloc: '```' + langage + '\n' + texte + '\n```' }
  }
  const [, marque, info] = ouverture
  const langage = info.trim()
  if (!estUnLangageDuBloc(langage))
    return {
      ok: false,
      raison: `le bloc est en « ${langage || 'sans langage'} » : seuls ${LANGAGES_DU_BLOC.join(' et ')} se posent dans le fil`
    }
  if (langageDemande !== undefined && langageDemande !== langage)
    return {
      ok: false,
      raison: `le fichier contient un bloc ${langage}, pas ${langageDemande}`
    }
  const fermeLaClotureOuverte = (ligne: string): boolean => {
    const m = LIGNE_DE_CLOTURE.exec(ligne)
    return (
      m !== null && m[1][0] === marque[0] && m[1].length >= marque.length && m[2].trim() === ''
    )
  }
  const fin = lignes.findIndex((ligne, index) => index > 0 && fermeLaClotureOuverte(ligne))
  if (fin < 0) return { ok: false, raison: `le bloc ${langage} n'est jamais refermé` }
  if (fin !== lignes.length - 1)
    return {
      ok: false,
      raison: `le bloc ${langage} se referme à la ligne ${fin + 1} sur ${lignes.length} : le fichier doit ne contenir que ce bloc`
    }
  return { ok: true, langage, bloc: texte }
}

/** Nombre de boutons « prompter » (`#autowin-prompt`) que porte le bloc. */
export function nombreDeBoutons(bloc: string): number {
  return bloc.match(/<a\b[^>]*\bhref\s*=\s*["']#autowin-prompt["']/gi)?.length ?? 0
}

export type BlocAMontrer =
  | { ok: true; bloc: string; resume: Record<string, unknown> }
  | { ok: false; raison: string }

function kilo(octets: number): string {
  return `${Math.round(octets / 1024)} ko`
}

export function preparerBlocAMontrer(
  args: Record<string, unknown>,
  dossierDeTravail: string,
  maxOctets = OCTETS_MAX_BLOC
): BlocAMontrer {
  const demande = typeof args.path === 'string' ? args.path.trim() : ''
  if (demande === '') return { ok: false, raison: 'chemin manquant : `path` est obligatoire' }
  const langageDemande =
    typeof args.langage === 'string' && args.langage.trim() !== '' ? args.langage.trim() : undefined
  // Un chemin absolu peut viser un autre dossier : l'agent le lit déjà avec ses propres outils, et le
  // bloc ne sort pas du poste (il s'affiche chez le même utilisateur).
  const absolu = isAbsolute(demande) ? resolve(demande) : resolve(dossierDeTravail, demande)
  if (!EXTENSIONS_ACCEPTEES.has(extname(absolu).toLowerCase()))
    return {
      ok: false,
      raison: `${demande} n'est ni un .md ni un .html : seul un bloc html-render ou html-interactif se pose dans le fil`
    }
  if (!existsSync(absolu)) return { ok: false, raison: `fichier introuvable : ${demande}` }
  const stats = statSync(absolu)
  if (!stats.isFile()) return { ok: false, raison: `${demande} n'est pas un fichier` }
  if (stats.size > maxOctets)
    return {
      ok: false,
      raison: `${demande} pèse ${kilo(stats.size)} : au-delà de ${kilo(maxOctets)}, une page se livre en artefact .html, pas dans le fil`
    }
  const lu = blocDuContenu(readFileSync(absolu, 'utf8'), langageDemande)
  if (!lu.ok) return { ok: false, raison: `${demande} : ${lu.raison}` }
  return {
    ok: true,
    bloc: lu.bloc,
    resume: {
      montre: true,
      chemin: absolu,
      langage: lu.langage,
      octets: Buffer.byteLength(lu.bloc),
      boutons: nombreDeBoutons(lu.bloc),
      note: 'Le bloc est posé dans le fil à la place de cet appel. Ne le recopie pas dans ta réponse.'
    }
  }
}
