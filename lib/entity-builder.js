'use strict';

const Goblin = require ('xcraft-core-goblin');
const xUtils = require ('xcraft-core-utils');

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

module.exports = config => {
  const {name, type, table, references, actions, quests, onNew} = config;

  let goblinName = type;

  if (name) {
    goblinName = name;
  }

  // Define initial logic values
  const logicState = {};

  // Define logic handlers according rc.json
  const logicHandlers = {
    create: (state, action) => {
      return state.set ('', action.get ('entity'));
    },
    'set-ref': (state, action) => {
      return state.set (action.get ('path'), action.get ('entityId'));
    },
    'add-ref': (state, action) => {
      return state.push (action.get ('path'), action.get ('entityId'));
    },
    'remove-ref': (state, action) => {
      return state.unpush (action.get ('path'), action.get ('entityId'));
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

        //TODO:
        /*refQuests[`move-${type}`] = function (quest, id, insertAfterId) {
          quest.me.moveRef ({path, ref: id, insertAfterId});
        };*/
      } else {
        //Entity case
        refQuests[`set-${type}`] = function (quest, entityId) {
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

  Goblin.registerQuest (goblinName, 'create', function* (quest, id, $msg) {
    const i = quest.openInventory ();
    const r = i.useAny ('rethink');
    let entity = yield r.get ({table, documentId: id});
    if (!entity) {
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
            entity = yield* _onNew (quest, $msg);
          } else {
            entity = _onNew (quest, $msg);
          }
        }
      } finally {
        r.set ({
          table,
          documents: entity,
        });
      }
    }

    quest.do ({entity});
    //LOAD REFERENCES IF NEEDED
    if (quest.countRef (entity.id) === 0) {
      if (references) {
        for (const path in references) {
          const ref = references[path];
          //FIXME: use regexp
          if (ref.endsWith ('[]')) {
            const type = ref.split ('[')[0];
            for (const rId of entity[path]) {
              if (!quest.canUse (rId)) {
                yield quest.create (type, {id: rId});
              }
            }
          } else {
            //Entity case
            const rId = entity[path];
            if (rId && !quest.canUse (rId)) {
              yield quest.create (type, {id: rId});
            }
          }
        }
      }
    }

    /*r.startQuestOnChanges ({
          table,
          onChangeQuest: `${goblinName}.reload`,
          goblinId: quest.goblin.id,
          filter: {id: entityId},
        });*/
    return quest.goblin.id;
  });

  Goblin.registerQuest (goblinName, 'get', function (quest) {
    return quest.goblin.getState ().toJS ();
  });

  Goblin.registerQuest (goblinName, 'add-ref', function (
    quest,
    path,
    entityId
  ) {
    quest.do ();
    const entity = quest.goblin.getState ().toJS ();
    const i = quest.openInventory ();
    const r = i.useAny ('rethink');
    r.set ({
      table,
      documents: entity,
    });
  });

  Goblin.registerQuest (goblinName, 'remove-ref', function (
    quest,
    path,
    entityId
  ) {
    quest.do ();
    const entity = quest.goblin.getState ().toJS ();
    const i = quest.openInventory ();
    const r = i.useAny ('rethink');
    r.set ({
      table,
      documents: entity,
    });
  });

  Goblin.registerQuest (goblinName, 'set-ref', function (
    quest,
    path,
    entityId
  ) {
    quest.do ();
    const entity = quest.goblin.getState ().toJS ();
    const i = quest.openInventory ();
    const r = i.useAny ('rethink');
    r.set ({
      table,
      documents: entity,
    });
  });

  Goblin.registerQuest (goblinName, 'delete', function* (quest, hard) {
    if (hard) {
      const i = quest.openInventory ();
      const r = i.useAny ('rethink');
      yield r.del ({table, documentId: quest.goblin.id});
    }
  });

  // Create a Goblin with initial state and handlers
  return Goblin.configure (goblinName, logicState, logicHandlers);
};
