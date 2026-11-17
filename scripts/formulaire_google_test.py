"""Tests de scripts/formulaire_google.py (conv-1968) : le script Apps Script généré est exécuté par Node contre
un faux FormApp qui enregistre chaque élément créé, puis comparé au formulaire attendu."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from formulaire_google import generer, main  # noqa: E402

FAUX_FORMAPP = r"""
const fs = require('fs'), vm = require('vm');
const journal = [];
function nouveauFormulaire(elements) {
  const f = { elements };
  function poignee(e) {
    const api = {
      setTitle(t) { e.titre = t; return api; },
      setHelpText(t) { e.aide = t; return api; },
      setChoiceValues(v) { e.choix = v; return api; },
      getTitle() { return e.titre; },
    };
    return api;
  }
  function ajouter(type) { const e = { type }; f.elements.push(e); return poignee(e); }
  Object.assign(f, {
    setDescription(d) { f.description = d; return f; },
    setConfirmationMessage(m) { f.messageFin = m; return f; },
    addSectionHeaderItem: () => ajouter('titre'), addTextItem: () => ajouter('court'),
    addParagraphTextItem: () => ajouter('paragraphe'), addDateItem: () => ajouter('date'),
    addMultipleChoiceItem: () => ajouter('choix'),
    getItems(type) { return f.elements.filter((e) => !type || e.type === type).map(poignee); },
    // Comme Google : moveItem(de, vers) refuse un rang hors limites.
    moveItem(de, vers) {
      if (de < 0 || de >= f.elements.length || vers < 0 || vers >= f.elements.length) throw new Error('hors limites');
      f.elements.splice(vers, 0, f.elements.splice(de, 1)[0]);
    },
    getPublishedUrl: () => 'https://envoyer', getEditUrl: () => 'https://modifier',
  });
  return f;
}
let formulaire = nouveauFormulaire([]);
const contexte = vm.createContext({
  FormApp: {
    ItemType: { SECTION_HEADER: 'titre' },
    create(t) { formulaire.nom = t; return formulaire; },
    openById(id) { formulaire = nouveauFormulaire(JSON.parse(process.argv[4] || '[]')); formulaire.id = id; return formulaire; },
  },
  Logger: { log: (m) => journal.push(m) },
});
vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), contexte);
let rendu, erreur;
try { rendu = vm.runInContext((process.argv[3] || 'creerFormulaire') + '()', contexte); }
catch (e) { erreur = e.message; }
process.stdout.write(JSON.stringify({ nom: formulaire.nom, id: formulaire.id, description: formulaire.description,
  messageFin: formulaire.messageFin, elements: formulaire.elements, journal, rendu, erreur }));
"""

SPEC = {
    'titre': 'Entretien test', 'sousTitre': 'Sous-titre papier',
    'google': {'description': 'En ligne', 'champsExclus': ['Date']},
    'identification': {'champs': ['Date', 'Nom', 'Prénom']},
    'sections': [{'questions': [
        {'texte': 'Cinq tâches ?', 'liste': 5, 'colonnes': [['Tâche', 0.7], ['Fréquence', 0.3]]},
        {'texte': 'Libre', 'aide': 'Par exemple', 'lignes': 3, 'aCote': True},
        {'texte': 'IA', 'aide': 'Exemples', 'parties': [{'libelle': 'Aide'}, {'libelle': 'Jamais'}]},
        {'texte': 'Suite', 'choix': [{'libelle': 'Rappel', 'options': ['Oui', 'Non']}], 'champ': 'Contact'},
    ]}],
}

# Titre de la question 1 tel que le formulaire l'affiche (le texte porte une espace insécable avant « ? »).
PREMIERE = '1. ' + SPEC['sections'][0]['questions'][0]['texte']


def executer(code, fonction='creerFormulaire', existants=None):
    with tempfile.TemporaryDirectory() as dossier:
        script = os.path.join(dossier, 'code.gs')
        faux = os.path.join(dossier, 'faux-formapp.js')
        with open(script, 'w', encoding='utf-8', newline='') as fh:
            fh.write(code)
        with open(faux, 'w', encoding='utf-8', newline='') as fh:
            fh.write(FAUX_FORMAPP)
        sortie = subprocess.run([shutil.which('node') or 'node', faux, script, fonction,
                                 json.dumps(existants or [], ensure_ascii=False)], capture_output=True,
                                encoding='utf-8', check=True)
        return json.loads(sortie.stdout)


class FormulaireGoogle(unittest.TestCase):
    def test_le_script_cree_les_elements_dans_l_ordre_du_pdf(self):
        rendu = executer(generer(SPEC))
        self.assertEqual(rendu['nom'], 'Entretien test')
        self.assertEqual(rendu['description'], 'En ligne')
        self.assertEqual(rendu['elements'], [
            {'type': 'court', 'titre': 'Nom'},
            {'type': 'court', 'titre': 'Prénom'},
            {'type': 'paragraphe', 'titre': '1. Cinq tâches ?',
             'aide': 'Une par ligne, 5 au plus : Tâche, Fréquence.'},
            {'type': 'paragraphe', 'titre': '2. Libre', 'aide': 'Par exemple'},
            {'type': 'titre', 'titre': '3. IA', 'aide': 'Exemples'},
            {'type': 'paragraphe', 'titre': 'Aide'},
            {'type': 'paragraphe', 'titre': 'Jamais'},
            {'type': 'titre', 'titre': '4. Suite', 'aide': ''},
            {'type': 'choix', 'titre': 'Rappel', 'choix': ['Oui', 'Non']},
            {'type': 'court', 'titre': 'Contact'},
        ])
        self.assertEqual(rendu['rendu'], {'envoyer': 'https://envoyer', 'modifier': 'https://modifier'})
        self.assertEqual(len(rendu['journal']), 2)

    def test_sans_cle_google_le_titre_et_le_sous_titre_du_pdf_servent(self):
        spec = {'titre': 'T', 'sousTitre': 'S', 'identification': {'champs': ['Date']}, 'sections': []}
        rendu = executer(generer(spec))
        self.assertEqual((rendu['nom'], rendu['description']), ('T', 'S'))
        self.assertEqual(rendu['elements'], [{'type': 'date', 'titre': 'Date'}])

    def test_titres_de_bloc_et_message_de_fin_propres_au_formulaire_en_ligne(self):
        spec = dict(SPEC, google=dict(SPEC['google'], titreIdentification='Votre profil',
                                      titreQuestions='Les questions', noteQuestions='Quelques mots suffisent.',
                                      messageFin='Merci.'))
        rendu = executer(generer(spec))
        self.assertEqual(rendu['messageFin'], 'Merci.')
        self.assertEqual(rendu['elements'][:4], [
            {'type': 'titre', 'titre': 'Votre profil', 'aide': ''},
            {'type': 'court', 'titre': 'Nom'},
            {'type': 'court', 'titre': 'Prénom'},
            {'type': 'titre', 'titre': 'Les questions', 'aide': 'Quelques mots suffisent.'},
        ])
        self.assertEqual(rendu['elements'][4]['titre'], PREMIERE)

    def test_appliquer_presentation_retouche_le_formulaire_existant_sans_doublon(self):
        spec = dict(SPEC, google=dict(SPEC['google'], idFormulaire='ID-EXISTANT', titreIdentification='Votre profil',
                                      titreQuestions='Les questions', messageFin='Merci.'))
        code = generer(spec)
        # Le formulaire en ligne a été créé avant les titres : on le reproduit sans eux.
        existants = executer(generer(SPEC))['elements']
        rendu = executer(code, 'appliquerPresentation', existants)
        self.assertIsNone(rendu.get('erreur'))
        self.assertEqual(rendu['id'], 'ID-EXISTANT')
        self.assertEqual(rendu['messageFin'], 'Merci.')
        titres = [e['titre'] for e in rendu['elements']]
        self.assertEqual(titres[:5], ['Votre profil', 'Nom', 'Prénom', 'Les questions', PREMIERE])
        self.assertEqual(len(titres), len(existants) + 2)
        # Relancer ne rajoute rien : les titres déjà posés sont reconnus.
        relance = executer(code, 'appliquerPresentation', rendu['elements'])
        self.assertEqual(relance['elements'], rendu['elements'])

    def test_appliquer_presentation_sans_identifiant_refuse_clairement(self):
        rendu = executer(generer(SPEC), 'appliquerPresentation')
        self.assertIn('idFormulaire', rendu['erreur'])

    def test_la_ligne_de_commande_ecrit_le_script(self):
        with tempfile.TemporaryDirectory() as dossier:
            source = os.path.join(dossier, 'spec.json')
            sortie = os.path.join(dossier, 'formulaire.gs')
            with open(source, 'w', encoding='utf-8', newline='') as fh:
                json.dump(SPEC, fh, ensure_ascii=False)
            self.assertEqual(main(['formulaire_google.py', source, sortie]), 0)
            with open(sortie, encoding='utf-8') as fh:
                self.assertEqual(len(executer(fh.read())['elements']), 10)


if __name__ == '__main__':
    unittest.main()
