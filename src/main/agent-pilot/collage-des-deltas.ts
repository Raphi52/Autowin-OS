// Texte streamé du tour : préfixe déjà émis, collage des deltas (fences, phrases soudées) et
// retrait d’une conclusion bloquante prématurée, sortis tels quels de agent-pilot.ts (conv-1580,
// lot 1).
import { suivreBlocsDeCode } from '../../shared/bloc-de-code'

/**
 * T1b — reconstruction du texte déjà streamé, FACTORISÉE. `chat()` doit émettre en `delta` le texte
 * final moins ce qui a déjà été streamé pendant l'appel provider (pour ne jamais dupliquer à
 * l'écran) — cette logique de `startsWith` vivait EN DOUBLE (cas « pas de commande » sur le texte
 * entier joint, et cas « ordered tokens » consommé token par token). Une seule fonction pure, les
 * deux mêmes 3 branches partout : le reste du texte déjà couvert par le préfixe streamé, le préfixe
 * restant à consommer, ou aucun recouvrement (le préfixe streamé ne correspond plus au texte final —
 * on ne réémet rien plutôt que de deviner).
 */
export function consumeStreamedPrefix(
  text: string,
  prefixRemaining: string
): { visible: string; prefixRemaining: string } {
  if (!prefixRemaining) return { visible: text, prefixRemaining: '' }
  if (prefixRemaining.startsWith(text)) {
    return { visible: '', prefixRemaining: prefixRemaining.slice(text.length) }
  }
  if (text.startsWith(prefixRemaining)) {
    return { visible: text.slice(prefixRemaining.length), prefixRemaining: '' }
  }
  return { visible: '', prefixRemaining: '' }
}

/**
 * COLLAGE DES DELTAS — deux textes émis à la suite sur le MÊME `streamId` sont concaténés tels quels
 * par le réducteur de tour (`reduceChatTurn`). Quand le premier ne finit pas par un saut de ligne et
 * que le suivant OUVRE une fence (« Voici :» + « ```html-render »), la fence se retrouve en milieu
 * de ligne : le rendu Markdown ne la reconnaît plus et l'utilisateur lit du HTML brut.
 *
 * La séparation est décidée à l'ÉMISSION, sur le texte DÉJÀ émis pour ce flux — on n'insère rien
 * quand le texte finit déjà par un saut de ligne, et JAMAIS au milieu d'un mot en cours de stream.
 */
export function separationDeltaCollee(dejaEmis: string, suivant: string): string {
  if (!dejaEmis || !suivant) return ''
  if (/\n[ \t]*$/.test(dejaEmis)) return ''
  // Seule une OUVERTURE de fence en tête du nouveau delta justifie de couper une ligne en cours.
  return /^[ \t]*(?:```|~~~)/.test(suivant) ? '\n\n' : ''
}

/**
 * FENCE SOUDEE EN MILIEU DE LIGNE — la moitie que `separationDeltaCollee` ne peut PAS voir.
 *
 * MESURE DU 2026-09-03 (conv-8, signalement utilisateur « le html ne s'est pas render ») : le
 * journal du tour porte un SEUL delta (`0:0:ordered:4`, 4 925 car.) dont le texte est
 * « …est bien branchee.```html-render
<!doctype html> ». Le collage n'est donc pas a la JOINTURE
 * de deux deltas — il est DEJA dans le texte d'un delta unique, assemble en amont de l'emission.
 * `DeltaCollageTracker` n'inspecte que la frontiere entre deux deltas : il ne pouvait rien y faire,
 * et CommonMark, qui exige une fence en debut de ligne, a rendu 4 900 caracteres de HTML en prose.
 *
 * La regle est volontairement ETROITE, parce que le prompt de chat parle lui-meme de
 * « ```html-render » au milieu de ses phrases : transformer ces mentions en vraies fences serait une
 * regression pire que le defaut. On ne coupe donc que si les QUATRE conditions d'une vraie
 * OUVERTURE sont reunies :
 *   (1) le marqueur est precede, sur la meme ligne, par autre chose que de l'espace ;
 *   (2) il est suivi d'une etiquette de langage d'un seul mot (`html-render`, `ts`, `json`) ;
 *   (3) cette etiquette TERMINE la ligne — une mention en prose se poursuit par des mots ;
 *   (4) on n'est pas DEJA dans une fence ouverte, ou ``` est du contenu.
 */
export function detacherFenceCollee(texte: string): string {
  if (!texte.includes('```') && !texte.includes('~~~')) return texte
  const lignes = texte.split(/(\r?\n)/u)
  const suivi = suivreBlocsDeCode()
  for (let index = 0; index < lignes.length; index += 2) {
    const ligne = lignes[index]
    if (suivi.delimiteur(ligne) || suivi.dansUnBloc) continue
    const soudure = /^(.*[^\s`~])(`{3,}|~{3,})([A-Za-z][\w-]*)[ \t]*$/u.exec(ligne)
    if (!soudure) continue
    lignes[index] = `${soudure[1]}\n\n${soudure[2]}${soudure[3]}`
    suivi.delimiteur(`${soudure[2]}${soudure[3]}`)
  }
  return lignes.join('')
}

/**
 * SOUDURE DE DEUX PHRASES — mesure du 2026-09-03 (signalement utilisateur, 6 occurrences dans
 * `conversations.json` : « je lance la vérification ciblée.Maintenant le côté écriture »). Le texte
 * d'une itération et celui de la suivante tombent dans la MÊME part ; quand le premier finit sur un
 * point et que le second commence par une lettre, la phrase suivante se colle au point et l'espace
 * manque à l'écran. Ce n'est PAS un défaut de rédaction du modèle : c'est le recollage des flux.
 *
 * La règle reste étroite pour ne pas couper ce qui se poursuit vraiment : rien si l'un des deux
 * côtés porte déjà une espace, rien si la phrase n'est pas terminée, rien devant un CHIFFRE (un
 * « version 1. » + « 2.3 » n'est pas une nouvelle phrase).
 */
const FIN_DE_PHRASE = /[.!?…][»”"')\]]*$/u
const DEBUT_DE_PHRASE = /^[\p{L}«“"'(#*\->`]/u

export function soudureDePhrases(precedent: string, suivant: string): boolean {
  if (!precedent || !suivant) return false
  if (/\s$/u.test(precedent) || /^\s/u.test(suivant)) return false
  return FIN_DE_PHRASE.test(precedent) && DEBUT_DE_PHRASE.test(suivant)
}

/**
 * Mémoire du texte déjà émis par `streamId`, pour deux cas de collage :
 * (1) un delta qui ouvre une fence juste après un préambule sans saut de ligne ;
 * (2) un delta qui REPREND un streamId après qu'un autre flux ait parlé — la reprise est recollée
 *     dans la même part alors que le lecteur attend un nouveau paragraphe.
 * À l'intérieur d'une fence déjà ouverte, aucune séparation n'est insérée : ``` y est du contenu.
 */
export class DeltaCollageTracker {
  private readonly emis = new Map<string, string>()
  private dernierStreamId: string | undefined

  separation(streamId: string, texte: string): string {
    const dejaEmis = this.emis.get(streamId) ?? ''
    const changementDeFlux = this.dernierStreamId !== undefined && this.dernierStreamId !== streamId
    /**
     * Le texte qui PRECEDE reellement ce delta dans la part rendue. Au premier delta d'un flux
     * NEUF, `dejaEmis` est vide par definition : lire ce flux-la ne pouvait donc rien separer,
     * et la fence arrivait collee a la phrase du flux precedent (mesure conv-1517).
     */
    const precedent = changementDeFlux
      ? (this.emis.get(this.dernierStreamId as string) ?? '')
      : dejaEmis
    let separation = ''
    if (precedent && !this.fenceOuverte(precedent)) {
      separation = changementDeFlux
        ? dejaEmis
          ? // REPRISE d’un flux deja parle : le lecteur attend un nouveau paragraphe.
            /\n[ \t]*$/.test(dejaEmis)
            ? ''
            : '\n\n'
          : // Flux NEUF : couper si le delta OUVRE une fence, ou si la phrase precedente est
            // TERMINEE et que le nouveau texte viendrait se souder a son point final. Hors de ces
            // deux cas on ne coupe rien — le modele peut simplement poursuivre sa phrase.
            separationDeltaCollee(precedent, texte) ||
            (soudureDePhrases(precedent, texte) ? '\n\n' : '')
        : separationDeltaCollee(dejaEmis, texte)
    }
    this.emis.set(streamId, dejaEmis + separation + texte)
    this.dernierStreamId = streamId
    return separation
  }

  private fenceOuverte(texte: string): boolean {
    const suivi = suivreBlocsDeCode()
    for (const ligne of texte.split('\n')) suivi.delimiteur(ligne)
    return suivi.dansUnBloc
  }
}

export function retirerConclusionBloquantePrematuree(texte: string): string {
  let resultat = texte
  while (true) {
    const marqueurs =
      /^[ \t]*(?:(?:>[ \t]*)|(?:[-*+][ \t]+)|(?:\d+[.)][ \t]+))*(?:#{1,6}[ \t]+)?(?:(?:\*\*|__)[ \t]*)?⛔\uFE0F?[ \t]+Bloqué(?:[ \t]*(?:\*\*|__))?(?<suite>[^\r\n]*)/gimu
    let marqueur: RegExpExecArray | null
    let retrait: { debut: number; fin: number } | undefined
    while ((marqueur = marqueurs.exec(resultat)) !== null) {
      const suite = marqueur.groups?.suite ?? ''
      if (!/^[ \t]*(?:\p{P}|$)/u.test(suite)) continue
      const depuisMarqueur = resultat.slice(marqueur.index)
      const paragrapheSuivant = /\r?\n[ \t]*\r?\n/.exec(depuisMarqueur)
      retrait = {
        debut: marqueur.index,
        fin:
          paragrapheSuivant && paragrapheSuivant.index !== undefined
            ? marqueur.index + paragrapheSuivant.index + paragrapheSuivant[0].length
            : resultat.length
      }
      break
    }
    if (!retrait) return resultat
    const avant = resultat.slice(0, retrait.debut).trimEnd()
    const apres = resultat.slice(retrait.fin).trimStart()
    resultat = [avant, apres].filter(Boolean).join('\n\n')
  }
}
