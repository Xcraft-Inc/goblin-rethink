'use strict';

const goblinName = 'rethink-query-editor';
const Goblin = require('xcraft-core-goblin');
const {mkdir} = require('xcraft-core-fs');
const path = require('path');
const jobTemplate = require('../../entities/data/jobTemplate.js');

// Define initial logic values
const logicState = {};

// Define logic handlers according rc.json
const logicHandlers = {
  create: (state, action) => {
    return state.set('', {
      id: action.get('id'),
      jobId: action.get('jobId'),
      name: action.get('name'),
      source: action.get('source'),
      isRunning: false,
      lines: [],
      printStatus: '',
    });
  },
  update: (state, action) => {
    return state.set('source', action.get('src'));
  },
  print: (state, action) => {
    return state.push('lines', JSON.stringify(action.get('line'), null, 0));
  },
  printStatus: (state, action) => {
    return state.set('printStatus', `...${action.get('printCounter')}`);
  },
  run: (state) => {
    return state;
  },
  save: (state, action) => {
    return state.set('jobId', action.get('jobId'));
  },
  clearLastRun: (state) => {
    return state.set('lines', []);
  },
  setRunning: (state, action) => {
    return state.set('isRunning', action.get('isRunning'));
  },
};

Goblin.registerQuest(goblinName, 'create', function* (
  quest,
  desktopId,
  rethinkJobId = null
) {
  const workshopAPI = quest.getAPI('workshop');
  const storageRootPath = yield workshopAPI.getMandateStorageRootPath({
    desktopId,
  });

  if (storageRootPath) {
    const exportPath = path.join(storageRootPath, 'exports', 'ETL');
    mkdir(exportPath);
    quest.goblin.setX('exportPath', exportPath);
    //TODO: list files
  }

  let source = jobTemplate;
  let name = 'newJob';
  if (rethinkJobId) {
    const jobAPI = quest.getAPI(rethinkJobId);
    const jobData = yield jobAPI.get();
    source = jobData.get('source');
    name = jobData.get('name');
  }
  quest.do({jobId: rethinkJobId, source, name});
  return quest.goblin.id;
});

Goblin.registerQuest(goblinName, 'update', function (quest, src) {
  quest.do({src});
});

Goblin.registerQuest(goblinName, 'save', function* (quest, desktopId) {
  const {source, jobId} = quest.goblin.getState().pick('source', 'jobId');
  if (!jobId) {
    const jobId = `rethinkJob@${quest.uuidV4()}`;
    yield quest.createEntity(jobId, {name: 'new job', source});
    quest.do({jobId});
  } else {
    const jobAPI = yield quest.create('rethinkJob', {id: jobId, desktopId});
    yield jobAPI.change({path: 'source', newValue: source});
  }
});

Goblin.registerQuest(goblinName, 'run', function* (quest, next) {
  const state = quest.goblin.getState();
  if (state.get('isRunning')) {
    return;
  }
  quest.dispatch('setRunning', {isRunning: true});
  quest.dispatch('clearLastRun');
  yield quest.doSync();
  try {
    const jobId = quest.uuidV4();
    quest.goblin.setX('currentJobId', jobId);
    const src = quest.goblin.getState().get('source');
    const print = (payload) => quest.dispatch('print', payload);
    const printStatus = (payload) => quest.dispatch('printStatus', payload);

    const jobRunner = require('../../lib/etl/jobRunner.js').instance;
    yield jobRunner.run({
      jobId,
      exportPath: quest.goblin.getX('exportPath'),
      mandate: quest.getSession(),
      src,
      print,
      printStatus,
    });
    quest.goblin.setX('currentJobId', null);
  } finally {
    quest.dispatch('setRunning', {isRunning: false});
  }
});

Goblin.registerQuest(goblinName, 'delete', function (quest) {
  const current = quest.goblin.getX('currentJobId');
  if (current) {
    const jobRunner = require('../../lib/etl/jobRunner.js').instance;
    jobRunner.kill(current);
  }
});

// Singleton
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
