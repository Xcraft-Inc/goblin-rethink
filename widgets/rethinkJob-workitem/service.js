'use strict';

const {buildWorkitem} = require('goblin-workshop');
const T = require('goblin-nabu/widgets/helpers/t.js');
const Shredder = require('xcraft-core-shredder');

const config = {
  type: 'rethinkJob',
  kind: 'workitem',
  buttons: function (quest, buttons) {
    buttons = buttons.valueSeq().toArray();
    buttons.push(
      Shredder.fromJS({
        id: 'invoice',
        layout: 'primary',
        glyph: 'solid/pen',
        text: T('Goblin Studio'),
        disabled: false,
        quest: 'editCode',
      })
    );

    return new Shredder(buttons);
  },
  quests: {
    editCode: function (quest, desktopId) {
      const entityId = quest.goblin.getX('entityId');
      const workitem = {
        name: 'rethink-query-editor',
        view: 'rethink-query-editor',
        description: `Goblin Studio - ${entityId}`,
        payload: {
          rethinkJobId: entityId,
        },
      };
      quest.evt(`${desktopId}.<add-workitem-requested>`, {
        workitem,
        navigate: true,
      });
    },
  },
};

module.exports = buildWorkitem(config);
