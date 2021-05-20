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
      lines: [],
      printStatus: '',
    });
  },
  update: (state, action) => {
    return state.set('src', action.get('src'));
  },
  print: (state, action) => {
    return state.push('lines', JSON.stringify(action.get('line'), null, 0));
  },
  printStatus: (state, action) => {
    return state.set('printStatus', `...${action.get('printCounter')}`);
  },
  run: (state, action) => {
    return state.set('res', JSON.stringify(action.get('res'), null, 2));
  },
  clearLastRun: (state) => {
    return state.set('lines', []).set('res', '');
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
  quest.dispatch('clearLastRun');
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
  const ended = next.parallel();
  let printCounter = 0;
  worker.on('message', (res) => {
    switch (res.type) {
      case 'data': {
        quest.do({res: res.data});
        break;
      }
      case 'print': {
        //TODO: param.
        if (printCounter < 100) {
          quest.dispatch('print', {line: res.line});
        } else {
          quest.dispatch('printStatus', {printCounter});
        }
        printCounter++;
        break;
      }
      case 'error': {
        quest.dispatch('print', {line: res.message});
        ended();
        break;
      }
      case 'end': {
        ended();
        break;
      }
    }
  });
  yield next.sync();
  console.log('done');
});

Goblin.registerQuest(goblinName, 'delete', function (quest) {});

// Singleton
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
