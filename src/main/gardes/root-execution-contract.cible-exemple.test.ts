import { describe, expect, it } from 'vitest'
import { ciblesNommees } from './root-execution-contract'

/**
 * UN FICHIER CITÉ EN EXEMPLE N’EST PAS UNE CIBLE (conv-1618, 2026-11-05 ; correctif conv-1626).
 *
 * La demande de conv-1618 citait deux fichiers comme POINTS DE COMPARAISON, au format « chemin:ligne » :
 * « alors que le verrou V2 prend celle du serveur de base (X:31) » et « utilise le TimeProvider
 * déjà employé dans Y:77 ». Le contrôle final les a pris pour les fichiers à modifier, et a refusé 202
 * fois de suite un travail juste et publié (364 $). Les vrais fichiers à corriger étaient cités par
 * leur seul nom, sans dossier : la règle ne les voit pas (faux négatif toléré, voir `CIBLE_ANCREE`).
 *
 * Texte de la demande recopié mot pour mot, à un détail près : le nom de l’application métier
 * est remplacé par « Projet » (garde de séparation entreprise).
 */
const DEMANDE_CONV_1618 = [
  "/build Traite ENSEMBLE ces 2 candidats issus du scout interne d'Autowin. C'est la reprise du lot 3 : sa copie de travail avait expiré avant tout travail (« Opération worktree interrompue après 182000 ms »), rien n'a été fait.",
  '',
  "1. Les dates de suppression viennent de l'horloge du poste (`DateTime.Now`). Fichiers, tous dans `D:\\Projet-V3\\src\\Projet.Infrastructure\\Persistence\\Repositories\\` : `InstanceSuppressionRepository.cs:610`, `MesureSuppressionRepository.cs:350`, `PreventionSuppressionRepository.cs:358`, `ProcedureCollectiveSuppressionRepository.cs:444`. — pertinence 30/100",
  "   Pourquoi : elles prennent l'horloge du serveur de bureau à distance, alors que le verrou V2 prend celle du serveur de base (`D:\\Projet-V3\\src\\Projet.Infrastructure\\Verrouillage\\OmbreVerrouLegacySql.cs:31`). Les deux peuvent diverger, et ce n'est pas testable sans changer l'horloge. Impact faible.",
  '   Comment : utilise le `TimeProvider` déjà employé dans `D:\\Projet-V3\\src\\Projet.Application\\Rcs\\CommandesWeb\\TraiterCommandeWebService.cs:77`.',
  '   Preuve : un test avec une horloge figée sur au moins un des quatre dépôts.',
  '2. Mauvaise dépendance citée dans un commentaire de paquet : `D:\\Projet-V3\\Directory.Packages.props:37`. — pertinence 25/100',
  "   Pourquoi : il dit que Rebus.OpenTelemetry 1.4.0 tire `OpenTelemetry.Api` 1.6.0 ; NuGet indique `OpenTelemetry (>= 1.6.0)` (https://www.nuget.org/packages/Rebus.OpenTelemetry/). L'épinglage de version reste nécessaire : seule la formulation est fausse.",
  '   Comment : corrige le commentaire, sans toucher aux versions.',
  '   Preuve : le commentaire cite `OpenTelemetry (>= 1.6.0)`, et `dotnet restore D:\\Projet-V3\\Projet.sln` passe.'
].join('\n')

describe('ciblesNommees : un fichier cité en exemple n’est pas un fichier à modifier', () => {
  it('demande verbatim conv-1618 : aucune des deux références ne devient une cible', () => {
    expect(ciblesNommees(DEMANDE_CONV_1618)).toEqual([])
  })

  it('« déjà employé dans X:77 » est un modèle, pas une cible', () => {
    expect(
      ciblesNommees(
        'Comment : utilise le `TimeProvider` déjà employé dans `src/app/service.ts:77`.'
      )
    ).toEqual([])
  })

  it('« prend celle de Y:31 » est une comparaison, pas une cible', () => {
    expect(
      ciblesNommees(
        'alors que le verrou prend celle du serveur de base (`src/infra/verrou.cs:31`).'
      )
    ).toEqual([])
  })

  it('chemin Windows absolu : la phrase avant le lecteur D: est bien lue', () => {
    const demande =
      'Comment : utilise le `TimeProvider` déjà employé dans `D:\\Projet\\src\\Service.cs:77`.'
    expect(ciblesNommees(demande)).toEqual([])
  })

  it('jumeau : le même chemin Windows, demandé à corriger, reste une cible', () => {
    expect(ciblesNommees('Corrige `D:\\Projet\\src\\Service.cs:77`.')).toEqual([
      'projet/src/service.cs'
    ])
  })

  it('jumeau : la même référence suivie d’une vraie cible dans la même phrase garde la cible', () => {
    expect(
      ciblesNommees(
        'Utilise le TimeProvider déjà employé dans le service et corrige src/main/x.ts:12'
      )
    ).toEqual(['src/main/x.ts'])
  })

  // conv-1613 (2026-11-05, correctif conv-1625) : phrase recopiée mot pour mot de sa demande. Le
  // fichier était cité comme LECTEUR à mesurer ; le contrôle a exigé sa modification 220 fois (402 $).
  it('demande verbatim conv-1613 : un lecteur cité entre parenthèses d’une mesure n’est pas une cible', () => {
    expect(
      ciblesNommees(
        "Mesure d'abord qui lit encore ces SKILL.md (skill_charger, appel par le nom sans barre dans D:\\AutoWinOS\\src\\main\\agent-pilot\\message-du-tour.ts:107, usage hors Autowin) ; ne retire aucun contenu encore lu."
      )
    ).toEqual([])
  })

  it('jumeau : « le module qui lit la config (X:12) » à corriger reste une cible', () => {
    expect(ciblesNommees('Corrige le module qui lit la config (`src/config.ts:12`).')).toEqual([
      'src/config.ts'
    ])
  })

  it('jumeau : la mesure suivie d’un « et corrige » avant la parenthèse garde la cible', () => {
    expect(ciblesNommees('Vérifie qui appelle foo et corrige-le (`src/a.ts:3`).')).toEqual([
      'src/a.ts'
    ])
  })

  it('jumeau : une cible hors parenthèse après une mesure reste une cible', () => {
    expect(ciblesNommees('Mesure qui lit ce fichier, puis corrige src/a.ts:3')).toEqual([
      'src/a.ts'
    ])
  })

  it('jumeau : une cible ancrée sans marqueur de référence reste une cible', () => {
    expect(
      ciblesNommees('Comment : remplace `DateTime.Now` dans `src/infra/repo.cs:610`.')
    ).toEqual(['src/infra/repo.cs'])
  })
})
