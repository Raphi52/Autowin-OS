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
const elements = [], journal = [];
function element(type) {
  const e = { type };
  elements.push(e);
  const api = {
    setTitle(t) { e.titre = t; return api; },
    setHelpText(t) { e.aide = t; return api; },
    setChoiceValues(v) { e.choix = v; return api; },
  };
  return api;
}
const formulaire = {
  setDescription(d) { formulaire.description = d; return formulaire; },
  addSectionHeaderItem: () => element('titre'), addTextItem: () => element('court'),
  addParagraphTextItem: () => element('paragraphe'), addDateItem: () => element('date'),
  addMultipleChoiceItem: () => element('choix'),
  getPublishedUrl: () => 'https://envoyer', getEditUrl: () => 'https://modifier',
};
const contexte = vm.createContext({
  FormApp: { create(t) { formulaire.nom = t; return formulaire; } },
  Logger: { log: (m) => journal.push(m) },
});
vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), contexte);
const rendu = vm.runInContext('creerFormulaire()', contexte);
process.stdout.write(JSON.stringify({ nom: formulaire.nom, description: formulaire.description, elements,
  journal, rendu }));
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


def executer(code):
    with tempfile.TemporaryDirectory() as dossier:
        script = os.path.join(dossier, 'code.gs')
        faux = os.path.join(dossier, 'faux-formapp.js')
        with open(script, 'w', encoding='utf-8', newline='') as fh:
            fh.write(code)
        with open(faux, 'w', encoding='utf-8', newline='') as fh:
            fh.write(FAUX_FORMAPP)
        sortie = subprocess.run([shutil.which('node') or 'node', faux, script], capture_output=True,
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
