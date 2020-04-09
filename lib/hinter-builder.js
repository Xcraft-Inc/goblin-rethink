'use strict';

const Goblin = require('xcraft-core-goblin');

module.exports = (config) => {
  const {
    type,
    field,
    detailWidget,
    detailKind,
    detailWidth,
    title,
    newWorkitem,
    newButtonTitle,
  } = config;

  const goblinName = `${type}-hinter`;

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

  Goblin.registerQuest(goblinName, 'create', function* (
    quest,
    desktopId,
    hinterName,
    workitemId,
    withDetails
  ) {
    if (!desktopId) {
      throw new Error(
        'RethinkDB Hinter must be created for a desktop, missing desktopId param ?'
      );
    }
    if (!hinterName) {
      throw new Error('hinter name not provided');
    }
    const workshopAPI = quest.getAPI('workshop');

    const hinterId = yield workshopAPI.createHinterFor({
      desktopId,
      name: hinterName,
      type,
      workitemId: workitemId,
      detailWidget: detailWidget ? detailWidget : `${type}-workitem`,
      detailKind,
      detailWidth,
      title,
      newWorkitem,
      newButtonTitle,
      usePayload: true,
      withDetails,
    });
    quest.goblin.setX('hinterId', hinterId);
    quest.goblin.setX('desktopId', desktopId);
    quest.do({id: quest.goblin.id});
    return quest.goblin.id;
  });

  Goblin.registerQuest(goblinName, 'set-status', function* (quest, status) {
    const hinterAPI = quest.getAPI(quest.goblin.getX('hinterId'));
    yield hinterAPI.setFilters({filters: status});
  });

  Goblin.registerQuest(goblinName, 'search', function* (quest, value) {
    const hinterId = quest.goblin.getX('hinterId');
    const hinter = quest.getAPI(hinterId, 'hinter');
    const r = quest.getStorage('rethink');

    const escapeRegExp = (string) => {
      return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };

    let results = yield r.getAll({
      table: type,
      match: {field, expr: `(?i)${escapeRegExp(value)}`},
    });
    if (results) {
      const status = results.map((r) => r.meta.status);
      const glyphs = results.map((r) => r.meta.summaries.glyph || null);
      let rows = null;
      if (config.displayField) {
        rows = results.map((p) => p[config.displayField]);
      } else {
        rows = results.map((p) => p.meta.summaries.description);
      }
      const values = results.map((p) => p.id);
      hinter.setSelections({
        rows: rows,
        values: values,
        status: status,
        glyphs: glyphs,
        payloads: results,
        usePayload: true,
      });
    }
  });

  Goblin.registerQuest(goblinName, 'delete', function (quest) {});

  // Create a Goblin with initial state and handlers
  return Goblin.configure(goblinName, logicState, logicHandlers);
};
