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
    quest.goblin.setX ('db', database);
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

Goblin.registerQuest (goblinName, 'getIn', function* (
  quest,
  table,
  documentId,
  path,
  next
) {
  let q = r.table (table).get (documentId);
  for (const field of path) {
    q = q (field);
  }
  q = q.default (null);
  return yield run (quest, q, next);
});

Goblin.registerQuest (goblinName, 'set', function* (
  quest,
  table,
  documents,
  next
) {
  let q = r.table (table).insert (documents, {conflict: 'replace'});
  return yield run (quest, q, next);
});

const buildUpdater = (obj, keyPath, value) => {
  const lastKeyIndex = keyPath.length - 1;
  for (var i = 0; i < lastKeyIndex; ++i) {
    const key = keyPath[i];
    if (!(key in obj)) obj[key] = {};
    obj = obj[key];
  }
  obj[keyPath[lastKeyIndex]] = value;
};

Goblin.registerQuest (goblinName, 'setIn', function* (
  quest,
  table,
  documentId,
  path,
  value,
  next
) {
  let q = r.table (table).get (documentId);
  const updater = {};
  buildUpdater (updater, path, value);
  q = q.update (updater);
  return yield run (quest, q, next);
});

Goblin.registerQuest (goblinName, 'del', function* (
  quest,
  table,
  documentId,
  next
) {
  let q = r.table (table).get (documentId).delete ();
  return yield run (quest, q, next);
});

Goblin.registerQuest (goblinName, 'getAllIds', function* (quest, table, next) {
  let q = r.table (table) ('id').distinct ();
  return yield run (quest, q, next);
});

Goblin.registerQuest (goblinName, 'getBaseList', function* (
  quest,
  table,
  orderBy,
  next
) {
  let q = r.table (table).orderBy (orderBy || 'id') ('id');
  return yield run (quest, q, next);
});

Goblin.registerQuest (goblinName, 'getAllById', function* (
  quest,
  table,
  documents,
  next
) {
  let q = r.table (table).getAll (documents, {index: 'id'});
  return yield run (quest, q, next);
});

Goblin.registerQuest (goblinName, 'getAll', function* (
  quest,
  table,
  documents,
  filter,
  match,
  next
) {
  let q = r.table (table);
  if (documents) {
    q = q.getAll (r.args (documents));
  }
  if (filter) {
    q = q.filter (filter);
  }
  if (match) {
    q = q.filter (doc => doc (match.field).match (match.expr));
  }
  const cursor = yield run (quest, q, next);
  return yield cursor.toArray (next);
});

Goblin.registerQuest (goblinName, 'getFirst', function* (
  quest,
  table,
  filter,
  match
) {
  const rows = yield quest.me.getAll ({table, filter, match});
  return rows[0];
});

Goblin.registerQuest (goblinName, 'count', function* (quest, table, next) {
  let q = r.table (table).count ();
  return yield run (quest, q, next);
});

Goblin.registerQuest (goblinName, 'start-quest-on-changes', function* (
  quest,
  table,
  onChangeQuest,
  goblinId,
  filter,
  next
) {
  if (!goblinId) {
    throw new Error ('You must provide a goblinId for this change feed');
  }

  let q = r.table (table);

  if (filter) {
    q = q.filter (filter);
  }

  q = q.changes ({
    includeInitial: true,
    includeStates: true,
    includeTypes: true,
    squash: 0.5,
  });

  let cursor = quest.goblin.getX (`${goblinId}-cursor`);
  if (!cursor) {
    cursor = yield run (quest, q, next);
  }

  quest.goblin.setX (`${goblinId}-cursor`, cursor);
  quest.do ();
  quest.cmd ('rethink.start-listen-changes', {
    id: quest.goblin.id,
    cursorName: `${goblinId}-cursor`,
    goblinId,
    onChangeQuest,
  });
});

Goblin.registerQuest (goblinName, 'stop-on-changes', function* (
  quest,
  goblinId,
  next
) {
  const cursor = quest.goblin.getX (`${goblinId}-cursor`);
  if (!cursor) {
    return;
  }
  try {
    yield cursor.close (next);
  } catch (err) {
    quest.log.err (err);
  } finally {
    quest.goblin.delX (`${goblinId}-cursor`);
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

Goblin.registerQuest (goblinName, 'ensure-table', function* (
  quest,
  table,
  next
) {
  let q = r.tableList ();
  const list = yield run (quest, q, next);
  if (list.indexOf (table) === -1) {
    q = r.tableCreate (table);
    yield run (quest, q, next);
  }
});

Goblin.registerQuest (goblinName, 'ensure-database', function* (quest, next) {
  const db = quest.goblin.getX ('db');
  let q = r.dbList ();
  const dbList = yield run (quest, q, next);
  if (dbList.indexOf (db) === -1) {
    q = r.dbCreate (db);
    yield run (quest, q, next);
  }
});

Goblin.registerQuest (goblinName, 'reset-database', function* (quest, next) {
  const db = quest.goblin.getX ('db');
  let q = r.dbList ();
  const dbList = yield run (quest, q, next);
  if (dbList.indexOf (db) !== -1) {
    q = r.dbDrop (db);
    yield run (quest, q, next);
  }
  q = r.dbCreate (db);
  yield run (quest, q, next);
});

Goblin.registerQuest (goblinName, 'delete', function* (quest, next) {
  try {
    const conn = quest.goblin.getX ('conn');
    if (conn.open) {
      let cursors = quest.goblin.getState ().get ('cursors', null);
      if (cursors) {
        cursors = cursors.toJS ();
        for (const cur in cursors) {
          yield quest.me.stopOnChanges ({table: cur});
        }
      }
      yield conn.close ({noreplyWait: true}, next);
      console.log ('RethinDB connection closed!');
    }
  } catch (err) {
    quest.log.err (err);
  }
});

// Create a Goblin with initial state and handlers
module.exports = Goblin.configure (goblinName, logicState, logicHandlers);
