'use strict';
const {buildEntity} = require('goblin-workshop');
const jobTemplate = require('./data/jobTemplate.js');

const entity = {
  type: 'rethinkJob',
  values: {},
  properties: {
    name: {type: 'string', defaultValue: null},
    source: {type: 'string', defaultValue: jobTemplate},
    lastRun: {type: 'datetime', defaultValue: ''},
    status: {
      type: 'enum',
      values: ['good', 'bad'],
      defaultValue: 'good',
    },
    lastRunStatus: {type: 'string', defaultValue: null},
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
  quests: {
    updateLastRun: function* (quest, status) {
      const {datetime} = require('xcraft-core-converters');
      const DateConverters = datetime;
      yield quest.me.apply({
        patch: {
          lastRun: DateConverters.getNowCanonical(),
          lastRunStatus: `duration: ${status.duration}`,
          status: status.failed ? 'bad' : 'good',
        },
      });
    },
  },
};

module.exports = {
  entity,
  service: buildEntity(entity),
};
