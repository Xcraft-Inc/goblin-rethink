# 📘 Documentation du module goblin-rethink

## Aperçu

Le module **goblin-rethink** est un adaptateur RethinkDB pour l'écosystème Xcraft qui fournit une interface complète pour interagir avec une base de données RethinkDB. Il offre des fonctionnalités de stockage, de requêtage, de surveillance en temps réel des changements, et inclut un système ETL (Extract, Transform, Load) intégré pour l'extraction et la transformation de données.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Configuration avancée](#configuration-avancée)
- [Détails des sources](#détails-des-sources)

## Structure du module

Le module est organisé autour de plusieurs composants principaux :

- **Service principal `rethink`** : Interface de base pour toutes les opérations RethinkDB
- **Acteur `rethinkJob`** : Gestion des tâches d'extraction ETL
- **Système de queue** : Orchestration des tâches ETL en arrière-plan
- **Widgets d'interface** : Éditeur de requêtes et interface de gestion des jobs
- **Worker pool** : Exécution parallèle des requêtes via des processus dédiés
- **Hinter builder** : Construction d'interfaces de recherche pour RethinkDB

## Fonctionnement global

Le module fonctionne selon une architecture en couches :

1. **Couche de connexion** : Gestion des connexions RethinkDB avec pool de connexions
2. **Couche de requêtage** : Interface simplifiée pour les opérations CRUD et requêtes complexes
3. **Couche de surveillance** : Système de change feeds pour la réactivité en temps réel
4. **Couche ETL** : Système d'extraction et transformation de données avec interface graphique
5. **Couche de performance** : Worker pool pour l'exécution parallèle des requêtes
6. **Couche d'interface** : Hinters et workitems pour l'interaction utilisateur

Le service principal maintient une connexion persistante à RethinkDB et expose des méthodes pour :

- Les opérations CRUD (Create, Read, Update, Delete)
- Les requêtes complexes avec filtres, jointures et agrégations
- La surveillance des changements en temps réel
- La gestion des index et de la structure de base de données

## Exemples d'utilisation

### Utilisation basique du service RethinkDB

```javascript
// Création du service RethinkDB
const rethinkAPI = await this.quest.create('rethink', {
  host: 'localhost:28015',
  database: 'myapp',
  collectStats: true,
});

// Insertion de documents
await rethinkAPI.set({
  table: 'users',
  documents: [
    {
      id: 'user1',
      name: 'John Doe',
      email: 'john@example.com',
      meta: {status: 'published'},
    },
  ],
});

// Récupération d'un document
const user = await rethinkAPI.get({
  table: 'users',
  documentId: 'user1',
});

// Requête avec filtres
const activeUsers = await rethinkAPI.getAll({
  table: 'users',
  status: ['published'],
  filter: {active: true},
  orderBy: 'name',
});
```

### Surveillance des changements en temps réel

```javascript
// Démarrage de la surveillance
await rethinkAPI.startQuestOnChanges({
  table: 'users',
  goblinId: this.quest.goblin.id,
  includeInitial: true,
});

// Gestion des événements de changement
this.quest.sub(
  `*::${rethinkAPI.id}.${this.quest.goblin.id}-cursor.changed`,
  async function (err, {msg}) {
    const {type, new_val, old_val} = msg.data;
    switch (type) {
      case 'add':
        await this.quest.handleUserAdded(new_val);
        break;
      case 'change':
        await this.quest.handleUserChanged(old_val, new_val);
        break;
      case 'remove':
        await this.quest.handleUserRemoved(old_val);
        break;
    }
  }
);
```

### Création et exécution d'un job ETL

```javascript
// Création d'un job d'extraction
const jobId = `rethinkJob@${this.quest.uuidV4()}`;
await this.quest.createEntity(jobId, {
  name: 'Export Users',
  source: `
    function* extract(next) {
      const q = r.db('myapp').table('users').filter({active: true});
      return yield q.run(con, next);
    }
    
    function* transform(row) {
      return {
        id: row.id,
        fullName: row.firstName + ' ' + row.lastName,
        email: row.email
      };
    }
    
    const csvOutput = csv('active_users.csv');
    function* load(row) {
      yield csvOutput.insert(row);
    }
  `,
});

// Exécution du job via la queue
this.quest.evt('*::*.<rethinkJob-run-requested>', {
  rethinkJobId: jobId,
  desktopId: this.quest.getDesktopId(),
});
```

### Utilisation du hinter builder

```javascript
// Construction d'un hinter personnalisé
const hinterCommands = buildHinter({
  type: 'myEntity',
  field: 'name',
  title: "Recherche d'entités",
  detailWidget: 'myEntity-workitem',
  newWorkitem: {
    name: 'myEntity-workitem',
    description: 'Nouvelle entité',
    newEntityType: 'myEntity',
    view: 'default',
    icon: 'solid/plus',
  },
});
```

## Interactions avec d'autres modules

Le module **goblin-rethink** interagit étroitement avec plusieurs modules de l'écosystème Xcraft :

- **[goblin-workshop]** : Utilise les builders pour créer les entités, workitems et outputs CSV/JSON
- **[goblin-elasticsearch]** : Partage des patterns pour les hinters de recherche
- **[goblin-nabu]** : Utilise le système de traduction pour l'interface utilisateur
- **[xcraft-core-goblin]** : Hérite des fonctionnalités de base des acteurs Goblin
- **[xcraft-core-shredder]** : Utilise les structures de données immutables
- **[xcraft-core-utils]** : Utilise CursorPump pour la gestion des curseurs RethinkDB
- **[xcraft-core-etc]** : Utilise le système de configuration pour les paramètres avancés

## Configuration avancée

| Option      | Description                                                          | Type      | Valeur par défaut |
| ----------- | -------------------------------------------------------------------- | --------- | ----------------- |
| `useWorker` | Active l'utilisation de worker threads pour l'exécution des requêtes | `boolean` | `true`            |

### Variables d'environnement

| Variable   | Description                                        | Exemple       | Valeur par défaut |
| ---------- | -------------------------------------------------- | ------------- | ----------------- |
| `NODE_ENV` | Mode d'exécution pour le debugging des workers ETL | `development` | `production`      |

## Détails des sources

### `lib/service.js`

Le service principal **rethink** est l'interface centrale pour toutes les interactions avec RethinkDB. Il gère :

- **Connexions** : Pool de connexions avec reconnexion automatique
- **Requêtes** : Interface simplifiée pour les opérations CRUD et requêtes complexes
- **Index** : Création et gestion automatique des index
- **Change feeds** : Surveillance en temps réel des modifications
- **Worker pool** : Exécution parallèle des requêtes via Piscina
- **Métriques** : Collecte de statistiques de performance du cluster

#### État et modèle de données

L'état du service contient :

- `id` : Identifiant du service
- `cursors` : Map des curseurs actifs pour les change feeds

#### Méthodes publiques

- **`create(host, database, collectStats=true)`** — Initialise la connexion RethinkDB et configure le worker pool
- **`getConfiguration()`** — Retourne la configuration de connexion (host, port, db)
- **`selectDb(database)`** — Change la base de données active
- **`get(table, documentId, privateState)`** — Récupère un document par son ID avec option d'inclusion des données privées
- **`exist(table, documentId)`** — Vérifie l'existence d'un document
- **`set(table, documents)`** — Insère ou met à jour des documents avec gestion des conflits
- **`setIn(table, documentId, path, value)`** — Met à jour une valeur à un chemin spécifique
- **`del(table, documentId)`** — Supprime un document
- **`getAll(table, documents, status, filter, match, orderBy, sync, view, range)`** — Requête flexible avec filtres, tri et pagination
- **`getFirst(table, contentIndex, status, filter, match, sync)`** — Récupère le premier document correspondant aux critères
- **`count(table, contentIndex)`** — Compte les documents avec index optionnel
- **`getAllIds(table)`** — Récupère tous les IDs d'une table
- **`getIds(table, contentIndex, range)`** — Récupère les IDs avec index et pagination
- **`getOrderedCollectionIds(table, documentId, collectionTable, collection, orderBy, range)`** — Récupère les IDs d'une collection ordonnée liée à un document
- **`getOrderedCollectionCount(table, documentId, collectionTable, collection, orderBy)`** — Compte les éléments d'une collection ordonnée
- **`getView(table, documents, view)`** — Récupère une vue partielle de documents avec des champs spécifiques
- **`getIn(table, documentId, path)`** — Récupère une valeur à un chemin spécifique dans un document
- **`getAllById(table, documents, status)`** — Récupère tous les documents triés par ID avec filtrage par statut
- **`countBy(table, field, value)`** — Compte les documents correspondant à une valeur de champ
- **`joinAndMap(table, join, mapper)`** — Effectue une jointure et applique une fonction de mapping
- **`startQuestOnChanges(table, goblinId, documents, options, filter, includeInitial)`** — Démarre la surveillance des changements pour un acteur
- **`stopOnChanges(goblinId, table)`** — Arrête la surveillance des changements
- **`query(query, args)`** — Exécute une requête RethinkDB personnalisée sérialisée
- **`queryFirst(query, args)`** — Exécute une requête et retourne le premier résultat
- **`queryIds(query, args)`** — Exécute une requête et retourne seulement les IDs
- **`queryCount(query, args)`** — Exécute une requête et retourne le nombre de résultats
- **`copyTableFromDb(fromDb, table, status)`** — Copie une table depuis une autre base de données
- **`listTableFromDb(fromDb)`** — Liste les tables d'une base de données
- **`listDb()`** — Liste toutes les bases de données
- **`ensureTable(table)`** — Crée une table si elle n'existe pas
- **`ensureIndex(table)`** — Crée les index standards (status) pour une table
- **`ensureCustomIndexes(table, indexesFunc)`** — Crée des index personnalisés
- **`ensureOrderIndexes(table, orderedBy)`** — Crée des index pour le tri
- **`ensureCaseInsensitiveIndex(table, name, path)`** — Crée un index insensible à la casse
- **`ensureDatabase()`** — Crée la base de données et l'utilisateur de lecture
- **`resetDatabase()`** — Supprime et recrée la base de données
- **`collectStats(database)`** — Démarre la collecte de métriques de performance

### `lib/worker.js`

Worker dédié pour l'exécution parallèle des requêtes RethinkDB. Il utilise **Piscina** pour créer un pool de workers qui :

- Maintiennent leurs propres connexions RethinkDB
- Désérialisent et exécutent les requêtes
- Gèrent les curseurs et la conversion en tableaux
- Optimisent les performances pour les requêtes intensives
- Corrigent les bugs de validation des termes RethinkDB avec un patch de désérialisation

### `lib/rethink-query-view.js`

Acteur spécialisé dans la surveillance en temps réel d'une requête RethinkDB spécifique. Il :

- Établit une connexion directe à RethinkDB
- Exécute une requête personnalisée avec change feed
- Maintient un état synchronisé avec les changements de données
- Gère les événements d'ajout, modification et suppression

#### État et modèle de données

L'état contient une vue en temps réel des résultats de requête :

```javascript
{
  id: 'query-view-id',
  view: {
    'doc1': {id: 'doc1', ...},
    'doc2': {id: 'doc2', ...}
  }
}
```

#### Méthodes publiques

- **`create()`** — Initialise l'acteur de vue de requête
- **`start(query, queryArgs)`** — Démarre la surveillance d'une requête avec change feed
- **`initialize(initialState)`** — Initialise l'état avec les données initiales
- **`onChanges(changes)`** — Traite les événements de modification
- **`onAdd(changes)`** — Traite les événements d'ajout
- **`onRemove(changes)`** — Traite les événements de suppression

### `entities/rethinkJob.js`

Entité représentant un job d'extraction ETL avec les propriétés suivantes :

#### État et modèle de données

- **`name`** : Nom du job d'extraction (string)
- **`source`** : Code source JavaScript du job (string, template par défaut)
- **`lastRun`** : Date/heure de la dernière exécution (datetime)
- **`status`** : État du dernier run ('good' ou 'bad')
- **`lastRunStatus`** : Détails du statut (durée d'exécution, string)

La propriété `info` dans les summaries contient le nom du job pour l'indexation et la recherche.

#### Méthodes publiques

- **`updateLastRun(status)`** — Met à jour les informations de la dernière exécution avec durée et statut

### `rethinkJob-queue.js` et `rethinkJob-queue-worker.js`

Système de queue pour l'orchestration des jobs ETL :

- **Queue** : Écoute les événements `rethinkJob-run-requested` avec une taille de queue de 10
- **Worker** : Exécute les jobs en récupérant les paramètres depuis l'entité rethinkJob, configure l'environnement d'exécution et lance le job runner

### `rethinkJob-hinter.js`

Hinter spécialisé pour la recherche de jobs RethinkDB utilisant le builder générique avec :

- Type : `rethinkJob`
- Champ de recherche : `info`
- Interface de création de nouveaux jobs via `rethinkJob-workitem`

### `rethinkJob-search.js`

Interface de recherche pour les jobs RethinkDB utilisant `buildWorkitem` avec :

- Type de recherche : `rethinkJob`
- Widget de détail : `rethinkJob-workitem`
- Hinter intégré pour la validation et navigation

### `lib/etl/jobRunner.js`

Singleton responsable de l'exécution des jobs ETL dans des processus fork séparés :

- Gère le cycle de vie des processus workers
- Transmet les messages entre le processus principal et les workers
- Collecte les résultats et fichiers générés
- Gère les timeouts et la terminaison des jobs
- Supporte le debugging en mode développement

#### Méthodes publiques

- **`run({jobId, mandate, exportPath, src, print, printStatus, customPayload})`** — Exécute un job ETL dans un processus séparé
- **`kill(jobId)`** — Termine un job en cours d'exécution

### `lib/etl/jobWorker.js`

Processus worker qui exécute le code ETL dans un environnement isolé :

- Établit une connexion RethinkDB avec les credentials de lecture
- Crée un contexte VM sécurisé pour l'exécution du code utilisateur
- Fournit les fonctions `extract`, `transform`, `load` et les utilitaires de sortie
- Gère les outputs CSV et JSON via goblin-workshop
- Supporte les payloads personnalisés

### `entities/data/jobTemplate.js`

Template par défaut pour les nouveaux jobs ETL contenant :

- Structure de base avec fonctions `extract`, `transform`, `load`
- Documentation des objets disponibles (con, r, print, payload)
- Exemples d'utilisation des outputs CSV et JSON

### `widgets/rethink-query-editor/service.js`

Interface graphique pour l'édition et l'exécution de jobs ETL :

#### État et modèle de données

```javascript
{
  id: 'editor-id',
  jobId: 'rethinkJob@uuid',
  name: 'Job Name',
  source: 'JavaScript source code',
  isRunning: false,
  lines: ['output line 1', 'output line 2'],
  printStatus: '...150'
}
```

#### Méthodes publiques

- **`create(desktopId, rethinkJobId=null)`** — Initialise l'éditeur avec un job existant ou nouveau
- **`update(src)`** — Met à jour le code source en temps réel
- **`save(desktopId)`** — Sauvegarde le job dans la base de données
- **`run()`** — Exécute le job et affiche les résultats en temps réel

### `widgets/rethinkJob-workitem/service.js`

Workitem pour la gestion des jobs ETL avec bouton d'accès à l'éditeur Goblin Studio. Utilise le builder `buildWorkitem` de goblin-workshop pour créer une interface standard avec bouton personnalisé pour ouvrir l'éditeur de code.

#### Méthodes publiques

- **`editCode(desktopId)`** — Ouvre l'éditeur Goblin Studio pour le job courant

### `lib/hinter-builder.js`

Builder générique pour créer des hinters de recherche RethinkDB. Il génère des acteurs Goblin qui :

- Interfacent avec le système de workshop pour les hinters
- Exécutent des recherches avec expressions régulières sur RethinkDB
- Supportent les filtres et la navigation vers les détails
- Gèrent les payloads pour les données complexes
- Permettent la création de nouveaux workitems

#### Méthodes publiques

- **`create(desktopId, hinterName, workitemId, withDetails)`** — Crée un hinter pour un desktop
- **`setStatus(status)`** — Applique des filtres de statut
- **`search(value)`** — Effectue une recherche avec expression régulière

### `lib/builders.js`

Point d'entrée principal du module exposant :

- `buildHinter` : Builder pour créer des hinters de recherche RethinkDB

---

_Ce document a été mis à jour selon les sources du module._

[goblin-workshop]: https://github.com/Xcraft-Inc/goblin-workshop
[goblin-elasticsearch]: https://github.com/Xcraft-Inc/goblin-elasticsearch
[goblin-nabu]: https://github.com/Xcraft-Inc/goblin-nabu
[xcraft-core-goblin]: https://github.com/Xcraft-Inc/xcraft-core-goblin
[xcraft-core-shredder]: https://github.com/Xcraft-Inc/xcraft-core-shredder
[xcraft-core-utils]: https://github.com/Xcraft-Inc/xcraft-core-utils
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc