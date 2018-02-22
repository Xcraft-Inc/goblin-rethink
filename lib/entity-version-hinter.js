'use strict';

const Goblin = require('xcraft-core-goblin');

const goblinName = 'entity-version-hinter';

// Define initial logic values
const logicState = {};

// Define logic handlers according rc.json
const logicHandlers = {
  create: (state, action) => {
    const id = action.get('id');
    return state.set('', {
      id: id,
    });
  },
};

Goblin.registerQuest(goblinName, 'create', function*(
  quest,
  desktopId,
  workitemId,
  entityId,
  type,
  table
) {
  const desk = quest.getGoblinAPI('desktop', desktopId);

  // Create a hinter for contacts
  const hinterId = yield desk.createHinterFor({
    type: `${type}-version`,
    workitemId: workitemId,
    detailWidget: `${type}-detail`,
  });
  quest.goblin.setX('desktopId', desktopId);
  quest.goblin.setX('hinterId', hinterId);
  quest.goblin.setX('table', table);
  quest.goblin.setX('entityId', entityId);

  quest.do({id: quest.goblin.id});
  return quest.goblin.id;
});

Goblin.registerQuest(goblinName, 'search', function*(quest) {
  const hinterId = quest.goblin.getX('hinterId');
  const hinter = quest.getGoblinAPI('hinter', hinterId);
  const r = quest.getStorage('rethink');

  const entityId = quest.goblin.getX('entityId');
  const table = quest.goblin.getX('table');

  const results = yield r.getAll({
    table,
    filter: {meta: {id: entityId}},
  });
  if (results) {
    const rows = results.map(
      p =>
        `v${p.meta.version} du ${new Date(p.meta.createdAt).toLocaleString()}`
    );
    const values = results.map(p => p.id);
    hinter.setSelections({
      rows: rows,
      values: values,
      payloads: results,
      usePayload: true,
    });
  }
});

Goblin.registerQuest(goblinName, 'delete', function(quest) {});

// Create a Goblin with initial state and handlers
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
