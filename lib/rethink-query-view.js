'use strict';
const goblinName = 'rethink-query-view';
const watt = require('gigawatts');
const Goblin = require('xcraft-core-goblin');
const {r} = require('rethinkdb-ts');
const logicState = {};
const logicHandlers = {
  create: (state, action) => {
    return state.set('id', action.get('id')).set('view', []);
  },
  initialize: (state, action) => {
    const initialState = action.get('initialState');
    return state.set('view', initialState);
  },
  onChanges: (state, action) => {
    const {old_val, new_val} = action.get('changes');
    return state.set(`view.${old_val.id}`, new_val);
  },
  onAdd: (state, action) => {
    const {new_val} = action.get('changes');
    return state.set(`view.${new_val.id}`, new_val);
  },
  onRemove: (state, action) => {
    const {old_val} = action.get('changes');
    return state.del(`view.${old_val.id}`);
  },
};

function* connectIfNeeded(quest) {
  if (r.getPoolMaster()) {
    return;
  }
  const _r = quest.getStorage('rethink');
  const {host, port, db} = yield _r.getConfiguration();
  yield r.connectPool({
    db,
    servers: [{host, port}],
    pingInterval: 60 * 60 * 1000,
  });
}

Goblin.registerQuest(goblinName, 'create', function (quest) {
  quest.do();
  return quest.goblin.id;
});

Goblin.registerQuest(goblinName, 'start', function* (
  quest,
  query,
  queryArgs,
  next
) {
  const existingCursor = quest.goblin.getX('cursor');
  if (existingCursor) {
    return;
  }

  yield* connectIfNeeded(quest);

  const _query = new Function('return ' + query.toString())();
  const args = queryArgs || [];
  let q = _query(r, ...args);
  q = q.changes({
    includeInitial: true,
    includeStates: true,
    includeTypes: true,
    squash: 0.5,
  });

  const cursor = yield q.run();
  quest.goblin.setX('cursor', cursor);
  const resp = quest.newResponse();
  const goblinId = quest.goblin.id;
  const ready = next.parallel();
  const initialState = {};
  cursor.on(
    'data',
    watt(function* (changes, next) {
      const {type, state, new_val} = changes;
      switch (type) {
        case 'state': {
          if (state === 'ready') {
            ready();
            break;
          }
          break;
        }
        case 'initial':
          initialState[new_val.id] = new_val;
          break;
        case 'change':
          yield resp.command.send(`${goblinName}.onChanges`, {
            id: goblinId,
            changes,
          });
        case 'add':
          yield resp.command.send(`${goblinName}.onAdd`, {
            id: goblinId,
            changes,
          });
        case 'remove':
          yield resp.command.send(`${goblinName}.onRemove`, {
            id: goblinId,
            changes,
          });
      }
    })
  );
  yield next.sync();
  yield quest.me.initialize({initialState});
});

Goblin.registerQuest(goblinName, 'initialize', function (quest, initialState) {
  quest.do({initialState});
});

Goblin.registerQuest(goblinName, 'onChanges', function (quest, changes) {
  quest.do({changes});
});

Goblin.registerQuest(goblinName, 'onAdd', function (quest, changes) {
  quest.do({changes});
});

Goblin.registerQuest(goblinName, 'onRemove', function (quest, changes) {
  quest.do({changes});
});

Goblin.registerQuest(goblinName, 'delete', function* (quest, next) {
  const cursor = quest.goblin.getX('cursor');
  if (cursor) {
    try {
      yield cursor.close(next);
    } catch (err) {
      quest.log.err(err);
    }
  }
});

module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
