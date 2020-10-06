'use strict';

const goblinName = 'rethink';
const watt = require('gigawatts');
const Goblin = require('xcraft-core-goblin');
const {CursorPump} = require('xcraft-core-utils');
const busClient = require('xcraft-core-busclient').getGlobal();
const defaultReadMode = 'outdated';
const {r} = require('rethinkdb-ts');

const run = watt(function* (quest, expr) {
  let time = process.hrtime();
  const result = yield expr.run();
  time = process.hrtime(time);
  const delta = (time[0] * 1e9 + time[1]) / 1e6;
  if (delta > 50) {
    const caller = quest.msg.data //
      ? quest.msg.data._goblinCaller
      : 'unknown';
    const callerQuest = quest.msg.data
      ? quest.msg.data._goblinCallerQuest
      : 'unknown';
    quest.log.warn(
      `query from ${caller}.${callerQuest}, time:${delta.toFixed(3)} [ms]`
    );
  }
  return result;
});

const runCursor = watt(function* (quest, expr) {
  return yield expr.getCursor();
});

// Define initial logic values
const logicState = {};

// Define logic handlers according rc.json
const logicHandlers = {
  'create': (state, action) => {
    return state.set('id', action.get('id'));
  },
  'start-quest-on-changes': (state, action) => {
    return state.set(`cursors.${action.get('table')}`, {
      goblinId: action.get('goblinId'),
      table: action.get('table'),
      quest: action.get('onChangeQuest'),
    });
  },
  'stop-on-changes': (state, action) => {
    return state.del(`cursors.${action.get('table')}`);
  },
};

/**
 * Apply an index to a query.
 *
 * If the index's name contains an underscore '_', then the value is
 * considered to be used for a compound index. In this case the array is
 * just applied without r.args().
 * Otherwise, it means that the value is an array of values for the
 * simple index.
 *
 * @param {Object} r - Driver instance.
 * @param {Object} q - Query handler.
 * @param {Object} contentIndex - Index or compound index.
 * @returns {Object} the query
 */
function applyContentIndex(r, q, contentIndex) {
  if (!contentIndex) {
    return q;
  }

  if (contentIndex.value) {
    return q.getAll(
      contentIndex.name.indexOf('_') > 0
        ? contentIndex.value
        : r.args(contentIndex.value),
      {index: contentIndex.name}
    );
  }

  return q;
}

// Register quest's according rc.json
Goblin.registerQuest(goblinName, 'create', function* (quest, host, database) {
  quest.goblin.setX('resp', busClient.newResponse(quest.goblin.id, 'token'));
  quest.do();
  yield r.connectPool({
    db: database,
    servers: [{host, port: 28015}],
    pingInterval: 60 * 60 * 1000,
    log: (msg) => console.log(msg),
  });
  /*r.getPoolMaster().on('healthy', function (healthy) {
    if (!healthy) {
     //!!!
    }
  });*/
  quest.goblin.setX('db', database);
  return quest.goblin.id;
});

Goblin.registerQuest(goblinName, 'copyTableFromDb', function* (
  quest,
  fromDb,
  table,
  status,
  next
) {
  yield quest.me.ensureTable({table});
  const q = r
    .db(quest.goblin.getX('db'))
    .table(table, {readMode: defaultReadMode})
    .insert(
      r
        .db(fromDb)
        .table(table, {readMode: defaultReadMode})
        .getAll(r.args(status), {index: 'status'})
    );

  yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'listTableFromDb', function* (
  quest,
  fromDb,
  next
) {
  let q = r.db(fromDb).tableList();
  const list = yield run(quest, q, next);
  return list;
});

Goblin.registerQuest(goblinName, 'listDb', function* (quest, next) {
  let q = r.dbList();
  const list = yield run(quest, q, next);
  return list;
});

Goblin.registerQuest(goblinName, 'get-ids', function* (
  quest,
  table,
  contentIndex,
  range,
  next
) {
  let q = r.table(table, {readMode: defaultReadMode});
  q = applyContentIndex(r, q, contentIndex);
  if (range) {
    q = q.slice(range.start, range.start + range.length);
  }

  const cursor = yield runCursor(quest, q('id'), next);
  const p = new CursorPump(cursor);
  return yield p.toArray();
});

Goblin.registerQuest(goblinName, 'get-ordered-collection-ids', function* (
  quest,
  table,
  documentId,
  collectionTable,
  collection,
  orderBy,
  range,
  next
) {
  let q = r
    .table(table, {readMode: defaultReadMode})
    .get(documentId)
    .do(function (doc) {
      return r
        .table(collectionTable, {readMode: defaultReadMode})
        .getAll(r.args(doc(collection)))
        .orderBy(orderBy);
    });

  if (range) {
    q = q.slice(range.start, range.start + range.length);
  }

  const cursor = yield runCursor(quest, q('id'), next);
  const p = new CursorPump(cursor);
  return yield p.toArray();
});

Goblin.registerQuest(goblinName, 'get-ordered-collection-count', function* (
  quest,
  table,
  documentId,
  collectionTable,
  collection,
  orderBy,
  next
) {
  let q = r
    .table(table, {readMode: defaultReadMode})
    .get(documentId)
    .do(function (doc) {
      return r
        .table(collectionTable, {readMode: defaultReadMode})
        .getAll(r.args(doc(collection)))
        .orderBy(orderBy);
    })('id')
    .count();

  return yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'get', function* (
  quest,
  table,
  documentId,
  privateState,
  next
) {
  let q = r.table(table, {readMode: defaultReadMode}).get(documentId);
  if (!privateState) {
    q = q.without('private');
  }

  let document = null;
  try {
    document = yield run(quest, q, next);
  } catch {
    quest.log.warn('document not found:', documentId);
  }
  return document;
});

Goblin.registerQuest(goblinName, 'exist', function* (
  quest,
  table,
  documentId,
  next
) {
  let q = r.table(table, {readMode: defaultReadMode}).get(documentId).ne(null);
  return yield run(quest, q, next);
});

//View ex:
// [{'meta':{'summaries':['info']}},'status']
Goblin.registerQuest(goblinName, 'get-view', function* (
  quest,
  table,
  documents,
  view,
  next
) {
  let q = r
    .table(table, {readMode: defaultReadMode})
    .getAll(r.args(documents))
    .pluck('id', r.args(view));

  return yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'getIn', function* (
  quest,
  table,
  documentId,
  path,
  next
) {
  let q = r.table(table, {readMode: defaultReadMode}).get(documentId);
  for (const field of path) {
    q = q(field);
  }
  q = q.default(null);
  return yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'set', function* (
  quest,
  table,
  documents,
  next
) {
  let q = r
    .table(table, {readMode: defaultReadMode})
    .insert(documents, {conflict: 'replace', durability: 'soft'});
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

Goblin.registerQuest(goblinName, 'setIn', function* (
  quest,
  table,
  documentId,
  path,
  value,
  next
) {
  let q = r.table(table, {readMode: defaultReadMode}).get(documentId);
  const updater = {};
  buildUpdater(updater, path, value);
  q = q.update(updater);
  return yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'del', function* (
  quest,
  table,
  documentId,
  next
) {
  let q = r.table(table, {readMode: defaultReadMode}).get(documentId).delete();
  return yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'getAllIds', function* (quest, table, next) {
  let q = r.table(table, {readMode: defaultReadMode})('id').distinct();
  return yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'getAllById', function* (
  quest,
  table,
  documents,
  status,
  next
) {
  const documentStatus = status || ['published'];
  let q = r
    .table(table, {readMode: defaultReadMode})
    .getAll(r.args(documentStatus), {index: 'status'})
    .orderBy({index: 'id'});
  return yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'getAll', function* (
  quest,
  table,
  documents,
  status,
  filter,
  match,
  orderBy,
  sync,
  view,
  range,
  next
) {
  let q = r.table(table, {readMode: defaultReadMode});

  if (sync) {
    q = q.sync();
    yield run(quest, q, next);
    q = r.table(table, {readMode: defaultReadMode});
  }

  if (documents) {
    q = q.getAll(r.args(documents));
  }

  if (status) {
    q = q.getAll(r.args(status), {index: 'status'});
  }

  if (orderBy) {
    q = q.orderBy(orderBy);
  }

  if (filter) {
    q = q.filter(filter);
  }

  if (match) {
    q = q.filter((doc) => doc(match.field).match(match.expr));
  }

  if (view) {
    q = q.pluck('id', r.args(view));
  }

  if (range) {
    if (!orderBy) {
      //ensure order!
      q = q.orderBy({index: 'id'});
    }
    q = q.slice(range.start, range.start + range.length);
  }

  const cursor = yield runCursor(quest, q, next);
  const p = new CursorPump(cursor);
  return yield p.toArray();
});

Goblin.registerQuest(goblinName, 'getFirst', function* (
  quest,
  table,
  contentIndex,
  status, // overload contentIndex
  filter,
  match,
  sync,
  next
) {
  let q = r.table(table, {readMode: defaultReadMode});

  if (sync) {
    q = q.sync();
    yield run(quest, q, next);
    q = r.table(table, {readMode: defaultReadMode});
  }

  if (status) {
    q = q.getAll(r.args(status), {index: 'status'});
  } else if (contentIndex) {
    q = applyContentIndex(r, q, contentIndex);
  }

  if (filter) {
    q = q.filter(filter);
  }

  if (match) {
    q = q.filter((doc) => doc(match.field).match(match.expr));
  }

  q = q.limit(1);

  const res = yield run(quest, q, next);
  return res[0];
});

Goblin.registerQuest(goblinName, 'count', function* (
  quest,
  table,
  contentIndex,
  next
) {
  let q = r.table(table, {readMode: defaultReadMode});
  q = applyContentIndex(r, q, contentIndex).count();
  return yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'count-by', function* (
  quest,
  table,
  field,
  value,
  next
) {
  let q = r.table(table, {readMode: defaultReadMode});
  q = q.filter({[field]: value}).count();
  return yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'joinAndMap', function* (
  quest,
  table,
  join,
  mapper,
  next
) {
  const map = new Function('return ' + mapper.toString())();
  let q = r
    .table(table, {readMode: defaultReadMode})
    .eqJoin(join.reference, r.table(join.table, {readMode: defaultReadMode}))
    .map(map);
  return yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'query', function* (quest, query, args, next) {
  const _query = new Function('return ' + query.toString())();
  const q = _query(r, ...args);
  return yield runCursor(quest, q, next);
});

//TODO: deprecate this one, refactor all code base for using
//      cursors...
Goblin.registerQuest(goblinName, 'query-sync', function* (
  quest,
  query,
  args,
  next
) {
  const _query = new Function('return ' + query.toString())();
  const q = _query(r, ...args);
  return yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'query-ids', function* (
  quest,
  query,
  args,
  next
) {
  const _query = new Function('return ' + query.toString())();
  const q = _query(r, ...args)('id');
  return yield run(quest, q, next);
});

Goblin.registerQuest(goblinName, 'query-count', function* (
  quest,
  query,
  args,
  next
) {
  const _query = new Function('return ' + query.toString())();
  const q = _query(r, ...args).count();
  return yield run(quest, q, next);
});

Goblin.registerQuest(
  goblinName,
  'start-quest-on-changes',
  function* (
    quest,
    table,
    goblinId,
    documents,
    options,
    filter,
    includeInitial,
    $msg,
    next
  ) {
    if (!goblinId) {
      throw new Error('You must provide a goblinId for this change feed');
    }
    const serviceId = quest.goblin.id;
    const disposeSub = quest.sub(`*::${goblinId}.disposed`, function* (
      err,
      {msg, resp}
    ) {
      disposeSub();
      yield resp.cmd(`${goblinName}.stop-on-changes`, {
        id: serviceId,
        table,
        goblinId,
      });
    });

    quest.goblin.setX(`disposeSub-${goblinId}`, disposeSub);

    let q = r.table(table, {readMode: defaultReadMode});

    if (documents && documents.length > 0) {
      q = q.getAll(r.args(documents));
    }
    if (options) {
      if (options.contentIndex) {
        if (options.contentIndex.value) {
          q = q.getAll(r.args(options.contentIndex.value), {
            index: options.contentIndex.name,
          });
        } else {
          q = q.orderBy({index: options.contentIndex.name});
        }
      } else if (options.entityId) {
        q = q.get(options.entityId);
      } else if (options.query) {
        const _query = new Function('return ' + options.query)();
        const args = options.queryArgs || [];
        q = _query(r, ...args);
      }
    }

    if (filter) {
      q = q.filter(filter);
    }

    q = q.changes({
      includeInitial: !!includeInitial,
      includeStates: true,
      includeTypes: true,
      squash: 0.5,
    });

    let cursor = quest.goblin.getX(`${goblinId}-cursor`);
    const resp = quest.goblin.getX('resp');
    if (!cursor) {
      cursor = yield run(quest, q, next);
      cursor.on('data', function (data) {
        resp.events.send(`${serviceId}.${goblinId}-cursor.changed`, data);
      });
    }
    quest.goblin.setX(`${goblinId}-cursor`, cursor);
    quest.do();
  },
  ['*::*.disposed']
);

Goblin.registerQuest(goblinName, 'stop-on-changes', function* (
  quest,
  goblinId,
  table,
  next
) {
  const cursor = quest.goblin.getX(`${goblinId}-cursor`);
  if (!cursor) {
    return;
  }

  try {
    yield cursor.close(next);
  } catch (err) {
    quest.log.err(err);
  } finally {
    quest.goblin.delX(`${goblinId}-cursor`);
    quest.goblin.delX(`disposeSub-${goblinId}`);
    quest.do();
  }
});

Goblin.registerQuest(goblinName, 'ensure-table', function* (
  quest,
  table,
  next
) {
  let q = r.tableList();
  const list = yield run(quest, q, next);
  if (list.indexOf(table) === -1) {
    q = r.tableCreate(table);
    yield run(quest, q, next);
  }
});

function* indexing(quest, index, fields, table, next) {
  const q = r
    .table(table, {readMode: defaultReadMode})
    .indexCreate(index, fields);
  yield run(quest, q, next);
  const w = r.table(table, {readMode: defaultReadMode}).indexWait(index);
  yield run(quest, w, next);
}

Goblin.registerQuest(goblinName, 'ensure-index', function* (
  quest,
  table,
  next
) {
  const q = r.table(table, {readMode: defaultReadMode}).indexList();
  const list = yield run(quest, q, next);

  let indexes = [
    {
      index: 'status',
      fields: r.row('meta')('status'),
    },
  ];

  indexes = indexes.filter(({index}) => list.indexOf(index) === -1);

  for (const {index, fields} of indexes) {
    yield* indexing(quest, index, fields, table, next);
  }
});

Goblin.registerQuest(goblinName, 'ensure-custom-indexes', function* (
  quest,
  table,
  indexesFunc,
  next
) {
  const q = r.table(table, {readMode: defaultReadMode}).indexList();
  const list = yield run(quest, q, next);

  let indexes = indexesFunc.map((f) => f(r));
  indexes = indexes.filter(({index}) => list.indexOf(index) === -1);

  for (const {index, fields} of indexes) {
    yield* indexing(quest, index, fields, table, next);
  }
});

Goblin.registerQuest(goblinName, 'ensure-order-indexes', function* (
  quest,
  table,
  orderedBy,
  next
) {
  const q = r.table(table, {readMode: defaultReadMode}).indexList();
  const list = yield run(quest, q, next);

  const indexes = orderedBy.filter((index) => list.indexOf(index) === -1);

  for (const index of indexes) {
    yield* indexing(quest, index, [r.row(index)], table, next);
  }
});

Goblin.registerQuest(goblinName, 'ensure-case-insensitive-index', function* (
  quest,
  table,
  name,
  path,
  next
) {
  function computeReql(paths, reql) {
    if (paths.length === 0) {
      throw new Error(
        `Trying to ensure secondary index ${name} but with path ${path}`
      );
    } else if (paths.length === 1) {
      return reql(paths[0]).downcase();
    } else {
      return computeReql(paths.slice(1), reql(paths[0]));
    }
  }
  let q = r.table(table, {readMode: defaultReadMode}).indexList();
  const list = yield run(quest, q, next);
  if (list.indexOf(name) === -1) {
    q = r
      .table(table, {readMode: defaultReadMode})
      .indexCreate(name, computeReql(path.split('.'), r.row));
    yield run(quest, q, next);
    let w = r.table(table, {readMode: defaultReadMode}).indexWait(name);
    yield run(quest, w, next);
  }
});

Goblin.registerQuest(goblinName, 'ensure-database', function* (quest, next) {
  const db = quest.goblin.getX('db');
  let q = r.dbList();
  const dbList = yield run(quest, q, next);
  if (dbList.indexOf(db) === -1) {
    q = r.dbCreate(db);
    yield run(quest, q, next);
  }
});

Goblin.registerQuest(goblinName, 'reset-database', function* (quest, next) {
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

Goblin.registerQuest(goblinName, 'delete', function (quest) {
  r.getPoolMaster().drain();
  quest.log.dbg('RethinkDB connection closed!');
});

// Create a Goblin with initial state and handlers
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
