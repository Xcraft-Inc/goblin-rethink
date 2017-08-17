'use strict';

const Goblin = require ('xcraft-core-goblin');

module.exports = config => {
  const {type, database, table, field} = config;

  if (!config.displayField) {
    config.displayField = field;
  }

  const goblinName = `${type}-hinter`;

  // Define initial logic values
  const logicState = {};

  // Define logic handlers according rc.json
  const logicHandlers = {
    create: (state, action) => {
      const id = action.get ('id');
      return state.set ('', {
        id: id,
      });
    },
  };

  Goblin.registerQuest (goblinName, 'create', function* (
    quest,
    desktopId,
    workitemId
  ) {
    quest.create ('rethink', {database});
    const desk = quest.useAs ('desktop', desktopId);

    // Create a hinter for contacts
    const hinterId = yield desk.createHinterFor ({
      type,
      workitemId: workitemId,
      detailWidget: `${type}-detail`,
    });
    quest.goblin.setX ('hinterId', hinterId);

    quest.do ({id: quest.goblin.id});
    return quest.goblin.id;
  });

  Goblin.registerQuest (goblinName, 'search', function* (quest, value) {
    const hinterId = quest.goblin.getX ('hinterId');
    const hinter = quest.useAs ('hinter', hinterId);
    const r = quest.use ('rethink');

    const escapeRegExp = string => {
      return string.replace (/[.*+?^${}()|[\]\\]/g, '\\$&');
    };

    const results = yield r.getAll ({
      table,
      match: {field, expr: `(?i)${escapeRegExp (value)}`},
    });
    if (results) {
      const rows = results.map (p => p[config.displayField]);
      const values = results.map (p => p.id);
      hinter.setSelections ({rows: rows, values: values, payloads: results});
    }
  });

  Goblin.registerQuest (goblinName, 'delete', function (quest) {});

  // Create a Goblin with initial state and handlers
  return Goblin.configure (goblinName, logicState, logicHandlers);
};
