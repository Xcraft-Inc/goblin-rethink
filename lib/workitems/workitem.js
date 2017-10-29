const Goblin = require ('xcraft-core-goblin');
const xUtils = require ('xcraft-core-utils');
const common = require ('./common.js');

module.exports = config => {
  const {
    type,
    name,
    kind,
    actions,
    quests,
    hinters,
    initialState,
    initialilizer,
    onCreate,
    onSubmit,
    onReload,
    onDelete,
    enableHistory,
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
            version: `v${entity.meta.version} du ${new Date (entity.meta.createdAt).toLocaleString ()}`,
            private: {
              [type]: entity,
            },
          },
          initialState,
          hintersTypes
        )
      );

      if (initialilizer && common.isFunction (initialilizer)) {
        action[type] = entity;
        return initialilizer (state, action);
      } else {
        return state;
      }
    },
    change: (state, action) => {
      return state.set (action.get ('path'), action.get ('newValue'));
    },
    apply: (state, action) => {
      return state.merge ('', action.get ('patch'));
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

        if (initialilizer && common.isFunction (initialilizer)) {
          action[type] = change.new_val;
          state = initialilizer (state, action);
        }

        return state;
      } else {
        return state;
      }
    },
    'set-version': (state, action) => {
      return state.set ('version', action.get ('version'));
    },
  };

  if (enableHistory) {
    Goblin.registerQuest (
      goblinName,
      `hinter-validate-${type}-version`,
      function* (quest, selection) {
        const i = quest.openInventory ();
        const entity = i.use (quest.goblin.getX ('entityId'));
        let patch = selection.payload;
        delete patch.id;
        for (const ref in selection.payload.meta.references) {
          delete patch[ref];
        }
        delete patch.meta;
        yield entity.preview ({patch});
        quest.dispatch ('set-version', {version: selection.text});
      }
    );

    Goblin.registerQuest (goblinName, 'load-versions', function (quest) {
      const versionHinter = quest.use ('entity-version-hinter');
      versionHinter.search ();
    });

    Goblin.registerQuest (goblinName, 'version', function* (quest) {
      const i = quest.openInventory ();
      const contact = i.use (quest.goblin.getX ('entityId'));
      yield contact.version ({});
      quest.me.loadVersions ();
      const newVersion = yield contact.getVersion ();
      quest.dispatch ('set-version', {version: newVersion});
    });
  }

  if (actions) {
    Object.assign (logicHandlers, actions);
    common.registerActions (goblinName, actions);
  }

  if (quests) {
    common.registerQuests (goblinName, quests);
  }

  Goblin.registerQuest (goblinName, 'create', function* (
    quest,
    desktopId,
    entityId,
    entity,
    contextId,
    workflowId,
    payload,
    $msg,
    next
  ) {
    if (payload) {
      if (payload.entityId) {
        entityId = payload.entityId;
      }
      if (payload.entity) {
        entity = payload.entity;
      }
    }
    if (!entityId) {
      //lookup for and explicit typed id in arguments
      //Manage desktopId collisions exceptions
      if (type === 'desktop') {
        entityId = $msg.data.deskId;
      } else {
        entityId = $msg.data[`${type}Id`];
      }

      if (!entityId) {
        entityId = `${type}@${quest.uuidV4 ()}`;
      }
    }

    quest.goblin.setX ('desktopId', desktopId);
    quest.goblin.setX ('entityId', entityId);
    quest.goblin.setX ('contextId', contextId);
    quest.goblin.setX ('workflowId', workflowId);
    const createArgs = Object.assign (
      {
        id: entityId,
        loadedBy: quest.goblin.id,
        desktopId,
      },
      payload
    );

    //Accept cached entity
    if (!entity) {
      //lookup for an explicit typed entity in arguments
      entity = $msg.data[type];
      if (!entity) {
        let e = null;
        const existing = yield quest.warehouse.get ({path: entityId});
        if (!existing) {
          e = yield quest.create (entityId, createArgs);
          entity = yield e.get ();
        } else {
          entity = existing;
        }
      }
    }

    if (hinters) {
      Object.keys (hinters).forEach (h => {
        quest.create (`${h}-hinter`, {desktopId, workitemId: quest.goblin.id});
      });
    }

    if (enableHistory) {
      const versionHinter = yield quest.create (`entity-version-hinter`, {
        desktopId,
        workitemId: quest.goblin.id,
        entityId: entity.id,
        type,
        table: entity.meta.table,
      });
      versionHinter.search ();
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
        const jsType = type.replace (/-([a-z])/g, (m, g1) => g1.toUpperCase ());
        const _onCreate = (q, m, n) => {
          const args = params.map (p => {
            if (p === jsType) {
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

        if (common.isGenerator (onCreate)) {
          yield* _onCreate (quest, $msg);
          return quest.goblin.id;
        } else {
          _onCreate (quest, $msg);
          return quest.goblin.id;
        }
      }
    } finally {
      /*r.startQuestOnChanges ({
          table,
          onChangeQuest: `${goblinName}.reload`,
          goblinId: quest.goblin.id,
          filter: {id: entityId},
        });*/
    }
    return quest.goblin.id;
  });

  common.registerHinters (goblinName, hinters);

  if (onSubmit) {
    Goblin.registerQuest (goblinName, 'submit', onSubmit);
  }

  Goblin.registerQuest (goblinName, 'open-entity-workitem', function* (
    quest,
    entity
  ) {
    const deskId = quest.goblin.getX ('desktopId');
    const i = quest.openInventory ();
    const desk = i.use (deskId);
    desk.addWorkitem ({
      workitem: {
        id: quest.uuidV4 (),
        name: `${entity.meta.type}-workitem`,
        description: entity.meta.info,
        view: 'default',
        icon: 'edit-pen',
        isInWorkspace: true,
        isClosable: true,
        payload: {
          entityId: entity.id,
        },
      },
      navigate: true,
    });
  });

  Goblin.registerQuest (goblinName, 'change', function (quest, path, newValue) {
    quest.do ();
    quest.evt ('changed');
  });

  Goblin.registerQuest (goblinName, 'apply', function (quest, patch) {
    quest.do ();
    quest.evt ('changed');
  });

  if (onReload) {
    Goblin.registerQuest (goblinName, 'custom-reload', onReload);
    Goblin.registerQuest (goblinName, 'disable-reload', function* (quest) {
      /*const r = quest.use ('rethink');
        yield r.stopOnChanges ({
          table,
        });*/
    });
  }

  Goblin.registerQuest (goblinName, 'reload', function* (quest, change) {
    quest.do ();
    if (onReload) {
      yield quest.me.customReload ({change});
    }
  });

  Goblin.registerQuest (goblinName, 'edit', function (quest, entity) {
    const i = quest.openInventory ();
    const desk = i.use (quest.goblin.getX ('desktopId'));
    desk.addWorkitem ({
      workitem: {
        id: quest.uuidV4 (),
        name: `${type}-workitem`,
        description: entity.meta.info || entity.meta.id,
        view: 'default',
        icon: 'edit-pen',
        isInWorkspace: true,
        isClosable: true,
        payload: {
          entityId: entity.id,
        },
      },
      navigate: true,
    });
  });

  Goblin.registerQuest (goblinName, 'close', function* (quest, kind) {
    const i = quest.openInventory ();
    const desk = i.use (quest.goblin.getX ('desktopId'));
    const nameId = quest.goblin.id.split ('@');
    desk.removeWorkitem ({
      workitem: {
        id: nameId[1],
        name: nameId[0],
        isInWorkspace: true,
        contextId: quest.goblin.getX ('contextId'),
      },
      close: false,
    });
    const entity = yield quest.warehouse.get ({
      path: quest.goblin.getX ('entityId'),
    });

    switch (kind) {
      case 'validate':
        quest.evt ('validated', entity);
        break;
      default:
      case 'terminate':
      case 'cancel':
        quest.evt ('canceled', entity);
        break;
    }

    quest.evt ('closed', entity);
    quest.me.delete ();
  });

  if (onDelete) {
    Goblin.registerQuest (goblinName, 'custom-delete', onDelete);
  }

  Goblin.registerQuest (goblinName, 'delete', function* (quest) {
    /*const r = quest.use ('rethink');
      yield r.stopOnChanges ({
        table,
      });*/
    if (onDelete) {
      yield quest.me.customDelete ();
    }
  });

  return Goblin.configure (goblinName, {}, logicHandlers);
};
