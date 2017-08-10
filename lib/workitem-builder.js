'use strict';

const Goblin = require ('xcraft-core-goblin');

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
    entity
  ) {
    quest.goblin.setX ('entityId', entityId);
    const r = yield quest.create ('rethink', {database});

    if (!entity) {
      entity = yield r.get ({
        table,
        documentId: entityId,
      });
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
      if (isGenerator (onCreate)) {
        yield onCreate (quest, desktopId, entity);
        return quest.goblin.id;
      }
      if (isFunction (onCreate)) {
        onCreate (quest, desktopId, entity);
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
