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
  const {name, type, table, actions, quests, onNew} = config;

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
    'add-ref': (state, action) => {
      return state.push (action.get ('path'), action.get ('ref'));
    },
    'remove-ref': (state, action) => {
      return state.unpush (action.get ('path'), action.get ('ref'));
    },
  };

  if (actions) {
    Object.assign (logicHandlers, actions);
    registerActions (goblinName, actions);
  }

  if (quests) {
    registerQuests (goblinName, quests);
  }

  Goblin.registerQuest (goblinName, 'create', function* (quest, id, $msg) {
    const i = quest.openInventory ();
    const r = i.use ('rethink');
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
        /*r.startQuestOnChanges ({
          table,
          onChangeQuest: `${goblinName}.reload`,
          goblinId: quest.goblin.id,
          filter: {id: entityId},
        });*/
      }
    }

    quest.do ({entity});
    return quest.goblin.id;
  });

  Goblin.registerQuest (goblinName, 'get', function (quest) {
    return quest.goblin.getState ().toJS ();
  });

  Goblin.registerQuest (goblinName, 'add-ref', function (quest, path, ref) {
    quest.do ();
    const entity = quest.goblin.getState ();
    const i = quest.openInventory ();
    const r = i.use ('rethink');
    r.set ({
      table,
      documents: entity,
    });
  });

  Goblin.registerQuest (goblinName, 'remove-ref', function (quest, path, ref) {
    quest.do ();
    const entity = quest.goblin.getState ();
    const i = quest.openInventory ();
    const r = i.use ('rethink');
    r.set ({
      table,
      documents: entity,
    });
  });

  Goblin.registerQuest (goblinName, 'delete', function* (quest, hard) {
    if (hard) {
      const i = quest.openInventory ();
      const r = i.use ('rethink');
      yield r.del ({table, documentId: quest.goblin.id});
    }
  });

  // Create a Goblin with initial state and handlers
  return Goblin.configure (goblinName, logicState, logicHandlers);
};
