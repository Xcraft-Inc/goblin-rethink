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
    plugins,
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
        console.log ('Root workitem loading ', entityId);
        const e = yield quest.create (entityId, createArgs);
        const existing = yield quest.warehouse.get ({path: entityId});
        if (!existing) {
          entity = yield e.get ();
        } else {
          console.log ('Workitem using ', entityId);
          entity = existing;
        }
      }
    }

    if (entity.meta.references) {
      Object.keys (entity.meta.references).forEach (ref => {
        if (common.referenceUseArity (entity.meta.references[ref])) {
          const type = common.getReferenceType (entity.meta.references[ref]);
          let newEntityPayload = {};
          if (plugins) {
            if (plugins[type]) {
              if (plugins[type].newEntityPayload) {
                newEntityPayload = plugins[type].newEntityPayload (entity);
              }
            }
          }
          quest.create (`${type}-plugin`, {
            id: `${type}-plugin@${quest.goblin.id}`,
            desktopId,
            forEntity: entity.id,
            entityIds: entity[ref],
            newEntityPayload,
            arity: common.getReferenceArity (entity.meta.references[ref]),
          });
        }
      });
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
        table: entity.meta.type,
      });
      versionHinter.search ();
    }

    quest.do ({id: quest.goblin.id, entity});
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

  Goblin.registerQuest (goblinName, 'get-entity', common.getEntityQuest);

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

  Goblin.registerQuest (goblinName, 'delete', function* (quest, hard) {
    if (onDelete) {
      yield quest.me.customDelete ();
    }

    const entityId = quest.goblin.getX ('entityId');
    yield quest.cmd (`${type}.delete`, {id: entityId, hard});
  });

  return Goblin.configure (goblinName, {}, logicHandlers);
};
