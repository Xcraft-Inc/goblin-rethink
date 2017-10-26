const Goblin = require ('xcraft-core-goblin');

module.exports = config => {
  const {name, type, title, editor, forType} = config;

  let goblinName = `${type}-plugin`;

  if (name) {
    goblinName = name;
  }
  let editorWidget = editor;
  if (!editorWidget) {
    editorWidget = `${forType}-workitem`;
  }

  function jsifyQuestName (quest) {
    return quest.replace (/-([a-z])/g, (m, g1) => g1.toUpperCase ());
  }

  const methodBuilder = verb => {
    return jsifyQuestName (verb + '-' + forType);
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

  Goblin.registerQuest (goblinName, 'create', function (
    quest,
    desktopId,
    forEntity,
    entityIds,
    newEntityPayload
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
    quest.do ({id: quest.goblin.id, forEntity, title, entityIds});

    if (entityIds) {
      for (const entityId of entityIds) {
        const entityEditorId = `${editorWidget}@${entityId}`;
        quest.create (entityEditorId, {
          id: entityEditorId,
          desktopId,
          entityId,
        });
      }
    }

    quest.goblin.defer (
      quest.sub (`${forEntity}.remote-ref-added`, (err, msg) => {
        if (msg.data.type === forType) {
          quest.me.add ({entityId: msg.data.entityId, remote: true});
        }
      })
    );

    quest.goblin.defer (
      quest.sub (`${forEntity}.remote-ref-removed`, (err, msg) => {
        if (msg.data.type === forType) {
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
      const entity = yield quest.createNew (
        forType,
        Object.assign ({desktopId, forEntityId}, newEntityPayload)
      );
      entityId = entity.id;
    } else {
      yield quest.create (entityId, {id: entityId, desktopId});
    }

    const entityEditorId = `${editorWidget}@${entityId}`;
    yield quest.create (entityEditorId, {
      id: entityEditorId,
      desktopId,
      entityId: entityId,
      forEntity: forEntityId,
    });

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

    const entityAPI = i.use (entityId);
    entityAPI.delete ({hard: !remote});

    const forEntityId = quest.goblin.getX ('forEntity');
    const forEntityAPI = i.use (forEntityId);
    const method = methodBuilder ('remove');

    forEntityAPI[method] ({entityId, remote});
    quest.do ({entityId});
    const entityEditorId = `${editorWidget}@${entityId}`;
    quest.use (entityEditorId).delete ();
  });

  Goblin.registerQuest (goblinName, 'extend', function (quest, entityId) {
    quest.do ({entityId});
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

  Goblin.registerQuest (goblinName, 'delete', function (quest) {});

  return Goblin.configure (goblinName, {}, logicHandlers);
};
