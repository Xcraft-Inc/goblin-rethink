'use strict';

const goblinName = 'rethink';
const Goblin = require ('xcraft-core-goblin');
const r = require ('rethinkdb');

const connect = (host, db, next) => r.connect ({host, db}, next);
const run = (quest, expr, next) => expr.run (quest.goblin.getX ('conn'), next);

// Define initial logic values
const logicState = {};

// Define logic handlers according rc.json
const logicHandlers = {
  create: state => {
    return state;
  },
  'start-quest-on-changes': (state, action) => {
    return state.set (`cursors.${action.get ('table')}`, {
      table: action.get ('table'),
      quest: action.get ('onChangeQuest'),
    });
  },
  'stop-on-changes': (state, action) => {
    return state.del (`cursors.${action.get ('table')}`);
  },
};

// Register quest's according rc.json
Goblin.registerQuest (goblinName, 'create', function* (
  quest,
  host,
  database,
  next
) {
  try {
    //FIXME: manage host via etc
    const conn = yield connect (host, database, next);
    quest.goblin.defer (conn.close);
    quest.goblin.setX ('conn', conn);
  } catch (err) {
    quest.log.err (err.stack);
    throw new Error ('RethinkDB connection failed');
  }
  return quest.goblin.id;
});

Goblin.registerQuest (goblinName, 'get', function* (
  quest,
  table,
  documentId,
  next
) {
  let q = r.table (table).get (documentId);
  return yield run (quest, q, next);
});

Goblin.registerQuest (goblinName, 'getAll', function* (
  quest,
  table,
  filter,
  match,
  next
) {
  let q = r.table (table);
  if (filter) {
    q = q.filter (filter);
  }
  if (match) {
    q = q.filter (doc => doc (match.field).match (match.expr));
  }
  const cursor = yield run (quest, q, next);
  return yield cursor.toArray (next);
});

Goblin.registerQuest (goblinName, 'start-quest-on-changes', function* (
  quest,
  table,
  onChangeQuest,
  goblinId,
  filter,
  next
) {
  let q = r.table (table);

  if (filter) {
    q = q.filter (filter);
  }

  q = q.changes ({
    includeInitial: true,
    includeStates: true,
    includeTypes: true,
  });

  const cursor = yield run (quest, q, next);

  quest.goblin.setX (`${table}-cursor`, cursor);
  quest.do ();
  quest.cmd ('rethink.start-listen-changes', {
    id: quest.goblin.id,
    cursorName: `${table}-cursor`,
    goblinId,
    onChangeQuest,
  });
});

Goblin.registerQuest (goblinName, 'stop-on-changes', function* (quest, table) {
  const cursor = quest.goblin.getX (`${table}-cursor`);
  if (!cursor) {
    return;
  }
  try {
    yield cursor.close ();
  } catch (err) {
    quest.log.err (err);
  } finally {
    quest.goblin.delX (`${table}-cursor`);
    quest.do ();
  }
});

Goblin.registerQuest (goblinName, 'start-listen-changes', function* (
  quest,
  cursorName,
  onChangeQuest,
  goblinId,
  next
) {
  const cursor = quest.goblin.getX (cursorName);
  if (!cursor) {
    return;
  }
  try {
    const change = yield cursor.next (next);

    // CALL onChangeQuest with id and change
    quest.cmd (onChangeQuest, {id: goblinId, change});

    // RECURSE
    quest.cmd ('rethink.start-listen-changes', {
      id: quest.goblin.id,
      cursorName,
      onChangeQuest,
      goblinId,
    });
  } catch (err) {
    quest.log.err (err);
  }
});

Goblin.registerQuest (goblinName, 'delete', function* (quest) {
  try {
    const conn = quest.goblin.getX ('conn');
    if (conn.open) {
      const cursors = quest.goblin.getState ().get ('cursors').toJS ();
      for (const cur in cursors) {
        yield quest.me.stopOnChanges ({table: cur});
      }
      yield conn.close ();
    }
  } catch (err) {
    quest.log.err (err);
  }
});

// Create a Goblin with initial state and handlers
module.exports = Goblin.configure (goblinName, logicState, logicHandlers);
