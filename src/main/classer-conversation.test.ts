import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * CLASSER UNE CONVERSATION — la capacité absente poussait l'agent au pire chemin.
 *
 * Demande de l'utilisateur : « ranges moi mes conversations dans des sous catégories adéquates ».
 * Mesuré dans `conv-1244` le 2026-08-15, en rejouant le journal du tour : faute de commande pour
 * classer, l'agent a tenté de piloter le BUREAU WINDOWS à la souris — `desktop_act`, clics qui
 * ouvrent les réglages rapides de Windows par erreur, tentative de relancer l'application — puis a
 * échoué sur « Type d'action desktop inconnu: double_click ». Rien n'a été rangé.
 *
 * Le catalogue savait RENOMMER et SUPPRIMER une conversation, jamais la CLASSER, alors que
 * `conversations.setProjectPath` existait déjà côté magasin. C'est la même forme que `list_files` le
 * même jour : une capacité manquante ne rend pas l'agent prudent, elle le pousse vers un chemin
 * désespéré — et l'échec se présente ensuite comme un problème de l'utilisateur.
 */
const source = readFileSync(join(__dirname, 'commands.ts'), 'utf8')

describe('commande de classement des conversations', () => {
  it('est OFFERTE dans le catalogue, sinon l’agent ne peut pas la choisir', () => {
    // Une capacité non cataloguée est invisible au modèle : elle n'existe pas de son point de vue.
    expect(source).toContain("name: 'classer_conversation'")
  })

  it('s’appuie sur le magasin existant plutôt que d’inventer un stockage', () => {
    const compact = source.replace(/\s+/g, ' ')
    expect(compact).toContain('conversations.setProjectPath(')
  })

  it('un dossier VIDE déclasse au lieu d’écrire une chaîne vide', () => {
    // Sans cela, « déclasser » créerait un groupe au nom vide dans la barre latérale.
    const compact = source.replace(/\s+/g, ' ')
    const zone = compact.slice(compact.indexOf("case 'classer_conversation'"))
    expect(zone.slice(0, 400)).toContain('dossier || null')
  })

  it('RAFRAÎCHIT la vue : un classement invisible ne vaut rien', () => {
    const compact = source.replace(/\s+/g, ' ')
    const zone = compact.slice(compact.indexOf("case 'classer_conversation'"))
    expect(zone.slice(0, 500)).toContain("scope: 'conversations'")
  })

  it('DIT quand la conversation est introuvable, au lieu de se taire', () => {
    const compact = source.replace(/\s+/g, ' ')
    const zone = compact.slice(compact.indexOf("case 'classer_conversation'"))
    expect(zone.slice(0, 400)).toContain('conversation introuvable')
  })
})
