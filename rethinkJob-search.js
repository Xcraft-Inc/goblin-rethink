'use strict';

const T = require('goblin-nabu/widgets/helpers/t.js');
const {buildWorkitem, editSelectedEntityQuest} = require('goblin-workshop');

const config = {
  name: 'rethinkJob-search',
  type: 'rethinkJob',
  kind: 'search',
  title: T('Extractions RethinkDB'),
  list: 'rethinkJob',
  detailWidget: 'rethinkJob-workitem',
  hinters: {
    rethinkJob: {
      onValidate: editSelectedEntityQuest('rethinkJob-workitem'),
    },
  },
};

exports.xcraftCommands = function () {
  return buildWorkitem(config);
};
