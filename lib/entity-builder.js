'use strict';

const Goblin = require ('xcraft-core-goblin');
const xUtils = require ('xcraft-core-utils');
const entityMeta = require ('./entity-meta');
const BigNumber = require ('bignumber.js');
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
      const ref = references[path];
      //FIXME: use regexp
      if (ref.endsWith ('[]')) {
        for (const rId of entity[path]) {
          const peer = yield quest.warehouse.get ({path: rId});
          if (!peers[peer.meta.table]) {
            peers[peer.meta.table] = [];
          }
          peers[peer.meta.table].push (peer);
        }
      } else {
        //Entity case
        const rId = entity[path];
        if (rId) {
          const peer = yield quest.warehouse.get ({path: rId});
          peers[peer.meta.type] = peer;
        }
      }
    }
  }

  return peers;
};

module.exports = config => {
  const {
    name,
    type,
    table,
    references,
    actions,
    quests,
    onNew,
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
    updateMetaDataInfo: state => {
      if (!buildInfo) {
        return state;
      }
      return state.set ('meta.info', buildInfo (state.toJS ()));
    },
    backup: (state, action) => {
      return state.set ('private.backup', action.get ('entity'));
    },
    compute: (state, action) => {
      const sums = action.get ('sums');
      let stateSums = {};
      Object.keys (sums).forEach (sum => {
        stateSums[sum] = sums[sum].toString ();
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

      //FIXME: use regexp
      if (ref.endsWith ('[]')) {
        const type = ref.split ('[')[0];

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
        refQuests[`set-${ref}`] = function (quest, entityId) {
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
    status,
    $msg,
    next
  ) {
    const i = quest.openInventory ();
    quest.goblin.setX ('refSubs', {});
    let entity = null;
    let isNew = false;
    let initialStatus = status || 'draft';
    const r = i.useAny ('rethink');

    entity = yield r.get ({table, documentId: id});

    if (entity) {
      //ENSURE REFS PATH EXIST FOR type[]
      if (references) {
        for (const path in references) {
          const ref = references[path];
          if (ref.endsWith ('[]')) {
            if (!entity[path]) {
              entity[path] = [];
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
      entityMeta.set (
        entity,
        type,
        table,
        references,
        initialStatus,
        buildInfo
      );
    }

    if (!entity) {
      isNew = true;
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
      } finally {
        //set meta
        entityMeta.set (
          entity,
          type,
          table,
          references,
          initialStatus,
          buildInfo
        );
        r.set ({
          table,
          documents: entity,
        });
        quest.evt ('persited');
      }
    }

    quest.do ({entity});

    if (entity.meta.version > 0) {
      quest.dispatch ('backup', {entity});
    }

    if (entity.meta.status !== 'archived') {
      //SUBSCRIBE TO REF CHANGES
      if (references && (indexer || computer)) {
        const refSubs = {};
        for (const path in references) {
          const ref = references[path];
          //FIXME: use regexp
          if (ref.endsWith ('[]')) {
            for (const rId of entity[path]) {
              if (!refSubs[rId]) {
                refSubs[rId] = [];
              }

              //RE-INDEX
              if (indexer) {
                refSubs[rId].push (
                  quest.sub (`${rId}.changed`, quest.me.index)
                );
              }

              //RE-COMPUTE
              if (computer) {
                refSubs[rId].push (
                  quest.sub (`${rId}.changed`, quest.me.compute)
                );
              }
            }
          } else {
            //Entity case
            const rId = entity[path];
            if (!refSubs[rId]) {
              refSubs[rId] = [];
            }
            //RE-INDEX
            if (indexer) {
              refSubs[rId].push (quest.sub (`${rId}.changed`, quest.me.index));
            }

            //RE-COMPUTE
            if (computer) {
              refSubs[rId].push (
                quest.sub (`${rId}.changed`, quest.me.compute)
              );
            }
          }
        }
        quest.goblin.setX ('refSubs', refSubs);
      }
      //LOAD REFERENCES IF NEEDED
      if (!isNew) {
        if (references) {
          for (const path in references) {
            const ref = references[path];
            //FIXME: use regexp
            if (ref.endsWith ('[]')) {
              for (const rId of entity[path]) {
                if (!quest.canUse (rId) && rId !== loadedBy) {
                  yield quest.create (rId, {
                    id: rId,
                    loadedBy: quest.goblin.id,
                  });
                }
              }
            } else {
              //Entity case
              const rId = entity[path];
              if (rId && !quest.canUse (rId) && rId !== loadedBy) {
                yield quest.create (rId, {
                  id: rId,
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
      if (computer) {
        yield quest.me.compute ();
      }
      if (indexer) {
        quest.me.index ();
      }
      quest.me.persist ();
    }

    /*r.startQuestOnChanges ({
          table,
          onChangeQuest: `${goblinName}.reload`,
          goblinId: quest.goblin.id,
          filter: {id: entityId},
        });*/
    return quest.goblin.id;
  });

  Goblin.registerQuest (goblinName, 'change', function* (
    quest,
    path,
    newValue
  ) {
    quest.do ();
    quest.evt ('changed');
    if (computer) {
      yield quest.me.compute ();
    }
    if (indexer) {
      quest.me.index ();
    }
    quest.me.persist ();
  });

  Goblin.registerQuest (goblinName, 'apply', function* (quest, patch) {
    quest.do ();
    quest.evt ('changed');
    if (computer) {
      yield quest.me.compute ();
    }
    if (indexer) {
      quest.me.index ();
    }
    quest.me.persist ();
  });

  Goblin.registerQuest (goblinName, 'preview', function (quest, patch) {
    quest.do ();
  });

  Goblin.registerQuest (goblinName, 'get', function (quest) {
    return quest.goblin.getState ().toJS ();
  });

  Goblin.registerQuest (goblinName, 'add-ref', function* (
    quest,
    path,
    entityId
  ) {
    quest.do ();
    const refSubs = quest.goblin.getX ('refSubs');

    if (!refSubs[entityId]) {
      refSubs[entityId] = [];
    }
    if (indexer) {
      refSubs[entityId].push (
        quest.sub (`${entityId}.changed`, quest.me.index)
      );
    }

    if (computer) {
      refSubs[entityId].push (
        quest.sub (`${entityId}.changed`, quest.me.compute)
      );
    }

    quest.goblin.setX ('refSubs', refSubs);
    quest.evt ('ref-added');
    if (computer) {
      yield quest.me.compute ();
    }
    if (indexer) {
      quest.me.index ();
    }
    quest.evt ('changed');
    quest.me.persist ();
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
    entityId
  ) {
    const refSubs = quest.goblin.getX ('refSubs');
    for (const unsub of refSubs[entityId]) {
      unsub ();
    }
    delete refSubs[entityId];
    quest.goblin.setX ('refSubs', refSubs);

    quest.do ();
    quest.evt ('ref-removed');
    if (computer) {
      yield quest.me.compute ();
    }
    if (indexer) {
      quest.me.index ();
    }
    quest.evt ('changed');
    quest.me.persist ();
  });

  Goblin.registerQuest (goblinName, 'set-ref', function* (
    quest,
    path,
    entityId
  ) {
    const refSubs = quest.goblin.getX ('refSubs');

    if (!refSubs[entityId]) {
      refSubs[entityId] = [];
    }
    if (indexer) {
      refSubs[entityId].push (
        quest.sub (`${entityId}.changed`, quest.me.index)
      );
    }

    if (computer) {
      refSubs[entityId].push (
        quest.sub (`${entityId}.changed`, quest.me.compute)
      );
    }

    quest.goblin.setX ('refSubs', refSubs);
    quest.do ();
    quest.evt ('ref-setted');
    if (computer) {
      yield quest.me.compute ();
    }
    if (indexer) {
      quest.me.index ();
    }
    quest.evt ('changed');
    quest.me.persist ();
  });

  Goblin.registerQuest (goblinName, 'persist', function* (quest) {
    const i = quest.openInventory ();
    quest.dispatch ('updateMetaDataInfo');
    let entity = quest.goblin.getState ().toJS ();
    //remove local state keys
    delete entity.private;

    const r = i.useAny ('rethink');
    yield r.set ({
      table,
      documents: entity,
    });

    quest.evt ('persisted');
    quest.log.info (`${entity.id} persisted`);
  });

  if (indexer) {
    Goblin.registerQuest (goblinName, 'index', function* (quest, entity, next) {
      if (!entity) {
        entity = quest.goblin.getState ().toJS ();
      }
      const i = quest.openInventory ();
      const e = i.useAny ('elastic');
      let doc = {};
      if (isGenerator (indexer)) {
        doc = yield* indexer (quest, entity, next);
      } else {
        doc = indexer (quest, entity);
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

  if (computer) {
    Goblin.registerQuest (goblinName, 'compute', function* (
      quest,
      entity,
      next
    ) {
      if (!entity) {
        entity = quest.goblin.getState ().toJS ();
      }

      let sums = {base: new BigNumber (0)};

      const peers = yield* buildPeers (quest, entity);
      Object.keys (peers)
        .filter (table => Array.isArray (peers[table]))
        .forEach (table => {
          const subSums = peers[table];
          Object.keys (sums).forEach (sum => {
            sums[sum] = sums[sum].plus (
              subSums.reduce ((p, c) => {
                return p.plus (c.sums[sum]);
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
      quest.evt ('changed');
      quest.evt ('computed');
      quest.me.persist ();
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
          table,
          documents: history,
        });
      }
      quest.do ();
      quest.me.persist ();
    });
  }

  Goblin.registerQuest (goblinName, 'delete', function* (quest, hard) {
    const subs = quest.goblin.getX ('refSubs');
    Object.keys (subs).forEach (s => {
      for (const unsub of subs[s]) {
        unsub ();
      }
    });

    if (hard) {
      const i = quest.openInventory ();
      const r = i.useAny ('rethink');
      yield r.del ({table, documentId: quest.goblin.id});
      if (indexer) {
        const e = i.useAny ('elastic');
        const index = {
          documentId: quest.goblin.id,
        };
        e.unindex (index);
      }
    }
  });

  // Create a Goblin with initial state and handlers
  return Goblin.configure (goblinName, logicState, logicHandlers);
};
