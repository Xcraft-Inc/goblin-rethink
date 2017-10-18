const Goblin = require ('xcraft-core-goblin');

module.exports = config => {
  const {name, type, title, editor, forType} = config;

  let goblinName = `${type}-plugin`;

  if (name) {
    goblinName = name;
  }
  let editorWidget = editor;
  if (!editorWidget) {
    editorWidget = `${forType}-editor`;
  }

  const methodBuilder = verb => {
    return verb + forType.charAt (0).toUpperCase () + forType.slice (1);
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
      return state.set ('extendedId', entityId).push ('entityIds', entityId); // extend added panel
    },
    remove: (state, action) => {
      const entityId = action.get ('entityId');
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
    entityIds
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
    quest.do ({id: quest.goblin.id, forEntity, title, entityIds});

    for (const entityId of entityIds) {
      const entityEditorId = `${editorWidget}@${entityId}`;
      quest.create (entityEditorId, {
        id: entityEditorId,
        desktopId,
        entityId,
      });
    }

    return quest.goblin.id;
  });

  Goblin.registerQuest (goblinName, 'add', function* (quest) {
    const entityId = quest.goblin.getX ('forEntity');
    const desktopId = quest.goblin.getX ('desktopId');
    const entity = yield quest.createNew (forType, {
      desktopId,
      forEntity: entityId,
    });
    const entityEditorId = `${editorWidget}@${entity.id}`;
    quest.create (entityEditorId, {
      id: entityEditorId,
      desktopId,
      entityId: entity.id,
    });

    const i = quest.openInventory ();
    const entityAPI = i.use (entityId);
    const method = methodBuilder ('add');
    entityAPI[method] ({entityId: entity.id});
    quest.do ({entityId: entity.id});
  });

  Goblin.registerQuest (goblinName, 'remove', function (quest, entityId) {
    const i = quest.openInventory ();
    const entityAPI = i.use (entityId);
    entityAPI.delete ({hard: true});
    quest.do ({entityId});
    const forEntityId = quest.goblin.getX ('forEntity');
    const forEntityAPI = i.use (forEntityId);
    const method = methodBuilder ('remove');
    forEntityAPI[method] ({entityId});
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
