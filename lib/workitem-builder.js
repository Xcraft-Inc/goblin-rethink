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

module.exports = config => {
  const {type, kind, database, table, hinters, onCreate, onDelete} = config;

  const goblinName = `${type}-${kind}`;

  // Define initial logic values
  const logicState = {};

  // Define logic handlers according rc.json
  const logicHandlers = {
    create: (state, action) => {
      const id = action.get ('id');
      const entity = action.get ('entity');
      let hintersTypes = {};
      if (hinters) {
        Object.keys (hinters).forEach (h => {
          hintersTypes[h] = entity[hinters[h].mapToField];
        });
      }
      return state.set (
        '',
        Object.assign (
          {
            id: id,
            [type]: entity,
          },
          hintersTypes
        )
      );
    },
    reload: (state, action) => {
      const change = action.get ('change');
      if (change.new_val) {
        let newState = state.set (type, change.new_val);
        if (hinters) {
          Object.keys (hinters).forEach (h => {
            newState = newState.set (h, change.new_val[hinters[h].mapToField]);
          });
        }
        return newState;
      } else {
        return state;
      }
    },
  };

  Goblin.registerQuest (goblinName, 'create', function* (
    quest,
    desktopId,
    entityId,
    entity,
    $msg
  ) {
    if (!entityId) {
      //lookup for and explicit typed id in arguments
      entityId = $msg.data[`${type}Id`];
      if (!entityId) {
        throw new Error (
          `Cannot create ${goblinName} without providing and entityId or ${type}Id`
        );
      }
    }

    quest.goblin.setX ('entityId', entityId);
    const r = yield quest.create ('rethink', {database});

    if (!entity) {
      //lookup for an explicit typed entity in arguments
      entity = $msg.data[type];
      if (!entity) {
        entity = yield r.get ({
          table,
          documentId: entityId,
        });
      }
    }

    r.startQuestOnChanges ({
      table,
      onChangeQuest: `${goblinName}.reload`,
      goblinId: quest.goblin.id,
      filter: {id: entityId},
    });

    if (hinters) {
      Object.keys (hinters).forEach (h => {
        quest.create (`${h}-hinter`, {desktopId, workitemId: quest.goblin.id});
      });
    }

    quest.do ({id: quest.goblin.id, entity});

    if (onCreate) {
      // We support the same goblin quest feature:
      // auto parameter->value mapping
      // with a little addition:
      // if user request type in params, we provide the requested entity
      // from rethink.

      const params = xUtils.reflect
        .funcParams (onCreate)
        .filter (param => !/^(quest|next)$/.test (param));

      const _onCreate = (q, m, n) => {
        const args = params.map (p => {
          if (p === type) {
            return entity;
          } else {
            return m.get (p);
          }
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

        return onCreate (...args);
      };

      if (isGenerator (onCreate)) {
        yield _onCreate (quest, $msg);
        return quest.goblin.id;
      }
      if (isFunction (onCreate)) {
        _onCreate (quest, $msg);
        return quest.goblin.id;
      }
    }
    return quest.goblin.id;
  });

  if (hinters) {
    Object.keys (hinters).forEach (h => {
      Goblin.registerQuest (goblinName, `change-${h}`, function (
        quest,
        newValue
      ) {
        const hinter = quest.use (`${h}-hinter`);
        hinter.search ({value: newValue});
      });

      Goblin.registerQuest (
        goblinName,
        `hinter-validate-${h}`,
        hinters[h].onValidate
      );
    });
  }

  Goblin.registerQuest (goblinName, 'reload', function (quest) {
    quest.do ();
  });

  if (onDelete) {
    Goblin.registerQuest (goblinName, 'delete', onDelete);
  } else {
    Goblin.registerQuest (goblinName, 'delete', function (quest) {});
  }

  return Goblin.configure (goblinName, logicState, logicHandlers);
};
