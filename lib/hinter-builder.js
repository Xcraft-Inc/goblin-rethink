'use strict';

const Goblin = require ('xcraft-core-goblin');

module.exports = config => {
  const {
    type,
    table,
    field,
    detailWidget,
    detailKind,
    detailWidth,
    title,
    newWorkitem,
    newButtonTitle,
  } = config;

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
    if (!desktopId) {
      throw new Error (
        'RethinkDB Hinter must be created for a desktop, missing desktopId param ?'
      );
    }
    const desk = quest.useAs ('desktop', desktopId);

    // Create a hinter for contacts
    const hinterId = yield desk.createHinterFor ({
      type,
      workitemId: workitemId,
      detailWidget: detailWidget ? detailWidget : `${type}-detail`,
      detailKind,
      detailWidth,
      title,
      newWorkitem,
      newButtonTitle,
      usePayload: true,
    });
    quest.goblin.setX ('hinterId', hinterId);
    quest.goblin.setX ('desktopId', desktopId);
    quest.do ({id: quest.goblin.id});
    return quest.goblin.id;
  });

  Goblin.registerQuest (goblinName, 'search', function* (quest, value) {
    const hinterId = quest.goblin.getX ('hinterId');
    const hinter = quest.useAs ('hinter', hinterId);
    const i = quest.openInventory ();
    const desktopId = quest.goblin.getX ('desktopId');
    const r = i.use (`rethink@${desktopId}`);

    const escapeRegExp = string => {
      return string.replace (/[.*+?^${}()|[\]\\]/g, '\\$&');
    };

    let results = yield r.getAll ({
      table,
      match: {field, expr: `(?i)${escapeRegExp (value)}`},
    });
    if (results) {
      results = results.filter (r => r.meta.status !== 'archived');
      const rows = results.map (p => p[config.displayField]);
      const values = results.map (p => p.id);
      hinter.setSelections ({
        rows: rows,
        values: values,
        payloads: results,
        usePayload: true,
      });
    }
  });

  Goblin.registerQuest (goblinName, 'delete', function (quest) {});

  // Create a Goblin with initial state and handlers
  return Goblin.configure (goblinName, logicState, logicHandlers);
};
