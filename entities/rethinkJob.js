'use strict';
const {buildEntity} = require('goblin-workshop');
const jobTemplate = require('./data/jobTemplate.js');

const entity = {
  type: 'rethinkJob',
  values: {},
  properties: {
    name: {type: 'string', defaultValue: null},
    source: {type: 'string', defaultValue: jobTemplate},
  },
  summaries: {
    info: {type: 'string', defaultValue: ''},
  },
  buildSummaries: function (quest, job) {
    let info = job.get('name');
    return {
      info,
    };
  },
  indexer: function (quest, job) {
    const info = job.get('meta.summaries.info', '');
    return {info};
  },
  onNew: function (quest, desktopId, id, name, source) {
    return {
      id,
      name,
      source,
    };
  },
};

module.exports = {
  entity,
  service: buildEntity(entity),
};
