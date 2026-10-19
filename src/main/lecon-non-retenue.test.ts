import { describe, expect, it } from 'vitest'
import {
  AVERTISSEMENT_LECON_NON_RETENUE,
  avertirSiLeconNonRetenue,
  ecritUneLecon,
  ecritUnFichierDeMemoire
} from './lecon-non-retenue'

/**
 * Textes RÉELS de conv-335 et de fils voisins (conversations.json, 2026-10-19). Ce qui doit faire
 * échouer ces tests : une étiquette « Leçon : » réelle qui passe inaperçue, ou une simple mention
 * du mot qui déclenche l'avertissement.
 */
describe('une leçon écrite sans dépôt est signalée à la clôture', () => {
  it('reconnaît les étiquettes réellement écrites dans le chat', () => {
    // Tour ff240730-2bbf-49e3-9923-5db1839772ba, itérations 0 puis 1.
    expect(
      ecritUneLecon(
        "C'est corrigé.\n\n**Leçon** : quand le travail d'une étape est confié à une tâche programmée, je retire l'étape."
      )
    ).toBe(true)
    expect(
      ecritUneLecon(
        "**Leçon corrigée** : pour une demande d'action, les étapes du bloc sont celles de ce que **ce tour** fait."
      )
    ).toBe(true)
    // Recollée par l'utilisateur, sans le gras.
    expect(ecritUneLecon('Leçon : quand le travail d’une étape est confié…')).toBe(true)
    // conv-338, conv-157, conv-165, conv-265 : deux-points dans le gras, puce, parenthèse.
    expect(ecritUneLecon('**Leçon :** un test qui simule des données d’avant…')).toBe(true)
    expect(ecritUneLecon('- Leçon : pour reprendre la couleur d’un élément…')).toBe(true)
    expect(
      ecritUneLecon('**Leçon (pour les prochaines captures de la mosaïque) :**\n- La copie…')
    ).toBe(true)
    expect(ecritUneLecon('**Leçon** (enregistrée dans ma mémoire, `gels.md`) : quand…')).toBe(true)
    // Espace insécable de la typographie française avant les deux-points.
    expect(ecritUneLecon('**Leçon**\u00a0: une mesure…')).toBe(true)
  })

  it('ne confond pas une mention, une citation ou un exemple de code avec une leçon', () => {
    // Tour d5bf24a1-958a-4c94-ad13-80b67a3a1fe0 : la réponse PARLE des leçons, elle n'en écrit pas.
    expect(ecritUneLecon('Les deux « leçons » que tu as recollées n’ont servi à rien.')).toBe(false)
    expect(ecritUneLecon('J’ai noté la leçon : elle est dans le Brain.')).toBe(false)
    expect(ecritUneLecon('> Leçon : quand le travail d’une étape…')).toBe(false)
    expect(ecritUneLecon('```md\nLeçon : exemple\n```')).toBe(false)
    expect(ecritUneLecon('Leçons apprises de ce run, voir plus bas')).toBe(false)
  })

  it('reconnaît une écriture native dans un fichier de mémoire du poste', () => {
    expect(
      ecritUnFichierDeMemoire(
        'Write · C:\\Users\\User\\.claude\\projects\\D--Autowin\\memory\\gels-disque-d-mecanique-sature.md'
      )
    ).toBe(true)
    expect(ecritUnFichierDeMemoire('Edit · /home/u/.claude/projects/x/memory/MEMORY.md')).toBe(true)
    expect(
      ecritUnFichierDeMemoire('Read · C:\\Users\\User\\.claude\\projects\\D--Autowin\\memory\\a.md')
    ).toBe(false)
    expect(ecritUnFichierDeMemoire('Write · D:\\Autowin\\src\\main\\memory-store.ts')).toBe(false)
    expect(ecritUnFichierDeMemoire(undefined)).toBe(false)
  })

  it('avertit une seule fois, et jamais quand un dépôt a eu lieu dans le tour', () => {
    const texte = 'Fait.\n\n**Leçon** : je retire l’étape.'
    const averti = avertirSiLeconNonRetenue(texte, false)
    expect(averti).toBe(`${texte}\n\n${AVERTISSEMENT_LECON_NON_RETENUE}`)
    expect(avertirSiLeconNonRetenue(averti, false)).toBe(averti)
    expect(avertirSiLeconNonRetenue(texte, true)).toBe(texte)
    expect(avertirSiLeconNonRetenue('Fait, sans leçon.', false)).toBe('Fait, sans leçon.')
  })
})
