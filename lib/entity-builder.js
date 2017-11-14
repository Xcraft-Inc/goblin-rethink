'use strict';
const _ = require ('lodash');
const Goblin = require ('xcraft-core-goblin');
const xUtils = require ('xcraft-core-utils');
const entityMeta = require ('./entity-meta');
const common = require ('./workitems/common.js');
const BigNumber = require ('bignumber.js');
const MarkdownBuilder = require ('./markdownBuilder.js');

function isFunction (fn) {
  return typeof fn === 'function';
}

function isGenerator (fn) {
  return (
    fn &&
    isFunction (fn) &&
    fn.constructor &&
    fn.constructor.name === 'GeneratorFunction'
  );
}

const registerActions = (goblinName, actions) => {
  if (actions) {
    Object.keys (actions).forEach (a => {
      Goblin.registerQuest (goblinName, a, function (quest) {
        quest.do ();
      });
    });
  }
};

const registerQuests = (goblinName, quests) => {
  if (quests) {
    Object.keys (quests).forEach (q => {
      Goblin.registerQuest (goblinName, q, quests[q]);
    });
  }
};

// Build peers entity collections from references
// contacts: { contact@1: {entity}, contact@2: {entity}}
// products: { product@1: {entity}, product@3: {entity}}
// ...
const buildPeers = function* (quest, entity) {
  const peers = {};
  const references = entity.meta.references;
  if (references) {
    for (const path in references) {
      yield* fetchPeers (quest, peers, entity, references, path);
    }
  }

  return peers;
};

const fetchPeers = function* (quest, peers, entity, references, path) {
  const ref = references[path];
  const type = common.getReferenceType (ref);
  if (common.referenceUseArity (ref)) {
    if (!peers[type]) {
      peers[type] = [];
    }
    for (const rId of entity[path]) {
      const peer = yield quest.me.getEntity ({entityId: rId});
      peers[type].push (peer);
    }
  } else {
    //Entity case
    const rId = entity[path];
    if (rId) {
      const peer = yield quest.me.getEntity ({entityId: rId});
      peers[type] = peer;
    } else {
      peers[type] = null;
    }
  }
};

module.exports = config => {
  const {
    name,
    type,
    parentReference,
    references,
    actions,
    quests,
    onNew,
    afterNew,
    descriptor,
    indexer,
    computer,
    buildInfo,
    enableHistory,
  } = config;

  let goblinName = type;

  if (name) {
    goblinName = name;
  }

  const getHistory = quest => {
    return quest.goblin.getState ().toJS ();
  };

  // Define initial logic values
  const logicState = {};

  // Define logic handlers according rc.json
  const logicHandlers = {
    create: (state, action) => {
      return state.set ('', action.get ('entity'));
    },
    change: (state, action) => {
      return state.set (action.get ('path'), action.get ('newValue'));
    },
    apply: (state, action) => {
      return state.merge ('', action.get ('patch'));
    },
    preview: (state, action) => {
      return state.merge ('', action.get ('patch'));
    },
    'set-ref': (state, action) => {
      return state.set (action.get ('path'), action.get ('entityId'));
    },
    'add-ref': (state, action) => {
      return state.push (action.get ('path'), action.get ('entityId'));
    },
    'move-ref': (state, action) => {
      return state.move (
        action.get ('path'),
        action.get ('entityId'),
        action.get ('afterEntityId')
      );
    },
    'remove-ref': (state, action) => {
      return state.unpush (action.get ('path'), action.get ('entityId'));
    },
    backup: (state, action) => {
      return state.set ('private.backup', action.get ('entity'));
    },
    inform: (state, action) => {
      const info = action.get ('info');
      return state.set ('meta.info', info);
    },
    describe: (state, action) => {
      const desc = action.get ('description');
      return state.set ('meta.description', desc);
    },
    compute: (state, action) => {
      const sums = action.get ('sums');
      let stateSums = {};
      Object.keys (sums).forEach (sum => {
        if (!isFunction (sums[sum])) {
          stateSums[sum] = sums[sum].toString ();
        }
      });
      return state.set ('sums', stateSums);
    },
    version: (state, action) => {
      let version = state.get ('meta.version');
      version++;
      return state
        .set ('meta.createdAt', new Date ().getTime ())
        .set ('meta.version', version);
    },
    'load-version': (state, action) => {
      const backup = state.get ('private.backup', null);
      state = state.del ('versions');
      if (backup) {
        state = state.merge ('', action.get ('version'));
        state = state.set ('private.backup', backup.toJS ());
        return state;
      } else {
        return state.set ('', action.get ('version'));
      }
    },
  };

  if (references) {
    const refQuests = {};
    for (const path in references) {
      const ref = references[path];

      if (common.referenceUseArity (ref)) {
        const type = common.getReferenceType (ref);

        refQuests[`add-${type}`] = function (quest, entityId) {
          quest.me.addRef ({path, entityId});
        };

        refQuests[`remove-${type}`] = function (quest, entityId) {
          quest.me.removeRef ({path, entityId});
        };

        refQuests[`move-${type}`] = function (
          quest,
          id,
          entityId,
          afterEntityId
        ) {
          quest.me.moveRef ({path, entityId, afterEntityId});
        };
      } else {
        //Entity case
        refQuests[`set-${path}`] = function (quest, entityId) {
          quest.me.setRef ({path, entityId});
        };
      }
    }
    registerQuests (goblinName, refQuests);
  }

  if (actions) {
    Object.assign (logicHandlers, actions);
    registerActions (goblinName, actions);
  }

  if (quests) {
    registerQuests (goblinName, quests);
  }

  Goblin.registerQuest (goblinName, 'create', function* (
    quest,
    id,
    desktopId,
    loadedBy,
    withoutReference,
    status,
    $msg,
    next
  ) {
    if (!desktopId) {
      throw new Error (
        `Entity ${id} cannot be used outside of a desktop, please provide a desktopId`
      );
    }
    const i = quest.openInventory ();
    quest.goblin.setX ('refSubs', {});
    quest.goblin.setX ('desktopId', desktopId);
    quest.goblin.setX ('loadedBy', loadedBy);
    let entity = null;
    let isNew = false;
    let initialStatus = status || 'draft';
    const r = i.useAny ('rethink');

    entity = yield r.get ({table: type, documentId: id});

    const withRef = !!references && !withoutReference;

    if (entity) {
      console.log ('Loading entity ', entity.id, 'with references? ', withRef);
      //ENSURE REFS PATH EXIST FOR type[]
      if (withRef) {
        for (const path in references) {
          const ref = references[path];
          if (common.referenceUseArity (ref)) {
            if (!entity[path]) {
              entity[path] = [];
            }
          } else {
            if (!entity[path]) {
              entity[path] = null;
            }
          }
        }
      }

      if (computer) {
        if (!entity.sums) {
          entity.sums = {};
          entity.sums.base = 0;
        }
      }
      entityMeta.set (entity, type, references, initialStatus);
    }

    if (!entity) {
      isNew = true;
      console.log ('creating ', id);
      try {
        if (onNew) {
          // We support the same goblin quest feature:
          // auto parameter->value mapping

          const params = xUtils.reflect
            .funcParams (onNew)
            .filter (param => !/^(quest|next)$/.test (param));

          const _onNew = (q, m, n) => {
            const args = params.map (p => {
              return m.get (p);
            });

            /* Pass the whole Xcraft message if asked by the quest. */
            if (!m.get ('$msg')) {
              const idx = params.indexOf ('$msg');
              if (idx > -1) {
                args[idx] = m;
              }
            }

            args.unshift (q);
            if (n) {
              args.push (n);
            }

            return onNew (...args);
          };

          if (isGenerator (onNew)) {
            entity = yield* _onNew (quest, $msg, next);
          } else {
            entity = _onNew (quest, $msg);
          }
        }
      } catch (err) {
        throw new Error (err);
      } finally {
        //set meta
        entityMeta.set (entity, type, references, initialStatus);
        r.set ({
          table: type,
          documents: entity,
        });
        quest.evt ('persited');
      }
    }

    quest.do ({entity});

    //MAKE VERSION BACKUP
    if (entity.meta.version > 0) {
      quest.dispatch ('backup', {entity});
    }

    if (entity.meta.status !== 'archived') {
      //SUBSCRIBE TO REF CHANGES
      if (withRef && (indexer || computer)) {
        const refSubs = {};
        for (const path in references) {
          const ref = references[path];
          if (entity[path] === undefined) {
            throw new Error (
              `Your reference ${path} not match with your ${entity.meta.type} entity props`
            );
          }
          //FIXME: use regexp
          if (common.referenceUseArity (ref)) {
            for (const rId of entity[path]) {
              if (!refSubs[rId]) {
                refSubs[rId] = [];
              }
              //RE-HYDRATE
              const hydrator = _.debounce (quest.me.hydrate, 50);
              refSubs[rId].push (quest.sub (`${rId}.changed`, hydrator));
            }
          } else {
            //Entity case
            const rId = entity[path];
            if (!refSubs[rId]) {
              refSubs[rId] = [];
            }

            //RE-HYDRATE
            const hydrator = _.debounce (quest.me.hydrate, 50);
            refSubs[rId].push (quest.sub (`${rId}.changed`, hydrator));
          }
        }
        quest.goblin.setX ('refSubs', refSubs);
      }
      //LOAD REFERENCES IF NEEDED
      if (!isNew) {
        if (parentReference) {
          const rId = entity[parentReference];
          const useKey = `${rId}@${desktopId}`;
          if (rId && rId !== loadedBy) {
            console.log (loadedBy, ' loading parent ref', rId);
            quest.create (useKey, {
              id: rId,
              desktopId,
              withoutReference: true,
            });
          }
        }

        if (withRef) {
          for (const path in references) {
            const ref = references[path];

            if (common.referenceUseArity (ref)) {
              //Theses references are loaded independently by plugins via the
              //workitem
              /*for (const rId of entity[path]) {
                const useKey = `${rId}@${desktopId}`;
                if (rId && rId !== loadedBy) {
                  console.log (loadedBy, ' loading ref', rId);
                  quest.create (useKey, {
                    id: rId,
                    desktopId,
                    loadedBy: quest.goblin.id,
                  });
                }
              }*/
            } else {
              //Entity case
              const rId = entity[path];
              const useKey = `${rId}@${desktopId}`;
              if (rId && rId !== loadedBy) {
                console.log (loadedBy, ' loading ref', rId);
                quest.create (useKey, {
                  id: rId,
                  desktopId,
                  loadedBy: quest.goblin.id,
                });
              }
            }
          }
          quest.evt ('ref-loaded');
        }
      }
    }

    if (isNew) {
      yield quest.me.hydrate ();
      quest.me.persist ();
      if (afterNew) {
        yield quest.me.afterNew ({entity});
      }
    }

    r.startQuestOnChanges ({
      table: type,
      onChangeQuest: `${goblinName}.handle-changes`,
      goblinId: quest.goblin.id,
      filter: {id: entity.id},
    });

    return quest.goblin.id;
  });

  Goblin.registerQuest (goblinName, 'get-entity', common.getEntityQuest);

  Goblin.registerQuest (goblinName, 'hydrate', function* (quest) {
    console.log ('hydrating:', quest.goblin.id);
    let entity = quest.goblin.getState ().toJS ();
    if (buildInfo) {
      yield quest.me.inform ({entity});
      entity = quest.goblin.getState ().toJS ();
    }

    console.log ('Info:', entity.meta.info);

    quest.dispatch ('set');
    if (descriptor) {
      yield quest.me.describe ({entity});
      entity = quest.goblin.getState ().toJS ();
      console.log ('Describe done: ', entity.meta.description);
    }
    if (computer) {
      yield quest.me.compute ({entity});
      entity = quest.goblin.getState ().toJS ();
      console.log ('Compute done: ', entity.sums);
    }
    if (indexer) {
      quest.me.index ({entity});
      console.log ('Index done');
    }
    console.log ('hydrated!');
    quest.evt ('changed');
    quest.evt ('hydrated');
  });

  Goblin.registerQuest (goblinName, 'handle-changes', function* (
    quest,
    change
  ) {
    if (change.type === 'change') {
      const entity = change.new_val;
      // Prevent echo using desktopId
      if (
        entity.meta.persistedFromDesktopId === quest.goblin.getX ('desktopId')
      ) {
        return; // nothing to patch...
      }

      //Compare state
      const newState = new Goblin.Shredder (entity);
      const current = quest.goblin.getState ().del ('private');
      if (current.equals (newState)) {
        return; // nothing to patch...
      }

      //Retreive and backup references props before remove from patch
      const props = Object.keys (entity);
      let referencesProps = [];
      if (references) {
        referencesProps = Object.keys (references);
      }
      const refToPatch = referencesProps.filter (p => props.indexOf (p) > 0);
      const newRefState = {};
      for (const path of refToPatch) {
        newRefState[path] = entity[path];
        delete entity[path];
      }

      // Make a preview patch (not persistance is needed)
      yield quest.me.preview ({patch: entity});

      if (!references) {
        return;
      }
      //For each ref, check if we add/remove something, and notify living plugins of changes
      if (refToPatch.length > 0) {
        for (const path of refToPatch) {
          const currentRefs = current.get (path);
          if (common.referenceUseArity (references[path])) {
            const refType = common.getReferenceType (references[path]);
            const current = currentRefs.toArray ();
            const toRemove = current.filter (
              r => newRefState[path].indexOf (r) < 0
            );
            const toAdd = newRefState[path].filter (
              r => current.indexOf (r) < 0
            );
            for (const rId of toAdd) {
              quest.evt ('remote-ref-added', {
                entityId: rId,
                type: refType,
              });
            }
            for (const rId of toRemove) {
              quest.evt ('remote-ref-removed', {
                entityId: rId,
                type: refType,
              });
            }
          } else {
            quest.evt ('remote-ref-setted', {
              entityId: newRefState[path],
              type: references[path],
            });
          }
        }
      }
    }
  });

  Goblin.registerQuest (goblinName, 'change', function* (
    quest,
    path,
    newValue
  ) {
    quest.do ();

    quest.evt ('changed');

    yield quest.me.hydrate ();

    quest.me.persist ();
  });

  Goblin.registerQuest (goblinName, 'apply', function* (quest, patch) {
    quest.do ();

    quest.evt ('changed');

    yield quest.me.hydrate ();

    quest.me.persist ();
  });

  Goblin.registerQuest (goblinName, 'preview', function (quest, patch) {
    quest.do ();
  });

  Goblin.registerQuest (goblinName, 'get', function (quest) {
    let state = quest.goblin.getState ().toJS ();
    if (!state) {
      return null;
    }
    if (!state.meta) {
      return null;
    }
    return state;
  });

  Goblin.registerQuest (goblinName, 'add-ref', function* (
    quest,
    path,
    entityId,
    remote
  ) {
    quest.do ();
    const refSubs = quest.goblin.getX ('refSubs');

    if (!refSubs[entityId]) {
      refSubs[entityId] = [];
    }

    /*const useKey = `${entityId}@${desktopId}`;
    if (!quest.canUse (useKey) && entityId !== loadedBy) {
      yield quest.create (useKey, {
        id: entityId,
        desktopId,
        loadedBy: quest.goblin.id,
      });
    }*/

    refSubs[entityId].push (
      quest.sub (`${entityId}.changed`, quest.me.hydrate)
    );

    quest.goblin.setX ('refSubs', refSubs);
    quest.evt ('ref-added', {entityId});

    yield quest.me.hydrate ();

    quest.evt ('changed');
    if (!remote) {
      quest.me.persist ();
    }
  });

  Goblin.registerQuest (goblinName, 'move-ref', function (
    quest,
    path,
    entityId,
    afterEntityId
  ) {
    quest.do ();
    quest.evt ('ref-moved');
    quest.evt ('changed');
    quest.me.persist ();
  });

  Goblin.registerQuest (goblinName, 'remove-ref', function* (
    quest,
    path,
    entityId,
    remote
  ) {
    const refSubs = quest.goblin.getX ('refSubs');
    if (refSubs[entityId]) {
      for (const unsub of refSubs[entityId]) {
        unsub ();
      }
      delete refSubs[entityId];
      quest.goblin.setX ('refSubs', refSubs);
    }

    quest.do ();
    quest.evt ('ref-removed', {entityId});

    yield quest.me.hydrate ();

    quest.evt ('changed');
    if (!remote) {
      quest.me.persist ();
    }
  });

  Goblin.registerQuest (goblinName, 'set-ref', function* (
    quest,
    path,
    entityId,
    remote
  ) {
    const refSubs = quest.goblin.getX ('refSubs');
    const desktopId = quest.goblin.getX ('desktopId');
    const loadedBy = quest.goblin.getX ('loadedBy');

    const useKey = `${entityId}@${desktopId}`;
    if (!quest.canUse (useKey) && entityId !== loadedBy) {
      yield quest.create (useKey, {
        id: entityId,
        desktopId,
        loadedBy: quest.goblin.id,
      });
    }

    if (!refSubs[entityId]) {
      refSubs[entityId] = [];
    }

    refSubs[entityId].push (
      quest.sub (`${entityId}.changed`, quest.me.hydrate)
    );

    quest.goblin.setX ('refSubs', refSubs);
    quest.do ();
    quest.evt ('ref-setted');

    yield quest.me.hydrate ();

    quest.evt ('changed');
    if (!remote) {
      quest.me.persist ();
    }
  });

  Goblin.registerQuest (goblinName, 'persist', function* (quest) {
    const i = quest.openInventory ();
    let entity = quest.goblin.getState ().toJS ();
    //remove local state keys
    delete entity.private;
    entity.meta.persistedFromDesktopId = quest.goblin.getX ('desktopId');
    const r = i.useAny ('rethink');
    yield r.set ({
      table: type,
      documents: entity,
    });

    quest.evt ('persisted');
    quest.log.info (`${entity.id} persisted`);
  });

  if (buildInfo) {
    Goblin.registerQuest (goblinName, 'inform', function* (quest, entity) {
      let peers = {};
      if (references) {
        peers = yield* buildPeers (quest, entity);
      }
      let info = entity.meta.info;
      info = buildInfo (entity, peers, new MarkdownBuilder ());
      if (info === undefined) {
        throw new Error (
          'Bad info builder for ',
          type,
          ' entity with id ',
          quest.goblin.id,
          ' check buildInfo return!'
        );
      }
      quest.do ({info});
      quest.evt ('informed');
    });
  }

  if (descriptor) {
    Goblin.registerQuest (goblinName, 'describe', function* (
      quest,
      entity,
      next
    ) {
      let peers = {};
      if (references) {
        peers = yield* buildPeers (quest, entity);
      }
      let desc = entity.meta.description;
      if (isGenerator (descriptor)) {
        desc = yield* descriptor (
          quest,
          entity,
          peers,
          new MarkdownBuilder (),
          next
        );
      } else {
        desc = descriptor (quest, entity, peers, new MarkdownBuilder ());
      }
      if (desc === undefined) {
        throw new Error (
          'Bad descritor for ',
          type,
          ' entity with id ',
          quest.goblin.id,
          ' check descriptor!'
        );
      }
      quest.do ({description: desc});
      quest.evt ('described');
    });
  }

  if (afterNew) {
    Goblin.registerQuest (goblinName, 'after-new', function* (
      quest,
      entity,
      next
    ) {
      if (!entity) {
        entity = quest.goblin.getState ().toJS ();
      }
      const desktopId = quest.goblin.getX ('desktopId');
      if (isGenerator (afterNew)) {
        yield* afterNew (quest, desktopId, entity, next);
      } else {
        afterNew (quest, desktopId, entity);
      }
    });
  }

  if (indexer) {
    Goblin.registerQuest (goblinName, 'index', function* (quest, entity, next) {
      if (!entity) {
        entity = quest.goblin.getState ().toJS ();
      }

      let peers = {};
      if (references) {
        peers = yield* buildPeers (quest, entity);
      }

      const desktopId = quest.goblin.getX ('desktopId');
      const i = quest.openInventory ();
      const e = i.use (`elastic@${desktopId}`);
      let doc = {};
      if (isGenerator (indexer)) {
        doc = yield* indexer (
          quest,
          entity,
          peers,
          new MarkdownBuilder (),
          next
        );
      } else {
        doc = indexer (quest, entity, peers, new MarkdownBuilder ());
      }
      const index = {
        documentId: entity.id,
        type: type,
        document: doc,
      };
      e.index (index);
      quest.evt ('indexed');
    });
  }
  if (references) {
    Object.keys (references).forEach (path => {
      Goblin.registerQuest (goblinName, `fetch-${path}`, function* (quest) {
        const peers = {};
        const entity = quest.goblin.getState ().toJS ();
        yield* fetchPeers (quest, peers, entity, references, path);
        return peers[Object.keys (peers)[0]];
      });
    });
  }

  if (computer) {
    Goblin.registerQuest (goblinName, 'compute', function* (
      quest,
      entity,
      next
    ) {
      if (!entity) {
        entity = quest.goblin.getState ().toJS ();
      }

      let sums = {base: new BigNumber (0), cost: new BigNumber (0)};

      const peers = yield* buildPeers (quest, entity);
      Object.keys (peers)
        .filter (type => Array.isArray (peers[type]))
        .forEach (type => {
          const subSums = peers[type];
          Object.keys (sums).forEach (sum => {
            if (!sums[sum]) {
              sums[sum] = new BigNumber (0);
            }
            sums[sum] = sums[sum].plus (
              subSums.reduce ((p, c) => {
                if (c.sums) {
                  if (!c.sums[sum]) {
                    c.sums[sum] = new BigNumber (0);
                  }
                  return p.plus (c.sums[sum]);
                } else {
                  return p;
                }
              }, new BigNumber (0))
            );
          });
        });

      //Inject bignumber as N for computer
      sums.N = BigNumber;
      if (isGenerator (computer)) {
        sums = yield* computer (quest, sums, entity, peers, next);
      } else {
        sums = computer (quest, sums, entity, peers);
      }
      quest.do ({sums});
      quest.evt ('computed');
    });
  }

  if (enableHistory) {
    Goblin.registerQuest (goblinName, 'get-version', function (quest) {
      const state = quest.goblin.getState ();
      const v = state.get ('meta.version');
      const c = state.get ('meta.createdAt');
      return `v${v} du ${new Date (c).toLocaleString ()}`;
    });

    Goblin.registerQuest (goblinName, 'version', function (quest) {
      const i = quest.openInventory ();
      const r = i.useAny ('rethink');
      let history = quest.goblin.getState ().get ('private.backup', null);
      if (history) {
        const current = quest.goblin.getState ().del ('private');
        if (current.equals (history)) {
          return;
        }
        history = history.toJS ();
        const timeStamp = history.meta.createdAt;
        const historyId = `${history.id}-${timeStamp}`;
        history.id = historyId;
        //archived
        history.meta.status = 'archived';
        delete history.private;

        r.set ({
          table: type,
          documents: history,
        });
      }
      quest.do ();
      quest.me.persist ();
    });
  }

  Goblin.registerQuest (goblinName, 'unsub-references', function (quest) {
    const subs = quest.goblin.getX ('refSubs');
    Object.keys (subs).forEach (s => {
      for (const unsub of subs[s]) {
        unsub ();
      }
    });
    quest.goblin.setX ('refSubs', {});
  });

  Goblin.registerQuest (goblinName, 'delete', function* (quest, hard) {
    yield quest.me.unsubReferences ();
    const i = quest.openInventory ();
    const r = i.useAny ('rethink');
    yield r.stopOnChanges ({goblinId: quest.goblin.Id});

    if (hard) {
      yield r.del ({table: type, documentId: quest.goblin.id});
      if (indexer) {
        const e = i.useAny ('elastic');
        const index = {
          documentId: quest.goblin.id,
          type,
        };
        e.unindex (index);
      }
    }
  });

  // Create a Goblin with initial state and handlers
  return Goblin.configure (goblinName, logicState, logicHandlers);
};
