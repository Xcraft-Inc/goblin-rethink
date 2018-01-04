const Goblin = require ('xcraft-core-goblin');
const common = require ('./common.js');

module.exports = config => {
  const {type, name, kind, hinters, list} = config;

  let goblinName = `${type}-${kind}`;

  if (name) {
    goblinName = name;
  }

  const logicHandlers = {
    create: (state, action) => {
      return state.set ('id', action.get ('id'));
    },
  };

  Goblin.registerQuest (goblinName, 'create', function (quest, desktopId) {
    if (hinters) {
      Object.keys (hinters).forEach (h => {
        quest.create (`${h}-hinter`, {desktopId, workitemId: quest.goblin.id});
      });
    }
    quest.goblin.setX ('desktopId', desktopId);

    if (list) {
      quest.createPlugin ('list', {
        desktopId,
        table: list,
        pageSize: 250,
        orderBy: 'firstName',
      });
    }

    quest.do ();
  });

  common.registerHinters (goblinName, hinters);

  Goblin.registerQuest (goblinName, 'get-entity', common.getEntityQuest);

  Goblin.registerQuest (goblinName, 'load-entity', common.loadEntityQuest);

  Goblin.registerQuest (goblinName, 'delete', function (quest) {});

  return Goblin.configure (goblinName, {}, logicHandlers);
};
