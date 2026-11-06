/**
 * Le filtre des titres publiés sur le partage (D-9, conv-1429) : il retire ce qui est sensible ET
 * laisse intactes les phrases ordinaires — un filtre qui mange tout ne serait plus une présence.
 */
import { describe, expect, it } from 'vitest'
import { couper, filtrerTitre } from './quartier-presence-filtre'

describe('filtrerTitre — ce qui est retiré', () => {
  it.each([
    // Chemins Windows, UNC, Unix.
    ['Corrige D:\\Projet\\src\\main\\x.ts maintenant', 'Corrige … maintenant'],
    ['Copie vers D:/GIT/projet/fichier.txt', 'Copie vers …'],
    ['Lis \\\\serveur\\partage\\Projets IA\\Board\\x.json', 'Lis …'],
    ['Lis //serveur/partage/Projets IA/Board ensuite', 'Lis … ensuite'],
    ['Ouvre C:\\Mes Documents\\Rapport final.docx', 'Ouvre …'],
    ['Ouvre /home/alice/notes.md', 'Ouvre …'],
    ['Ouvre ~/projets/x', 'Ouvre …'],
    ['Relis ./scripts/essai.mjs', 'Relis …'],
    ['Corrige src/main/mascotte/quartier-presence.ts', 'Corrige …'],
    // Adresses web et mail.
    ['Voir https://exemple.com/a?b=c pour le détail', 'Voir … pour le détail'],
    ['Va sur www.exemple.org', 'Va sur …'],
    ['Le lien dev.exemple.com/projet/page', 'Le lien …'],
    ['Écris à prenom.nom@exemple.fr demain', 'Écris à … demain'],
    // Nombres de 6 chiffres et plus, groupés ou non.
    ['Le numéro 123456789 est faux', 'Le numéro … est faux'],
    ['Numéro 123 456 789 à vérifier', 'Numéro … à vérifier'],
    ['Appelle le 06 12 34 56 78', 'Appelle le …'],
    ['Adresse 192.168.10.25 injoignable', 'Adresse … injoignable'],
    ['Montant 1\u00a0234\u00a0567 relevé', 'Montant … relevé'],
    // Longs identifiants.
    ['Tour 1faec52a-24fa-4289-b0ea-43047b799844 relu', 'Tour … relu'],
    ['Empreinte 9f86d081884c7d659a2feaa0c55ad015 vue', 'Empreinte … vue'],
    ['Jeton ab12CD34ef56GH78ij90 refusé', 'Jeton … refusé'],
    ['Run build-lot-3-3-prouver-vraie-mvv4k4yg rouge', 'Run … rouge'],
    // Noms en MAJUSCULES_AVEC_SOULIGNÉ.
    ['Requête sur BASE_CLIENT_LYON lente', 'Requête sur … lente'],
    ['Lit COMMUN_PARAM puis PROD_NORD', 'Lit … puis …'],
    // Deux morceaux côte à côte n'en font qu'un.
    ['Voir D:\\a\\b 123456789', 'Voir …'],
    ['D:\\a\\b et \\\\srv\\x', '… et …']
  ])('%s', (brut, attendu) => {
    expect(filtrerTitre(brut)).toBe(attendu)
  })
})

describe('filtrerTitre — les phrases ordinaires restent intactes', () => {
  it.each([
    '/build corrige le bouton du Board',
    'Fil conv-1430 : lot 1 sur 5',
    'Réunion du 2026-11-02 à 14:05',
    'Ajoute un test pour l’authentification',
    'Refonte de l’internationalisation',
    'Choisis oui/non, TCP/IP ou km/h',
    'Mes agents / Toute l’équipe',
    'Version 1.2.3 publiée, 15 000 lignes lues',
    'Corrige lireAgentsQuartier et useQuartierAccueil',
    'Écris board.json et presence.json',
    'Plan plan-51219db2 relancé',
    'Pourquoi le tanuki ne bouge pas ?',
    'Les 12 tanukis du quartier, 3 étages, 40 %',
    'Commentaire en MAJUSCULES sans souligné',
    '🦝 Le tanuki du village 🦝',
    'Lot 2 « Relire la présence des collègues » — à faire'
  ])('%s', (phrase) => {
    expect(filtrerTitre(phrase)).toBe(phrase)
  })
})

describe('filtrerTitre — forme', () => {
  it('coupe à 80 caractères, « … » final compris', () => {
    const long = 'Une phrase ordinaire et assez longue '.repeat(5)
    const t = filtrerTitre(long)
    expect(Array.from(t)).toHaveLength(80)
    expect(t.endsWith('…')).toBe(true)
  })

  it('filtre AVANT de couper : un chemin placé à la coupe ne laisse aucun morceau', () => {
    const t = filtrerTitre(`${'x '.repeat(38)}D:\\dossier\\tres\\long\\fichier.txt et la suite`)
    expect(t).not.toMatch(/D:|dossier|fichier/)
    expect(Array.from(t).length).toBeLessThanOrEqual(80)
  })

  it('ne coupe jamais un émoji en deux', () => {
    const t = couper(`${'a'.repeat(78)}🦝🦝🦝`, 80)
    expect(t).toBe(`${'a'.repeat(78)}🦝…`)
  })

  it('met tout sur une ligne et retire les caractères de contrôle', () => {
    expect(filtrerTitre('Ligne un\nligne\tdeux\u0007 ')).toBe('Ligne un ligne deux')
  })

  it("une marque interne glissée dans le titre ne sert pas à masquer la suite d'un chemin", () => {
    expect(filtrerTitre('a\uE000 oui/non')).toBe('a oui/non')
  })

  it('rend une chaîne vide pour un titre vide ou illisible', () => {
    expect(filtrerTitre('')).toBe('')
    expect(filtrerTitre(undefined as unknown as string)).toBe('')
  })
})
