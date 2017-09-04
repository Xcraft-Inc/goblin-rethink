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

const registerHinters = (goblinName, hinters) => {
  if (hinters) {
    Object.keys (hinters).forEach (h => {
      Goblin.registerQuest (goblinName, `change-${h}`, function (
        quest,
        newValue
      ) {
        const hinter = quest.use (`${h}-hinter`);
        hinter.search ({value: newValue});
      });
      if (hinters[h].onValidate) {
        Goblin.registerQuest (
          goblinName,
          `hinter-validate-${h}`,
          hinters[h].onValidate
        );
      }
    });
  }
};

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

const editorTemplate = config => {
  const {
    type,
    name,
    kind,
    database,
    table,
    actions,
    quests,
    hinters,
    initialState,
    initialilizer,
    onCreate,
    onSubmit,
    onReload,
    onDelete,
  } = config;

  let goblinName = `${type}-${kind}`;

  if (name) {
    goblinName = name;
  }

  const logicHandlers = {
    create: (state, action) => {
      const id = action.get ('id');

      let hintersTypes = {};
      if (hinters) {
        const entity = new Goblin.Shredder (action.get ('entity'));
        Object.keys (hinters).forEach (h => {
          if (hinters[h].fieldValuePath) {
            const value = entity.get (hinters[h].fieldValuePath, null);
            hintersTypes[h] = value;
          }
        });
      }

      const entity = action.get ('entity');
      state = state.set (
        '',
        Object.assign (
          {
            id: id,
            entityId: entity.id,
            [type]: entity,
          },
          initialState,
          hintersTypes
        )
      );

      if (initialilizer && isFunction (initialilizer)) {
        action[type] = entity;
        return initialilizer (state, action);
      } else {
        return state;
      }
    },
    reload: (state, action) => {
      const change = action.get ('change');
      if (change.new_val) {
        const entity = new Goblin.Shredder (change.new_val);
        state = state.set (type, change.new_val);
        if (hinters) {
          Object.keys (hinters).forEach (h => {
            if (hinters[h].fieldValuePath) {
              const value = entity.get (hinters[h].fieldValuePath, null);
              state = state.set (h, value);
            }
          });
        }

        if (initialilizer && isFunction (initialilizer)) {
          action[type] = change.new_val;
          state = initialilizer (state, action);
        }

        return state;
      } else {
        return state;
      }
    },
  };

  if (actions) {
    Object.assign (logicHandlers, actions);
    registerActions (goblinName, actions);
  }

  if (quests) {
    registerQuests (goblinName, quests);
  }

  Goblin.registerQuest (goblinName, 'create', function* (
    quest,
    desktopId,
    entityId,
    entity,
    $msg,
    next
  ) {
    if (!entityId) {
      //lookup for and explicit typed id in arguments
      //Manage desktopId collisions exceptions
      if (type === 'desktop') {
        entityId = $msg.data.deskId;
      } else {
        entityId = $msg.data[`${type}Id`];
      }

      if (!entityId) {
        throw new Error (
          `Cannot create ${goblinName} without providing and entityId or ${type}Id`
        );
      }
    }

    quest.goblin.setX ('entityId', entityId);
    const desk = quest.useAs ('desktop', desktopId);
    const conf = yield desk.getConfiguration ();
    const r = yield quest.create ('rethink', {
      host: conf.rethinkdbHost,
      database,
    });

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

    if (hinters) {
      Object.keys (hinters).forEach (h => {
        quest.create (`${h}-hinter`, {desktopId, workitemId: quest.goblin.id});
      });
    }

    quest.do ({id: quest.goblin.id, entity});
    try {
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
          yield* _onCreate (quest, $msg);
          return quest.goblin.id;
        }
        if (isFunction (onCreate)) {
          _onCreate (quest, $msg);
          return quest.goblin.id;
        }
      }
    } finally {
      r.startQuestOnChanges ({
        table,
        onChangeQuest: `${goblinName}.reload`,
        goblinId: quest.goblin.id,
        filter: {id: entityId},
      });
    }
    return quest.goblin.id;
  });

  registerHinters (goblinName, hinters);

  if (onSubmit) {
    Goblin.registerQuest (goblinName, 'submit', onSubmit);
  }

  if (onReload) {
    Goblin.registerQuest (goblinName, 'custom-reload', onReload);
    Goblin.registerQuest (goblinName, 'disable-reload', function* (quest) {
      const r = quest.use ('rethink');
      yield r.stopOnChanges ({
        table,
      });
    });
  }
  Goblin.registerQuest (goblinName, 'reload', function* (quest, change) {
    quest.do ();
    if (onReload) {
      yield quest.me.customReload ({change});
    }
  });

  if (onDelete) {
    Goblin.registerQuest (goblinName, 'custom-delete', onDelete);
  }

  Goblin.registerQuest (goblinName, 'delete', function* (quest) {
    const r = quest.use ('rethink');
    yield r.stopOnChanges ({
      table,
    });
    if (onDelete) {
      yield quest.me.customDelete ();
    }
  });

  return Goblin.configure (goblinName, {}, logicHandlers);
};

const searchTemplate = config => {
  const {type, name, kind, hinters} = config;

  let goblinName = `${type}-${kind}`;

  if (name) {
    goblinName = name;
  }

  const logicHandlers = {
    create: (state, action) => {
      const id = action.get ('id');
      return state.set ('', {
        id: id,
      });
    },
  };

  Goblin.registerQuest (goblinName, 'create', function (quest, desktopId) {
    if (hinters) {
      Object.keys (hinters).forEach (h => {
        quest.create (`${h}-hinter`, {desktopId, workitemId: quest.goblin.id});
      });
    }

    quest.do ();
  });

  registerHinters (goblinName, hinters);

  Goblin.registerQuest (goblinName, 'delete', function (quest) {});

  return Goblin.configure (goblinName, {}, logicHandlers);
};

module.exports = config => {
  switch (config.kind) {
    case 'detail':
    case 'editor':
      return editorTemplate (config);
    case 'search':
      return searchTemplate (config);
    default:
      throw new Error (`Unknow workitem kind: ${config.kind}`);
  }
};
