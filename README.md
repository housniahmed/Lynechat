# Lynechat — e-mailing local avec Amazon SES

Application de bureau Windows pour gérer vos contacts et vos campagnes d’e-mails. Elle est écrite de zéro (ce n’est pas une copie de Mailchimp) et couvre :

- les campagnes ;
- les automatisations ;
- les formulaires d’inscription ;
- les statistiques.

Vos contacts, campagnes et statistiques sont enregistrés **sur votre ordinateur**. Les e-mails partent par **Amazon SES**, dans **votre** compte AWS. Il n’y a pas d’abonnement Lynechat : vous payez seulement AWS, selon votre usage.

## Fonctions

| Domaine | Ce que fait Lynechat |
|---|---|
| Contacts | Import CSV avec association des colonnes et détection de l’encodage Excel. Ajout manuel, recherche, filtres, export CSV, champs personnalisés. Fiche contact avec l’historique (ouvertures, clics, désinscription). |
| Organisation | Listes, tags, segments dynamiques. Exemples de règles : « a ouvert la campagne X », « ville = Casablanca », « ajouté depuis 30 jours ». |
| Éditeur d’e-mail | Blocs à glisser-déposer : titre, texte, image, bouton, image + texte, séparateur, espace, réseaux sociaux, HTML. Le texte s’écrit directement dans l’aperçu. Personnalisation `{{prenom}}` et `{{prenom|valeur par défaut}}`. Français ou arabe (sens droite → gauche), aperçu ordinateur et mobile, modèles réutilisables. Les images importées sont intégrées au message, sans hébergement. |
| Campagnes | Audience (listes, tags, segment, exclusions), expéditeur, objet, texte d’aperçu. E-mail de test. Envoi immédiat ou planifié, au débit autorisé par SES, avec pause et reprise. |
| Statistiques | Envois, remises, ouvertures et clics (uniques et totaux), liens cliqués, rebonds, plaintes, désinscriptions, liste des destinataires filtrable, tableau de bord sur 30 jours. |
| Automatisations | Déclencheurs : inscription à une liste, ajout d’un tag, formulaire, date anniversaire, inscription manuelle. Étapes : e-mail, attente, ajout ou retrait de tag ou de liste. Condition possible « si l’e-mail précédent a été (ou non) ouvert ou cliqué ». Statistiques par e-mail. |
| Formulaires | Code HTML à coller sur votre site (WordPress, Metaforma…), ou page d’inscription autonome en .html. Champs personnalisés, case de consentement, anti-robots, double opt-in, version arabe. |
| Conformité | Lien de désinscription obligatoire (l’envoi est refusé sans lui), désinscription en un clic (en-têtes `List-Unsubscribe`), exclusion automatique des désinscrits, rebonds définitifs et plaintes. Un import ne réabonne jamais un désinscrit. Adresse postale dans le pied de page, date et source du consentement enregistrées. |

## Fonctionnement technique

```
Lynechat (votre PC)  ── envoi ──►  Amazon SES  ──►  boîtes de réception
      ▲                                │ événements (remise, ouverture, clic, rebond, plainte)
      │                                ▼
      └── lecture toutes les 3 s ── file SQS ◄── fonction Lambda publique
                                                  (désinscription, confirmation, formulaires)
```

Le bouton **Paramètres → Installer l’infrastructure** crée tout cela dans votre compte AWS, avec un modèle CloudFormation nommé « lynechat ».

## Démarrage

1. **Compte AWS.** Dans IAM, créez un utilisateur dédié, ajoutez-lui la politique affichée dans Lynechat (Paramètres → « Voir la politique IAM »), puis créez une clé d’accès.
2. **Connexion.** Dans Lynechat, ouvrez Paramètres → 1, choisissez la région (par exemple Paris, `eu-west-3`), saisissez les clés, puis cliquez sur « Tester et enregistrer ».
3. **Infrastructure.** Ouvrez Paramètres → 2 et cliquez sur « Installer l’infrastructure » (1 à 3 minutes).
4. **Domaine.** Ouvrez Paramètres → 3, ajoutez votre domaine, puis ajoutez chez votre hébergeur DNS les 3 enregistrements CNAME (DKIM) affichés. L’enregistrement DMARC affiché est recommandé.
5. **Informations légales.** Dans Paramètres → 4, renseignez le nom et l’adresse postale de l’entreprise, ainsi que l’expéditeur par défaut.
6. **Accès production.** Un compte SES neuf est en **bac à sable** : il ne peut écrire qu’à des adresses vérifiées, avec un petit quota. Demandez l’accès production dans la console AWS : Amazon SES → Tableau de bord du compte.

## Limites à connaître

- **L’application doit être ouverte** pour envoyer : campagnes, campagnes planifiées, automatisations, et lecture des inscriptions et statistiques. Les étapes en retard partent à la réouverture. Les inscriptions et événements restent conservés 14 jours dans la file AWS.
- **Ouvertures indicatives.** Apple Mail précharge les images (fausses ouvertures), d’autres messageries les bloquent (ouvertures manquées). AWS signale certains robots, qui sont exclus.
- **Images.** Celles importées depuis l’ordinateur sont jointes à chaque message. Gardez-les légères : Lynechat les redimensionne à 1 200 px et prévient au-delà de 1,5 Mo.
- **Données.** Un seul utilisateur et un seul ordinateur. Pour changer d’ordinateur, il faut copier le fichier `lynechat.sqlite` (dossier `%APPDATA%\Lynechat`).
- **Pages hébergées.** Les pages d’inscription sont des fichiers .html à héberger vous-même : Lynechat ne les héberge pas.
- **Langue des pages publiques.** La page de confirmation d’inscription s’affiche en français. La page de désinscription s’affiche en français ou en arabe, selon la langue du contact.

## Ce qui a été testé, et ce qui ne l’a pas été

**Testé, avec AWS simulé :**
- moteur complet (`npm test`) : import, segments, audience, envoi, en-têtes de désinscription, événements, rebonds, désinscription par la vraie fonction Lambda, formulaire avec double opt-in, automatisation de bienvenue, date anniversaire, planification ;
- parcours de l’interface dans Electron (`test/ui.test.js`) ;
- formulaire généré, soumis depuis un navigateur vers la fonction Lambda (`test/form.test.js`) ;
- modèle CloudFormation validé avec `cfn-lint`.

**Non testé :** aucun envoi ni déploiement n’a été fait sur un vrai compte AWS, faute d’identifiants. Les noms d’API, le format des événements SES et les permissions Lambda viennent de la documentation AWS et des définitions du SDK, mais le premier déploiement réel reste à vérifier. L’installateur Windows a seulement été testé sous Wine.

## Espaces clients et rapports PDF (v0.3)

- **Espaces clients** : un espace par client ou par marque (menu en haut de la barre latérale). Chaque espace a sa propre base (`workspaces/<id>.sqlite`) : contacts, listes, tags, segments, modèles, campagnes, automatisations, formulaires, expéditeur et informations légales. Le compte AWS, l'infrastructure d'envoi et les domaines vérifiés sont communs.
- Les événements AWS sont rangés dans le bon espace : étiquette SES `ws` sur chaque envoi, identifiant de l'espace dans le paramètre signé `c` du lien de désinscription (`ws~campagne`), identifiant de formulaire pour les inscriptions. Les liens déjà envoyés depuis l'espace principal restent valables. Aucune mise à jour de l'infrastructure AWS n'est nécessaire.
- Supprimer un espace déplace sa base dans `workspaces/corbeille` au lieu de l'effacer.
- **Rapports PDF** (menu « Rapports PDF » ou bouton sur les statistiques d'une campagne) : rapport de campagne ou d'activité sur une période, avec le nom, le logo et la couleur de l'agence (« Espaces clients → Votre agence ») et le logo du client. Bureau : PDF A4 enregistré directement. Version serveur : page imprimable (« Enregistrer au format PDF »).

## Version serveur (navigateur)

Lynechat peut aussi tourner sur un serveur Linux, accessible depuis n’importe quel navigateur avec un mot de passe, et fonctionner 24 h/24. Voir `DEPLOY-ORACLE.md` (guide en anglais, Oracle Cloud « Always Free ») et `deploy/install.sh`.

## Développement

```bash
npm install
npm start          # application réelle
npm run demo       # AWS simulé (aucun envoi réel)
npm test           # tests du moteur
npm run web        # version serveur en local (http://127.0.0.1:3000)
```
