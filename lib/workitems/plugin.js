const Goblin = require ('xcraft-core-goblin');
const common = require ('./common.js');
module.exports = config => {
  const {name, type, title, editor} = config;

  let goblinName = `${type}-plugin`;

  if (name) {
    goblinName = name;
  }
  let editorWidget = editor;
  if (!editorWidget) {
    editorWidget = `${type}-workitem`;
  }

  function jsifyQuestName (quest) {
    return quest.replace (/-([a-z])/g, (m, g1) => g1.toUpperCase ());
  }

  const methodBuilder = verb => {
    return jsifyQuestName (verb + '-' + type);
  };

  // Define logic handlers according rc.json
  const logicHandlers = {
    create: (state, action) => {
      const initialState = {
        id: action.get ('id'),
        forEntity: action.get ('forEntity'),
        entityIds: action.get ('entityIds'),
        title: action.get ('title'),
        editorWidget: editorWidget,
        arity: action.get ('arity'),
        extendedIds: [],
        selectedIds: [],
      };
      return state.set ('', initialState);
    },
    clear: state => {
      return state.set ('entityIds', []).set ('extendedId', null);
    },
    add: (state, action) => {
      const entityId = action.get ('entityId');
      return state.push ('entityIds', entityId);
    },
    remove: (state, action) => {
      const entityId = action.get ('entityId');
      return state.unpush ('entityIds', entityId);
    },
    select: (state, action) => {
      const entityIds = action.get ('entityIds');
      const clear = action.get ('clear');
      const mode = action.get ('mode');

      let newState = state;
      if (clear) {
        return state.set ('selectedIds', entityIds);
      }

      const selectedIds = newState.get ('selectedIds').toArray ();
      for (const entityId of entityIds) {
        const indexOf = selectedIds.indexOf (entityId);
        switch (mode) {
          default:
          case 'set':
            if (indexOf !== -1) {
              newState = newState.push ('selectedIds', entityId);
            }
            break;
          case 'swap':
            if (indexOf !== -1) {
              newState = newState.unpush ('selectedIds', entityId);
            } else {
              newState = newState.push ('seletedIds', entityId);
            }
            break;
        }
      }

      return newState;
    },
    extend: (state, action) => {
      const entityId = action.get ('entityId');
      const currentId = state.get ('extendedId');
      const extendedIds = state.get ('extendedIds').toArray ();
      const indexOf = extendedIds.indexOf (entityId);

      if (indexOf !== -1) {
        state = state.unpush ('extendedIds', entityId);
      } else {
        state = state.push ('extendedIds', entityId);
      }

      if (entityId === currentId) {
        return state.set ('extendedId', null); // compact panel
      } else {
        return state.set ('extendedId', entityId); // extend panel
      }
    },
    'compact-all': state => {
      return state.set ('extendedId', null); // compact all panels
    },
    drag: (state, action) => {
      const fromId = action.get ('fromId');
      const toId = action.get ('toId');
      return state.move ('entityIds', fromId, toId);
    },
  };

  //HOOKS

  Goblin.registerQuest (goblinName, 'on-add', function* (quest, entity, next) {
    const onAdd = quest.goblin.getX ('onAdd');
    if (onAdd) {
      if (common.isGenerator (onAdd)) {
        yield* onAdd (quest, entity, next);
      } else {
        onAdd (quest, entity);
      }
    }
  });

  Goblin.registerQuest (goblinName, 'on-remove', function* (
    quest,
    entity,
    next
  ) {
    const onRemove = quest.goblin.getX ('onRemove');
    if (onRemove) {
      if (common.isGenerator (onRemove)) {
        yield* onRemove (quest, entity, next);
      } else {
        onRemove (quest, entity);
      }
    }
  });

  Goblin.registerQuest (goblinName, 'on-move', function* (
    quest,
    fromId,
    toId,
    next
  ) {
    const onMove = quest.goblin.getX ('onMove');
    if (onMove) {
      if (common.isGenerator (onMove)) {
        yield* onMove (quest, fromId, toId, next);
      } else {
        onMove (quest, fromId, toId);
      }
    }
  });

  Goblin.registerQuest (goblinName, 'create', function (
    quest,
    desktopId,
    forEntity,
    entityIds,
    parentWorkitemId,
    newEntityPayload,
    onAdd,
    onRemove,
    onMove,
    rootAggregateId,
    rootAggregatePath,
    arity
  ) {
    if (!desktopId) {
      throw new Error (
        `Cannot create plugin for ${forEntity} without a desktopId`
      );
    }

    if (!forEntity) {
      throw new Error (
        'A plugin must be created for an entity, missing parameter forEntity?'
      );
    }

    quest.goblin.setX ('desktopId', desktopId);
    quest.goblin.setX ('forEntity', forEntity);
    quest.goblin.setX ('newEntityPayload', newEntityPayload);
    quest.goblin.setX ('parentWorkitemId', parentWorkitemId);
    quest.goblin.setX ('onAdd', onAdd);
    quest.goblin.setX ('onRemove', onRemove);
    quest.goblin.setX ('onMove', onMove);
    quest.goblin.setX (
      'rootAggregateId',
      rootAggregateId ? rootAggregateId : forEntity
    );
    quest.goblin.setX (
      'rootAggregatePath',
      rootAggregatePath ? rootAggregatePath : []
    );
    quest.do ({id: quest.goblin.id, forEntity, title, entityIds, arity});

    quest.goblin.setX (
      'unsubAdd',
      quest.sub (`${forEntity}.remote-ref-added`, (err, msg) => {
        if (msg.data.type === type) {
          quest.me.add ({entityId: msg.data.entityId, remote: true});
        }
      })
    );

    quest.goblin.setX (
      'unsubRemove',
      quest.sub (`${forEntity}.remote-ref-removed`, (err, msg) => {
        if (msg.data.type === type) {
          quest.me.remove ({entityId: msg.data.entityId, remote: true});
        }
      })
    );

    quest.goblin.setX (
      'unsubAddVal',
      quest.sub (`${forEntity}.val-added`, (err, msg) => {
        const entity = msg.data.entity;
        if (entity.meta.type === type) {
          quest.me.add ({
            entityId: entity.id,
            entity: entity,
            skipAdd: true,
            remote: false,
          });
        }
      })
    );

    quest.goblin.setX (
      'unsubRemVal',
      quest.sub (`${forEntity}.val-removed`, (err, msg) => {
        const entity = msg.data.entity;
        if (entity.meta.type === type) {
          quest.me.remove ({
            entityId: entity.Id,
            remote: false,
            skipRemove: true,
          });
        }
      })
    );

    quest.goblin.setX (
      'unsubClear',
      quest.sub (`${forEntity}.cleared`, (err, msg) => {
        if (msg.data.type === type) {
          quest.me.clear ();
        }
      })
    );

    return quest.goblin.id;
  });

  Goblin.registerQuest (goblinName, 'add', function* (
    quest,
    entityId,
    entity,
    remote,
    skipAdd
  ) {
    const forEntityId = quest.goblin.getX ('forEntity');
    const newEntityPayload = quest.goblin.getX ('newEntityPayload');
    const desktopId = quest.goblin.getX ('desktopId');
    const entityIds = quest.goblin.getState ().get ('entityIds', []).toArray ();
    if (entityIds.indexOf (entityId) !== -1) {
      return;
    }
    if (!entityId) {
      entityId = `${type}@${quest.uuidV4 ()}`;
      const entityEditorId = `${editorWidget}@${entityId}`;
      const rootAggregatePath = quest.goblin.getX ('rootAggregatePath');
      yield quest.create (entityEditorId, {
        id: entityEditorId,
        desktopId,
        entityId: entityId,
        parentEntity: forEntityId,
        rootAggregateId: quest.goblin.getX ('rootAggregateId'),
        rootAggregatePath: rootAggregatePath.concat ([entityId]),
        payload: newEntityPayload,
      });
    } else {
      const entityEditorId = `${editorWidget}@${entityId}`;
      yield quest.create (entityEditorId, {
        id: entityEditorId,
        desktopId,
        entityId: entityId,
        entity: entity,
      });
    }

    if (!skipAdd) {
      const i = quest.openInventory ();
      const entityAPI = i.getAPI (forEntityId);
      const method = methodBuilder ('add');
      entityAPI[method] ({entityId, remote});
      const onAdd = quest.goblin.getX ('onAdd');
      if (onAdd) {
        if (!entity) {
          const i = quest.openInventory ();
          const addedEntityAPI = i.getAPI (entityId);
          entity = yield addedEntityAPI.get ();
        }
        const pwi = quest.goblin.getX ('parentWorkitemId');
        const service = pwi.split ('@')[0];
        quest.cmd (`${service}.${onAdd}`, {id: pwi, [type]: entity});
      }
    }

    if (!remote) {
      quest.dispatch ('compact-all');
    }

    quest.do ({entityId});
  });

  Goblin.registerQuest (goblinName, 'remove', function* (
    quest,
    entityId,
    remote,
    skipRemove
  ) {
    const i = quest.openInventory ();
    const forEntityId = quest.goblin.getX ('forEntity');
    const forEntityAPI = i.getAPI (forEntityId);

    const entityIds = quest.goblin.getState ().get ('entityIds', []).toArray ();
    if (entityIds.indexOf (entityId) === -1) {
      return;
    }

    if (!skipRemove) {
      const method = methodBuilder ('remove');
      forEntityAPI[method] ({entityId, remote});
      const onRemove = quest.goblin.getX ('onRemove');
      if (onRemove) {
        const i = quest.openInventory ();
        const removedEntityAPI = i.getAPI (entityId);
        const entity = yield removedEntityAPI.get ();
        const pwi = quest.goblin.getX ('parentWorkitemId');
        const service = pwi.split ('@')[0];
        yield quest.cmd (`${service}.${onRemove}`, {id: pwi, [type]: entity});
      }
    }

    quest.do ({entityId});
    const entityEditorId = `${editorWidget}@${entityId}`;
    quest.cmd (`${editorWidget}.delete`, {id: entityEditorId});
  });

  Goblin.registerQuest (goblinName, 'clear', function (quest) {
    const entityIds = quest.goblin.getState ().get ('entityIds', []).toArray ();
    for (const entityId of entityIds) {
      const entityEditorId = `${editorWidget}@${entityId}`;
      quest.cmd (`${editorWidget}.delete`, {id: entityEditorId});
    }
    quest.do ();
  });

  Goblin.registerQuest (goblinName, 'extend', function (quest, entityId) {
    quest.do ({entityId});
  });

  Goblin.registerQuest (goblinName, 'select', function (
    quest,
    entityIds,
    clear,
    mode
  ) {
    quest.do ({entityIds});
  });

  Goblin.registerQuest (goblinName, 'get-entity', common.getEntityQuest);

  Goblin.registerQuest (goblinName, 'edit', function* (quest, entityId) {
    const entity = yield quest.me.getEntity ({entityId});
    const deskId = quest.goblin.getX ('desktopId');
    const i = quest.openInventory ();
    const desk = i.getAPI (deskId);
    desk.addWorkitem ({
      workitem: {
        id: `${entity.id}`,
        name: `${entity.meta.type}-workitem`,
        description: entity.meta.summaries.info,
        view: 'default',
        icon: 'edit-pen',
        isInWorkspace: true,
        isClosable: true,
        payload: {
          entityId: entityId,
          rootAggregateId: entity.meta.rootAggregateId,
          rootAggregatePath: entity.meta.rootAggregatePath,
        },
      },
      navigate: true,
    });
  });

  Goblin.registerQuest (goblinName, 'compact-all', function (quest) {
    quest.do ();
  });

  Goblin.registerQuest (goblinName, 'drag', function (quest, fromId, toId) {
    quest.do ({fromId, toId});
    const forEntityId = quest.goblin.getX ('forEntity');
    const i = quest.openInventory ();
    const forEntityAPI = i.getAPI (forEntityId);
    const method = methodBuilder ('move');
    forEntityAPI[method] ({entityId: fromId, afterEntityId: toId});
    const onMove = quest.goblin.getX ('onMove');
    if (onMove) {
      const pwi = quest.goblin.getX ('parentWorkitemId');
      const service = pwi.split ('@')[0];
      quest.cmd (`${service}.${onMove}`, {id: pwi, fromId, toId});
    }
  });

  Goblin.registerQuest (goblinName, 'delete', function (quest) {
    quest.goblin.getX ('unsubAdd') ();
    quest.goblin.getX ('unsubAddVal') ();
    quest.goblin.getX ('unsubRemove') ();
    quest.goblin.getX ('unsubRemVal') ();
    quest.goblin.getX ('unsubClear') ();
  });

  return Goblin.configure (goblinName, {}, logicHandlers);
};
