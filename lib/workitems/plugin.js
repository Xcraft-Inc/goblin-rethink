const Goblin = require ('xcraft-core-goblin');

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
      };
      return state.set ('', initialState);
    },
    add: (state, action) => {
      const entityId = action.get ('entityId');
      if (action.get ('remote')) {
        return state.push ('entityIds', entityId);
      }
      return state.set ('extendedId', entityId).push ('entityIds', entityId); // extend added panel
    },
    remove: (state, action) => {
      const entityId = action.get ('entityId');
      if (action.get ('remote')) {
        return state.unpush ('entityIds', entityId);
      }
      return state.set ('extendedId', null).unpush ('entityIds', entityId); // compact all panels
    },
    extend: (state, action) => {
      const entityId = action.get ('entityId');
      const currentId = state.get ('extendedId');
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

  Goblin.registerQuest (goblinName, 'create', function* (
    quest,
    desktopId,
    forEntity,
    entityIds,
    newEntityPayload,
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
    quest.goblin.setX ('newEntityPayload', newEntityPayload || {});
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

    return quest.goblin.id;
  });

  Goblin.registerQuest (goblinName, 'add', function* (quest, entityId, remote) {
    const forEntityId = quest.goblin.getX ('forEntity');
    const newEntityPayload = quest.goblin.getX ('newEntityPayload');
    const desktopId = quest.goblin.getX ('desktopId');

    if (!entityId) {
      entityId = `${type}@${quest.uuidV4 ()}`;
      const entityEditorId = `${editorWidget}@${entityId}`;
      yield quest.create (entityEditorId, {
        id: entityEditorId,
        desktopId,
        entityId: entityId,
        payload: newEntityPayload,
      });
    } else {
      const entityEditorId = `${editorWidget}@${entityId}`;
      yield quest.create (entityEditorId, {
        id: entityEditorId,
        desktopId,
        entityId: entityId,
      });
    }

    const i = quest.openInventory ();
    const entityAPI = i.use (forEntityId);
    const method = methodBuilder ('add');
    entityAPI[method] ({entityId, remote});

    quest.do ({entityId});
  });

  Goblin.registerQuest (goblinName, 'remove', function (
    quest,
    entityId,
    remote
  ) {
    const i = quest.openInventory ();
    const forEntityId = quest.goblin.getX ('forEntity');
    const desktopId = quest.goblin.getX ('desktopId');
    const forEntityAPI = i.use (forEntityId);
    const method = methodBuilder ('remove');

    forEntityAPI[method] ({entityId, remote});
    quest.do ({entityId});
    const entityEditorId = `${editorWidget}@${entityId}`;
    quest.cmd (`${editorWidget}.delete`, {id: entityEditorId});
  });

  Goblin.registerQuest (goblinName, 'extend', function (quest, entityId) {
    quest.do ({entityId});
  });

  Goblin.registerQuest (goblinName, 'edit', function* (quest, entityId) {
    const entity = yield quest.warehouse.get ({path: entityId});
    const deskId = quest.goblin.getX ('desktopId');
    const i = quest.openInventory ();
    const desk = i.use (deskId);
    desk.addWorkitem ({
      workitem: {
        id: `${entity.id}`,
        name: `${entity.meta.type}-workitem`,
        description: entity.meta.info,
        view: 'default',
        icon: 'edit-pen',
        isInWorkspace: true,
        isClosable: true,
        payload: {
          entityId: entityId,
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
    const forEntityAPI = i.use (forEntityId);
    const method = methodBuilder ('move');
    forEntityAPI[method] ({entityId: fromId, afterEntityId: toId});
  });

  Goblin.registerQuest (goblinName, 'delete', function (quest) {
    quest.goblin.getX ('unsubAdd') ();
    quest.goblin.getX ('unsubRemove') ();
  });

  return Goblin.configure (goblinName, {}, logicHandlers);
};
