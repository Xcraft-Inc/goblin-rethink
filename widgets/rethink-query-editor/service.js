'use strict';

const goblinName = 'rethink-query-editor';
const vm = require('vm');

const Goblin = require('xcraft-core-goblin');

// Define initial logic values
const logicState = {};

// Define logic handlers according rc.json
const logicHandlers = {
  create: (state, action) => {
    return state.set('', {
      id: action.get('id'),
      src: '',
      res: '',
      srcErrors: '',
    });
  },
  update: (state, action) => {
    return state.set('src', action.get('src'));
  },
  run: (state, action) => {
    return state.set('res', JSON.stringify(action.get('res'), null, 2));
  },
};

Goblin.registerQuest(goblinName, 'create', function (quest) {
  quest.do();
  return quest.goblin.id;
});

Goblin.registerQuest(goblinName, 'update', function (quest, src) {
  quest.do({src});
});

Goblin.registerQuest(goblinName, 'run', function* (quest, next) {
  const context = {quest};
  vm.createContext(context);
  const src = quest.goblin.getState().get('src');

  const {fork} = require('child_process');
  const path = require('path');
  const worker = fork(path.join(__dirname, 'worker.js'), [], {
    execArgv: ['--inspect=' + (process.debugPort + 1)],
  });
  const msg = {
    host: 'localhost',
    port: '28015',
    queryFileName: 'test.rdb',
    querySrc: src,
  };
  worker.send(msg);
  const res = yield worker.on('message', next.arg(0));
  switch (res.type) {
    case 'data': {
      quest.do({res: res.data});
      break;
    }
    case 'error': {
      quest.do({res: res.message});
      break;
    }
  }
});

Goblin.registerQuest(goblinName, 'delete', function (quest) {});

// Singleton
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
