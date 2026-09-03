import { describe, expect, it } from 'vitest'
import { separationDeltaCollee, DeltaCollageTracker } from './agent-pilot'

/**
 * COLLAGE DES DELTAS — un préambule streamé qui ne finit pas par un saut de ligne, suivi d'un delta
 * qui OUVRE une fence ```html-render, produisait « Voici :```html-render » sur une seule ligne : la
 * fence n'est alors plus reconnue par le rendu Markdown, et l'utilisateur lit du HTML brut.
 * La séparation est décidée au moment de l'ÉMISSION, jamais en recollant le texte après coup.
 */
describe('separationDeltaCollee', () => {
  it('sépare un préambule sans saut de ligne d’une fence html-render qui suit', () => {
    expect(separationDeltaCollee('Voici le tableau :', '```html-render\n<p>x</p>\n```')).toBe(
      '\n\n'
    )
  })

  it('sépare aussi une fence ouverte après un préambule indenté en fin de liste', () => {
    expect(separationDeltaCollee('- résultat :', '```html-render')).toBe('\n\n')
  })

  // ENTRÉES QUI DOIVENT FAIRE ÉCHOUER UN FIX FAUX (séparation posée trop largement) :
  it('ne coupe JAMAIS un mot en cours de streaming', () => {
    expect(separationDeltaCollee('Voi', 'ci le tableau')).toBe('')
  })

  it('ne redouble pas la séparation quand le texte finit déjà par un saut de ligne', () => {
    expect(separationDeltaCollee('Voici :\n', '```html-render')).toBe('')
    expect(separationDeltaCollee('Voici :\n\n', '```html-render')).toBe('')
  })

  it('ne sépare pas la FERMETURE d’une fence déjà ouverte du texte qui la précède', () => {
    // Ici le delta commence par ``` mais on est à l'intérieur d'un bloc : sans saut de ligne
    // précédent, c'est le contenu du bloc, pas une nouvelle fence — le tracker le sait.
    const tracker = new DeltaCollageTracker()
    expect(tracker.separation('s1', '```html-render\n<p>a</p>')).toBe('')
    expect(tracker.separation('s1', '\n```')).toBe('')
  })

  it('rien à séparer sur le premier delta d’un flux', () => {
    expect(separationDeltaCollee('', '```html-render')).toBe('')
  })
})

describe('DeltaCollageTracker', () => {
  /**
   * MESURE conv-1517 (2026-08-29, capture utilisateur) : le message persiste portait
   * `...cote `src/main`.```html-render` — la fence COLLEE en fin de phrase. CommonMark n'y voit
   * alors aucun bloc : le HTML s'affiche en brut, et le ``` de fermeture reste orphelin, ce qui
   * protege les lignes suivantes et empeche AUSSI l'encadre du bloc de cloture.
   *
   * La cause n'est pas la reprise d'un flux mais son CHANGEMENT : au premier delta d'un NOUVEAU
   * streamId (iteration suivante), le texte deja emis pour CE flux est vide par definition, donc
   * l'ancienne garde ne separait rien — alors que les deux textes finissent dans la MEME part.
   */
  it('separe le PREMIER delta d’un NOUVEAU flux qui ouvre une fence apres une phrase', () => {
    const tracker = new DeltaCollageTracker()
    expect(tracker.separation('0:0', 'Je lance la suite complete.')).toBe('')
    expect(tracker.separation('1:0', '```html-render\n<div>x</div>\n```')).toBe('\n\n')
  })

  /**
   * MESURE conv-1/conv-2 (2026-09-03, signalement utilisateur) : six messages persistes portent
   * une phrase TERMINEE collee au premier mot de l'iteration suivante — « je lance la verification
   * ciblee.Maintenant le cote ecriture ». Le texte de l'iteration N et celui de l'iteration N+1
   * tombent dans la MEME part ; au premier delta du flux NEUF, `dejaEmis` est vide, donc l'ancienne
   * garde ne separait QUE les ouvertures de fence et laissait la prose se souder.
   */
  it('separe une phrase TERMINEE du premier delta d’un nouveau flux', () => {
    const tracker = new DeltaCollageTracker()
    expect(tracker.separation('0:0', 'Je le fais.')).toBe('')
    expect(tracker.separation('1:0', 'Le correctif est en place.')).toBe('\n\n')
  })

  it('separe aussi apres un point d’exclamation, d’interrogation ou un guillemet fermant', () => {
    const t1 = new DeltaCollageTracker()
    expect(t1.separation('0:0', 'Voila pourquoi ?')).toBe('')
    expect(t1.separation('1:0', 'Parce que le flux change.')).toBe('\n\n')
    const t2 = new DeltaCollageTracker()
    expect(t2.separation('0:0', 'Il a dit « oui ».')).toBe('')
    expect(t2.separation('1:0', 'Je continue.')).toBe('\n\n')
  })

  // ENTREES QUI DOIVENT FAIRE ECHOUER UN FIX POSE TROP LARGEMENT :
  it('ne separe pas quand le nouveau flux commence DEJA par une espace', () => {
    const tracker = new DeltaCollageTracker()
    expect(tracker.separation('0:0', 'Premiere phrase.')).toBe('')
    expect(tracker.separation('1:0', ' Deuxieme phrase.')).toBe('')
  })

  it('ne separe pas un nombre decimal coupe entre deux flux', () => {
    const tracker = new DeltaCollageTracker()
    expect(tracker.separation('0:0', 'version 1.')).toBe('')
    expect(tracker.separation('1:0', '2.3 publiee')).toBe('')
  })

  it('ne separe pas quand la phrase precedente n’est pas terminee', () => {
    const tracker = new DeltaCollageTracker()
    expect(tracker.separation('0:0', 'Je lance la suite')).toBe('')
    expect(tracker.separation('1:0', 'complete maintenant')).toBe('')
  })

  it('ne separe pas une phrase terminee qui finit DEJA par un saut de ligne', () => {
    const tracker = new DeltaCollageTracker()
    expect(tracker.separation('0:0', 'Premiere phrase.\n')).toBe('')
    expect(tracker.separation('1:0', 'Deuxieme phrase.')).toBe('')
  })

  it('ne separe pas un nouveau flux qui poursuit de la PROSE', () => {
    // L'entree qui ferait echouer une separation posee trop largement : sans fence, rien a couper.
    const tracker = new DeltaCollageTracker()
    expect(tracker.separation('0:0', 'Premiere phrase.')).toBe('')
    expect(tracker.separation('1:0', ' Suite de la phrase')).toBe('')
  })

  it('ne separe pas quand le flux precedent est DANS une fence ouverte', () => {
    const tracker = new DeltaCollageTracker()
    expect(tracker.separation('0:0', '```html-render\n<div>')).toBe('')
    expect(tracker.separation('1:0', '```')).toBe('')
  })

  it('sépare quand un delta REPREND un streamId dont le texte ne finit pas par un saut de ligne', () => {
    const tracker = new DeltaCollageTracker()
    expect(tracker.separation('s1', 'Préambule :')).toBe('')
    expect(tracker.separation('s2', 'autre flux')).toBe('')
    // Reprise de s1 après une interruption : les deux textes seraient collés dans la même part.
    expect(tracker.separation('s1', 'suite')).toBe('\n\n')
  })

  it('ne sépare pas une reprise dont le texte finit déjà par un saut de ligne', () => {
    const tracker = new DeltaCollageTracker()
    expect(tracker.separation('s1', 'Préambule :\n')).toBe('')
    expect(tracker.separation('s2', 'autre flux')).toBe('')
    expect(tracker.separation('s1', 'suite')).toBe('')
  })

  it('reste transparent sur un flux continu, chunk par chunk', () => {
    const tracker = new DeltaCollageTracker()
    const chunks = ['Le', ' tab', 'leau', ' est', ' prêt.']
    const recolle = chunks.map((chunk) => tracker.separation('s1', chunk) + chunk).join('')
    expect(recolle).toBe('Le tableau est prêt.')
  })
})
