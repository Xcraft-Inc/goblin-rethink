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
    onLoad,
    onReload,
    onDelete,
    enableHistory,
    firstFieldToFocus,
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
            firstFieldToFocus: action.get ('firstFieldToFocus'),
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

  /*if (enableHistory) {
    Goblin.registerQuest (
      goblinName,
      `hinter-validate-${type}-version`,
      function* (quest, selection) {
        const i = quest.openInventory ();
        const entity = i.getAPI (quest.goblin.getX ('entityId'));
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
      const versionHinter = quest.getAPI (
        `entity-version-hinter@${quest.goblin.id}`
      );
      versionHinter.search ();
    });

    Goblin.registerQuest (goblinName, 'version', function* (quest) {
      const i = quest.openInventory ();
      const contact = i.getAPI (quest.goblin.getX ('entityId'));
      yield contact.version ({});
      quest.me.loadVersions ();
      const newVersion = yield contact.getVersion ();
      quest.dispatch ('set-version', {version: newVersion});
    });
  }*/

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
    parentEntity,
    rootAggregateId,
    rootAggregatePath,
    contextId,
    workflowId,
    payload,
    $msg,
    next
  ) {
    const i = quest.openInventory ();
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
        entity,
        parentEntity: entity ? entity.meta.parentEntity : parentEntity,
        rootAggregateId: entity ? entity.meta.rootAggregateId : rootAggregateId,
        rootAggregatePath: entity
          ? entity.meta.rootAggregatePath
          : rootAggregatePath,
      },
      payload
    );
    console.log ('Root workitem loading ', entityId);
    const e = yield quest.create (entityId, createArgs);
    //Accept cached entity
    if (!entity) {
      //lookup for an explicit typed entity in arguments
      entity = $msg.data[type];
      if (!entity) {
        entity = yield e.get ();
      }
    }

    if (!entity) {
      throw new Error ('Error during loading of ', entityId);
    }

    if (entity.meta.references) {
      for (const ref in entity.meta.references) {
        if (common.referenceUseArity (entity.meta.references[ref])) {
          const type = common.getReferenceType (entity.meta.references[ref]);
          let newEntityPayload = {};
          let onAdd = null;
          let onRemove = null;
          let onMove = null;
          if (plugins) {
            if (plugins[type]) {
              if (plugins[type].newEntityPayload) {
                newEntityPayload = plugins[type].newEntityPayload (entity);
              }
              if (plugins[type].onAdd) {
                onAdd = plugins[type].onAdd;
              }
              if (plugins[type].onRemove) {
                onRemove = plugins[type].onRemove;
              }
              if (plugins[type].onMove) {
                onMove = plugins[type].onMove;
              }
            }
          }

          for (const rId of entity[ref]) {
            const entityEditorId = `${type}-workitem@${rId}`;
            quest.create (entityEditorId, {
              id: entityEditorId,
              desktopId,
              entityId: rId,
            });
          }
          const pluginId = `${type}-plugin@${quest.goblin.id}`;
          quest.create (pluginId, {
            id: pluginId,
            desktopId,
            forEntity: entity.id,
            entityIds: entity[ref],
            newEntityPayload,
            parentWorkitemId: quest.goblin.id,
            onAdd,
            onRemove,
            onMove,
            arity: common.getReferenceArity (entity.meta.references[ref]),
          });
        } else {
          if (entity[ref] !== null) {
            const type = common.getReferenceType (entity.meta.references[ref]);
            const editorId = `${type}-workitem@${entity[ref]}`;
            quest.create (editorId, {
              id: editorId,
              desktopId,
              entityId: entity[ref],
            });
          }
        }
      }
    }

    if (entity.meta.values) {
      for (const val in entity.meta.values) {
        if (common.referenceUseArity (entity.meta.values[val])) {
          const type = common.getReferenceType (entity.meta.values[val]);
          let newEntityPayload = {};
          let onAdd = null;
          let onRemove = null;
          let onMove = null;
          if (plugins) {
            if (plugins[type]) {
              if (plugins[type].newEntityPayload) {
                newEntityPayload = plugins[type].newEntityPayload (entity);
              }
              if (plugins[type].onAdd) {
                onAdd = plugins[type].onAdd;
              }
              if (plugins[type].onRemove) {
                onRemove = plugins[type].onRemove;
              }
              if (plugins[type].onMove) {
                onMove = plugins[type].onMove;
              }
            }
          }

          for (const rId of entity[val]) {
            const entityEditorId = `${type}-workitem@${rId}`;
            quest.create (entityEditorId, {
              id: entityEditorId,
              desktopId,
              entityId: rId,
              entity: entity.private[val][rId],
            });
          }
          const pluginId = `${type}-plugin@${quest.goblin.id}`;
          quest.create (pluginId, {
            id: pluginId,
            desktopId,
            forEntity: entity.id,
            entityIds: entity[val],
            newEntityPayload,
            parentWorkitemId: quest.goblin.id,
            onAdd,
            onRemove,
            onMove,
            rootAggregateId: entity.meta.rootAggregateId,
            rootAggregatePath: entity.meta.rootAggregatePath.concat ([
              'private',
              val,
            ]),
            arity: common.getReferenceArity (entity.meta.values[val]),
          });
        } else {
          if (entity[val] !== null) {
            const type = common.getReferenceType (entity.meta.values[val]);
            const editorId = `${type}-workitem@${entity[val]}`;
            quest.create (editorId, {
              id: editorId,
              desktopId,
              entityId: val.id,
              entity: entity.private[val][entity[val]],
            });
          }
        }
      }
    }

    if (hinters) {
      Object.keys (hinters).forEach (h => {
        quest.create (`${h}-hinter`, {desktopId, workitemId: quest.goblin.id});
      });
    }

    /*if (enableHistory) {
      const vHinterId = `entity-version-hinter@${quest.goblin.id}`;
      const versionHinter = yield quest.create (vHinterId, {
        id: vHinterId,
        desktopId,
        workitemId: quest.goblin.id,
        entityId: entity.id,
        type,
        table: entity.meta.type,
      });
      versionHinter.search ();
    }*/

    if (onLoad) {
      yield quest.me.onLoad ({entity: entity});
    }

    quest.do ({id: quest.goblin.id, entity, firstFieldToFocus});
    return quest.goblin.id;
  });

  common.registerHinters (goblinName, hinters);

  if (onSubmit) {
    Goblin.registerQuest (goblinName, 'submit', onSubmit);
  }

  if (onLoad) {
    Goblin.registerQuest (goblinName, 'on-load', onLoad);
  }

  Goblin.registerQuest (goblinName, 'open-entity-workitem', function (
    quest,
    entity
  ) {
    const deskId = quest.goblin.getX ('desktopId');
    const i = quest.openInventory ();
    const desk = i.getAPI (deskId);
    desk.addWorkitem ({
      workitem: {
        id: quest.uuidV4 (),
        name: `${entity.meta.type}-workitem`,
        description: entity.meta.summaries.info,
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

  Goblin.registerQuest (goblinName, 'load-entity', common.loadEntityQuest);

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
    const desk = i.getAPI (quest.goblin.getX ('desktopId'));
    const nameId = quest.goblin.id.split ('@');
    desk.addWorkitem ({
      workitem: {
        id: quest.uuidV4 (),
        name: nameId[0],
        description: entity.meta.summaries.info || entity.meta.id,
        view: 'default',
        icon: 'edit-pen',
        isInWorkspace: true,
        isClosable: true,
        payload: {
          entityId: entity.id,
          rootAggregateId: entity.meta.rootAggregateId,
          rootAggregatePath: entity.meta.rootAggregatePath,
        },
      },
      navigate: true,
    });
  });

  Goblin.registerQuest (goblinName, 'close', function* (quest, kind) {
    const i = quest.openInventory ();
    const desk = i.getAPI (quest.goblin.getX ('desktopId'));
    const nameId = quest.goblin.id.split ('@');
    desk.removeWorkitem ({
      workitem: {
        id: quest.goblin.id.replace (nameId[0] + '@', ''),
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

    if (hard) {
      const entityId = quest.goblin.getX ('entityId');
      yield quest.cmd (`${type}.delete`, {id: entityId, hard: true});
    }
  });

  return Goblin.configure (goblinName, {}, logicHandlers);
};
