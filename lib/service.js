'use strict';

const goblinName = 'rethink';
const Goblin = require('xcraft-core-goblin');
const r = require('rethinkdb');

const connect = (host, db, next) => r.connect({host, db}, next);

const run = (quest, expr, next) => expr.run(quest.goblin.getX('conn'), next);
const runWith = (quest, conn, expr, next) => expr.run(conn, next);

// Define initial logic values
const logicState = {};

// Define logic handlers according rc.json
const logicHandlers = {
  create: (state, action) => {
    return state.set('id', action.get('id'));
  },
  'start-quest-on-changes': (state, action) => {
    return state.set(`cursors.${action.get('table')}`, {
      table: action.get('table'),
      quest: action.get('onChangeQuest'),
    });
  },
  'stop-on-changes': (state, action) => {
    return state.del(`cursors.${action.get('table')}`);
  },
};

// Register quest's according rc.json
Goblin.registerQuest(goblinName, 'create', function*(
  quest,
  host,
  database,
  next
) {
  quest.do();
  yield quest.me.connect({host, database});

  quest.goblin.defer(
    quest.sub('*.hard-deleted', (err, msg) => {
      const document = msg.data.document;
      if (document && document.id && document.meta && document.meta.type) {
        quest.me.set({table: 'deleted', documents: document});
        quest.me.del({table: document.meta.type, documentId: document.id});
      }
    })
  );
  return quest.goblin.id;
});

Goblin.registerQuest(goblinName, 'connect', function*(
  quest,
  host,
  database,
  next
) {
  try {
    //FIXME: manage host via etc
    const conn = yield connect(host, database, next);
    conn.on('error', err => {
      quest.log.warn(err);
      conn.reconnect();
    });
    quest.goblin.defer(conn.close);
    quest.goblin.setX('conn', conn);
    quest.goblin.setX('db', database);
    quest.goblin.setX('host', host);
  } catch (ex) {
    quest.log.warn(ex.stack || ex);
    let timeout = quest.goblin.getX('connTimeout');
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => quest.me.connect({host, database}), 500);
    quest.goblin.setX('connTimeout', timeout);
    return;
  }
});

Goblin.registerQuest(goblinName, 'copyTableFromDb', function*(
  quest,
  fromDb,
  table,
  next
) {
  const conn = yield connect(quest.goblin.getX('host'), null, next);

  yield quest.me.ensureTable({table});

  const q = r
    .db(quest.goblin.getX('db'))
    .table(table)
    .insert(r.db(fromDb).table(table));

  yield runWith(quest, conn, q, next);

  yield conn.close({noreplyWait: true}, next);
});

Goblin.registerQuest(goblinName, 'listTableFromDb', function*(
  quest,
  fromDb,
  next
) {
  const conn = yield connect(quest.goblin.getX('host'), null, next);
  let q = r.db(fromDb).tableList();
  const list = yield runWith(quest, conn, q, next);
  yield conn.close({noreplyWait: true}, next);
  return list;
});

Goblin.registerQuest(goblinName, 'listDb', function*(quest, next) {
  const conn = yield connect(quest.goblin.getX('host'), null, next);
  let q = r.dbList();
  const list = yield runWith(quest, conn, q, next);
  yield conn.close({noreplyWait: true}, next);
  return list;
});

Goblin.registerQuest(goblinName, 'get', function*(
  quest,
  table,
  documentId,
  next
) {
  let q = r.table(table).get(documentId);
  return yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'getIn', function*(
  quest,
  table,
  documentId,
  path,
  next
) {
  let q = r.table(table).get(documentId);
  for (const field of path) {
    q = q(field);
  }
  q = q.default(null);
  return yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'set', function*(
  quest,
  table,
  documents,
  next
) {
  let q = r.table(table).insert(documents, {conflict: 'replace'});
  return yield run(quest, q, next);
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

Goblin.registerQuest(goblinName, 'setIn', function*(
  quest,
  table,
  documentId,
  path,
  value,
  next
) {
  let q = r.table(table).get(documentId);
  const updater = {};
  buildUpdater(updater, path, value);
  q = q.update(updater);
  return yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'del', function*(
  quest,
  table,
  documentId,
  next
) {
  let q = r
    .table(table)
    .get(documentId)
    .delete();
  return yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'getAllIds', function*(quest, table, next) {
  let q = r
    .table(table)('id')
    .distinct();
  return yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'getBaseList', function*(
  quest,
  table,
  orderBy,
  status,
  next
) {
  const documentStatus = status || ['published'];
  let q = r
    .table(table)
    .getAll(r.args(documentStatus), {index: 'status'})
    .orderBy(orderBy || {index: 'id'})('id');
  return yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'getAllById', function*(
  quest,
  table,
  documents,
  status,
  next
) {
  const documentStatus = status || ['published'];
  let q = r
    .table(table)
    .getAll(r.args(documentStatus), {index: 'status'})
    .orderBy({index: 'id'});
  return yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'getAll', function*(
  quest,
  table,
  documents,
  status,
  filter,
  match,
  next
) {
  let q = r.table(table);
  if (documents) {
    q = q.getAll(r.args(documents));
  }

  if (status) {
    q = q.getAll(r.args(status), {index: 'status'});
  }

  if (filter) {
    q = q.filter(filter);
  }

  if (match) {
    q = q.filter(doc => doc(match.field).match(match.expr));
  }
  const cursor = yield run(quest, q, next);
  return yield cursor.toArray(next);
});

Goblin.registerQuest(goblinName, 'getFirst', function*(
  quest,
  table,
  filter,
  match,
  status
) {
  const rows = yield quest.me.getAll({table, filter, match, status});
  return rows[0];
});

Goblin.registerQuest(goblinName, 'count', function*(
  quest,
  table,
  status,
  next
) {
  let q = r.table(table).count();
  if (status) {
    const documentStatus = status || ['published'];
    q = r
      .table(table)
      .getAll(r.args(documentStatus), {index: 'status'})
      .count();
  }
  return yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'joinAndMap', function*(
  quest,
  table,
  join,
  mapper,
  next
) {
  const map = new Function('return ' + mapper.toString())();
  let q = r
    .table(table)
    .eqJoin(join.reference, r.table(join.table))
    .map(map);
  const cursor = yield run(quest, q, next);
  return yield cursor.toArray(next);
});

Goblin.registerQuest(goblinName, 'query', function*(quest, query, args, next) {
  const _query = new Function('return ' + query.toString())();
  const q = _query(r, ...args);
  const cursor = yield run(quest, q, next);
  return yield cursor.toArray(next);
});

Goblin.registerQuest(goblinName, 'start-quest-on-changes', function*(
  quest,
  table,
  onChangeQuest,
  goblinId,
  documents,
  status,
  filter,
  next
) {
  if (!goblinId) {
    throw new Error('You must provide a goblinId for this change feed');
  }
  const disposeSub = quest.sub(`${goblinId}.disposed`, () => {
    quest.me.stopOnChanges({goblinId});
    //unsub
    quest.goblin.getX(`disposeSub-${goblinId}`)();
  });

  quest.goblin.setX(`disposeSub-${goblinId}`, disposeSub);

  let q = r.table(table);

  if (documents && documents.length > 0) {
    q = q.getAll(r.args(documents));
  }

  if (status && status.length > 0) {
    q = q.getAll(r.args(status), {index: 'status'});
  }

  if (filter) {
    q = q.filter(filter);
  }

  q = q.changes({
    includeInitial: true,
    includeStates: true,
    includeTypes: true,
    squash: 0.5,
  });

  let cursor = quest.goblin.getX(`${goblinId}-cursor`);
  if (!cursor) {
    cursor = yield run(quest, q, next);
  }

  quest.goblin.setX(`${goblinId}-cursor`, cursor);
  quest.do();
  quest.cmd('rethink.start-listen-changes', {
    id: quest.goblin.id,
    cursorName: `${goblinId}-cursor`,
    goblinId,
    onChangeQuest,
  });
});

Goblin.registerQuest(goblinName, 'stop-on-changes', function*(
  quest,
  goblinId,
  next
) {
  const cursor = quest.goblin.getX(`${goblinId}-cursor`);
  if (!cursor) {
    return;
  }

  const msgId = quest.goblin.getX(`${goblinId}-cursor-msgid`);

  try {
    yield cursor.close(next);
    quest.evt.send(`start-listen-changes.${msgId}.finished`);
  } catch (err) {
    quest.log.err(err);
  } finally {
    quest.goblin.delX(`${goblinId}-cursor`);
    quest.do();
  }
});

Goblin.registerQuest(goblinName, 'start-listen-changes', function*(
  quest,
  cursorName,
  onChangeQuest,
  goblinId,
  $msg,
  next
) {
  quest.goblin.setX(`${cursorName}-msgid`, $msg.id);

  const cursor = quest.goblin.getX(cursorName);
  if (!cursor) {
    return;
  }

  try {
    const change = yield cursor.next(next);

    // CALL onChangeQuest with id and change
    quest.cmd(onChangeQuest, {id: goblinId, change});

    // RECURSE
    quest.cmd('rethink.start-listen-changes', {
      id: quest.goblin.id,
      cursorName,
      onChangeQuest,
      goblinId,
    });
  } catch (err) {
    quest.log.err(err);
  }
});

Goblin.registerQuest(goblinName, 'ensure-table', function*(quest, table, next) {
  let q = r.tableList();
  const list = yield run(quest, q, next);
  if (list.indexOf(table) === -1) {
    q = r.tableCreate(table);
    yield run(quest, q, next);
  }
});

Goblin.registerQuest(goblinName, 'ensure-index', function*(quest, table, next) {
  let q = r.table(table).indexList();
  const list = yield run(quest, q, next);
  if (list.indexOf('status') === -1) {
    q = r.table(table).indexCreate('status', r.row('meta')('status'));
    yield run(quest, q, next);
    let w = r.table(table).indexWait('status');
    yield run(quest, w, next);
  }
});

Goblin.registerQuest(goblinName, 'ensure-database', function*(quest, next) {
  const db = quest.goblin.getX('db');
  let q = r.dbList();
  const dbList = yield run(quest, q, next);
  if (dbList.indexOf(db) === -1) {
    q = r.dbCreate(db);
    yield run(quest, q, next);
  }
});

Goblin.registerQuest(goblinName, 'reset-database', function*(quest, next) {
  const db = quest.goblin.getX('db');
  let q = r.dbList();
  const dbList = yield run(quest, q, next);
  if (dbList.indexOf(db) !== -1) {
    q = r.dbDrop(db);
    yield run(quest, q, next);
  }
  q = r.dbCreate(db);
  yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'delete', function*(quest, next) {
  try {
    const timeout = quest.goblin.getX('connTimeout');
    if (timeout) {
      clearTimeout(timeout);
    }
    const conn = quest.goblin.getX('conn');
    conn.removeAllListeners();
    if (conn.open) {
      let cursors = quest.goblin.getState().get('cursors', null);
      if (cursors) {
        cursors = cursors.toJS();
        for (const cur in cursors) {
          yield quest.me.stopOnChanges({table: cur});
        }
      }
      yield conn.close({noreplyWait: true}, next);
      console.log('RethinkDB connection closed!');
    }
  } catch (err) {
    quest.log.err(err);
  }
});

// Create a Goblin with initial state and handlers
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
