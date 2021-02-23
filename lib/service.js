'use strict';

const goblinName = 'rethink';
const Goblin = require('xcraft-core-goblin');
const busClient = require('xcraft-core-busclient').getGlobal();
const defaultReadMode = 'outdated';
const watt = require('gigawatts');
const {r} = require('rethinkdb-ts');
const {CursorPump} = require('xcraft-core-utils');
const path = require('path');
const {Worker} = require('worker_threads');
const rethinkConfig = require('xcraft-core-etc')().load('goblin-rethink');

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

const _run = function* (expr) {
  return yield expr.run();
};

const _runCursor = function* (expr) {
  return yield expr.getCursor();
};

const runHere = watt(function* (quest, query, isCursor) {
  let time = process.hrtime();
  let result;
  if (isCursor) {
    const cursor = yield* _runCursor(query);
    const p = new CursorPump(cursor);
    result = yield p.toArray();
  } else {
    result = yield* _run(query);
  }
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

const runOnWorker = watt(function* (quest, query, isCursor) {
  const worker = quest.goblin.getX('worker');
  const jobId = quest.uuidV4();
  const data = yield quest.sub.callAndWait(() => {
    const serializedQuery = r.serialize(query);
    worker.postMessage({
      jobId,
      query: serializedQuery,
      isCursor,
      caller: quest.questName,
    });
  }, `*::${jobId}.done`);
  return data;
});

const run = rethinkConfig.useWorker ? runOnWorker : runHere;

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

const waitForAvailability = watt(function* (quest, database) {
  quest.log.dbg(`wait for rethinkdb cluster availability ...`);
  let time = process.hrtime();
  const q = r.db(database).wait({waitFor: 'all_replicas_ready', timeout: 120});
  yield runHere(quest, q, false);
  time = process.hrtime(time);
  time = (time[0] * 1e9 + time[1]) / 1e6;
  quest.log.dbg(`... rethinkdb cluster available after ${time.toFixed(0)}ms`);
});

// Register quest's according rc.json
Goblin.registerQuest(goblinName, 'create', function* (
  quest,
  host,
  database,
  collectStats = true,
  next
) {
  const resp = busClient.newResponse(quest.goblin.id, 'token');
  quest.goblin.setX('resp', resp);
  quest.do();
  yield r.connectPool({
    db: database,
    servers: [{host, port: 28015}],
    pingInterval: 60 * 60 * 1000,
  });

  yield waitForAvailability(quest, database);

  const worker = new Worker(path.join(__dirname, 'worker.js'), {
    workerData: {database, host},
  });
  const _next = next.parallel();
  worker.on('message', (msg) => {
    if (msg === 'worker-ready') {
      _next();
    } else {
      resp.events.send(`${msg.jobId}.done`, msg.data);
    }
  });
  worker.on('error', (err) => {
    console.log(err);
  });
  quest.goblin.setX('worker', worker);
  quest.goblin.setX('host', host);
  quest.goblin.setX('db', database);
  yield next.sync();
  if (collectStats) {
    yield quest.me.collectStats({database});
  }
  return quest.goblin.id;
});

Goblin.registerQuest(goblinName, 'selectDb', function* (quest, database) {
  // Clear poolMaster
  r.getPoolMaster().drain();
  const host = quest.goblin.getX('host');
  yield r.connectPool({
    db: database,
    servers: [{host, port: 28015}],
    pingInterval: 60 * 60 * 1000,
    log: (msg) => console.log(msg),
  });

  yield waitForAvailability(quest, database);

  quest.goblin.setX('db', database);
});

Goblin.registerQuest(goblinName, 'copyTableFromDb', function* (
  quest,
  fromDb,
  table,
  status
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

  yield run(quest, q, false);
});

Goblin.registerQuest(goblinName, 'listTableFromDb', function* (quest, fromDb) {
  let q = r.db(fromDb).tableList();
  const list = yield run(quest, q, false);
  return list;
});

Goblin.registerQuest(goblinName, 'listDb', function* (quest) {
  let q = r.dbList();
  const list = yield run(quest, q, false);
  return list;
});

Goblin.registerQuest(goblinName, 'get-ids', function* (
  quest,
  table,
  contentIndex,
  range
) {
  let q = r.table(table, {readMode: defaultReadMode});
  q = applyContentIndex(r, q, contentIndex);
  if (range) {
    q = q.slice(range.start, range.start + range.length);
  }

  return yield run(quest, q('id'), true);
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

  return yield run(quest, q('id'), true);
});

Goblin.registerQuest(goblinName, 'get-ordered-collection-count', function* (
  quest,
  table,
  documentId,
  collectionTable,
  collection,
  orderBy
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

  return yield run(quest, q, false);
});

Goblin.registerQuest(goblinName, 'get', function* (
  quest,
  table,
  documentId,
  privateState
) {
  let q = r.table(table, {readMode: defaultReadMode}).get(documentId);
  if (!privateState) {
    q = q.without('private');
  }

  let document = null;
  try {
    document = yield q.run();
  } catch {
    quest.log.warn('document not found:', documentId);
  }
  return document;
});

Goblin.registerQuest(goblinName, 'exist', function* (quest, table, documentId) {
  let q = r.table(table, {readMode: defaultReadMode}).get(documentId).ne(null);
  return yield q.run();
});

//View ex:
// [{'meta':{'summaries':['info']}},'status']
Goblin.registerQuest(goblinName, 'get-view', function* (
  quest,
  table,
  documents,
  view
) {
  let q = r
    .table(table, {readMode: defaultReadMode})
    .getAll(r.args(documents))
    .pluck('id', r.args(view));

  return yield run(quest, q, false);
});

Goblin.registerQuest(goblinName, 'getIn', function* (
  quest,
  table,
  documentId,
  path
) {
  let q = r.table(table, {readMode: defaultReadMode}).get(documentId);
  for (const field of path) {
    q = q(field);
  }
  q = q.default(null);
  return yield q.run();
});

Goblin.registerQuest(goblinName, 'set', function* (quest, table, documents) {
  let q = r
    .table(table, {readMode: defaultReadMode})
    .insert(documents, {conflict: 'replace', durability: 'soft'});
  return yield q.run();
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
  value
) {
  let q = r.table(table, {readMode: defaultReadMode}).get(documentId);
  const updater = {};
  buildUpdater(updater, path, value);
  q = q.update(updater);
  return yield q.run();
});

Goblin.registerQuest(goblinName, 'del', function* (quest, table, documentId) {
  let q = r.table(table, {readMode: defaultReadMode}).get(documentId).delete();
  return yield q.run();
});

Goblin.registerQuest(goblinName, 'getAllIds', function* (quest, table) {
  let q = r.table(table, {readMode: defaultReadMode})('id').distinct();
  return yield run(quest, q, false);
});

Goblin.registerQuest(goblinName, 'getAllById', function* (
  quest,
  table,
  documents,
  status
) {
  const documentStatus = status || ['published'];
  let q = r
    .table(table, {readMode: defaultReadMode})
    .getAll(r.args(documentStatus), {index: 'status'})
    .orderBy({index: 'id'});
  return yield run(quest, q, false);
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
  range
) {
  let q = r.table(table, {readMode: defaultReadMode});

  if (sync) {
    q = q.sync();
    yield run(quest, q, false);
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

  return yield run(quest, q, true);
});

Goblin.registerQuest(goblinName, 'getFirst', function* (
  quest,
  table,
  contentIndex,
  status, // overload contentIndex
  filter,
  match,
  sync
) {
  let q = r.table(table, {readMode: defaultReadMode});

  if (sync) {
    q = q.sync();
    yield run(quest, q, false);
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

  const res = yield q.run();
  return res[0];
});

Goblin.registerQuest(goblinName, 'count', function* (
  quest,
  table,
  contentIndex
) {
  let q = r.table(table, {readMode: defaultReadMode});
  q = applyContentIndex(r, q, contentIndex).count();
  return yield q.run();
});

Goblin.registerQuest(goblinName, 'count-by', function* (
  quest,
  table,
  field,
  value
) {
  let q = r.table(table, {readMode: defaultReadMode});
  q = q.filter({[field]: value}).count();
  return yield q.run();
});

Goblin.registerQuest(goblinName, 'joinAndMap', function* (
  quest,
  table,
  join,
  mapper
) {
  const map = new Function('return ' + mapper.toString())();
  let q = r
    .table(table, {readMode: defaultReadMode})
    .eqJoin(join.reference, r.table(join.table, {readMode: defaultReadMode}))
    .map(map);
  return yield run(quest, q, true);
});

Goblin.registerQuest(goblinName, 'query', function* (quest, query, args) {
  const _query = new Function('return ' + query.toString())();
  const q = _query(r, ...args);
  const cursor = yield q.getCursor();
  const p = new CursorPump(cursor);
  return yield p.toArray();
});

Goblin.registerQuest(goblinName, 'queryFirst', function* (
  quest,
  query,
  args,
  next
) {
  const _query = new Function('return ' + query.toString())();
  const q = _query(r, ...args);
  const cursor = yield q.getCursor();
  const p = new CursorPump(cursor);
  return yield p.pump();
});

Goblin.registerQuest(goblinName, 'query-ids', function* (quest, query, args) {
  const _query = new Function('return ' + query.toString())();
  const q = _query(r, ...args)('id');
  return yield run(quest, q, true);
});

Goblin.registerQuest(goblinName, 'query-count', function* (quest, query, args) {
  const _query = new Function('return ' + query.toString())();
  const q = _query(r, ...args).count();
  return yield run(quest, q, false);
});

Goblin.registerQuest(goblinName, 'start-quest-on-changes', function* (
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
  const disposeSub = quest.sub(`*::<${goblinId}.deleted>`, function* (
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
    cursor = yield q.run();
    cursor.on('data', function (data) {
      resp.events.send(`${serviceId}.${goblinId}-cursor.changed`, data);
    });
  }
  quest.goblin.setX(`${goblinId}-cursor`, cursor);
  quest.do();
});

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

Goblin.registerQuest(goblinName, 'ensure-table', function* (quest, table) {
  let q = r.tableList();
  const list = yield run(quest, q, false);
  if (list.indexOf(table) === -1) {
    q = r.tableCreate(table);
    yield q.run();
  }
});

function* indexing(quest, index, fields, table) {
  const q = r
    .table(table, {readMode: defaultReadMode})
    .indexCreate(index, fields);
  yield q.run();
  const w = r.table(table, {readMode: defaultReadMode}).indexWait(index);
  yield w.run();
}

Goblin.registerQuest(goblinName, 'ensure-index', function* (quest, table) {
  const q = r.table(table, {readMode: defaultReadMode}).indexList();
  const list = yield q.run();

  let indexes = [
    {
      index: 'status',
      fields: r.row('meta')('status'),
    },
  ];

  indexes = indexes.filter(({index}) => list.indexOf(index) === -1);

  for (const {index, fields} of indexes) {
    yield* indexing(quest, index, fields, table);
  }
});

Goblin.registerQuest(goblinName, 'ensure-custom-indexes', function* (
  quest,
  table,
  indexesFunc
) {
  const q = r.table(table, {readMode: defaultReadMode}).indexList();
  const list = yield q.run();

  let indexes = indexesFunc.map((f) => new Function('return ' + f)()(r));
  indexes = indexes.filter(({index}) => list.indexOf(index) === -1);

  for (const {index, fields} of indexes) {
    yield* indexing(quest, index, fields, table);
  }
});

Goblin.registerQuest(goblinName, 'ensure-order-indexes', function* (
  quest,
  table,
  orderedBy
) {
  const q = r.table(table, {readMode: defaultReadMode}).indexList();
  const list = yield q.run();

  const indexes = orderedBy.filter((index) => list.indexOf(index) === -1);

  for (const index of indexes) {
    yield* indexing(quest, index, [r.row(index)], table);
  }
});

Goblin.registerQuest(goblinName, 'ensure-case-insensitive-index', function* (
  quest,
  table,
  name,
  path
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
  const list = yield q.run();
  if (list.indexOf(name) === -1) {
    q = r
      .table(table, {readMode: defaultReadMode})
      .indexCreate(name, computeReql(path.split('.'), r.row));
    yield run(quest, q, false);
    let w = r.table(table, {readMode: defaultReadMode}).indexWait(name);
    yield run(quest, w, false);
  }
});

Goblin.registerQuest(goblinName, 'ensure-database', function* (quest) {
  const db = quest.goblin.getX('db');
  let q = r.dbList();
  const dbList = yield run(quest, q, false);
  if (dbList.indexOf(db) === -1) {
    q = r.dbCreate(db);
    yield q.run();
  }
});

Goblin.registerQuest(goblinName, 'reset-database', function* (quest) {
  const db = quest.goblin.getX('db');
  let q = r.dbList();
  const dbList = yield q.run();
  if (dbList.indexOf(db) !== -1) {
    q = r.dbDrop(db);
    yield q.run();
  }
  q = r.dbCreate(db);
  yield q.run();
});

Goblin.registerQuest(goblinName, 'collect-stats', function (quest, database) {
  //TODO: Get more info: https://rethinkdb.com/docs/system-stats/
  const collect = watt(function* () {
    const q = r.db('rethinkdb').table('stats').get(['cluster']);
    const stats = yield q.run();
    stats.query_engine.db = database;
    quest.goblin.setX('clusterStats', stats.query_engine);
  });

  setInterval(collect, 1000);
});

Goblin.registerQuest(goblinName, 'delete', function (quest) {
  r.getPoolMaster().drain();
  quest.log.dbg('RethinkDB connection closed!');
});

const getMetrics = function (goblin) {
  const metrics = {};
  const clusterStats = goblin.getX('clusterStats');
  const {
    client_connections,
    clients_active,
    queries_per_sec,
    read_docs_per_sec,
    written_docs_per_sec,
    db,
  } = clusterStats;

  metrics['client.connections'] = {total: client_connections, labels: {db}};
  metrics['clients.active'] = {total: clients_active, labels: {db}};
  metrics['queries.per.sec'] = {total: queries_per_sec, labels: {db}};
  metrics['read.docs.per.sec'] = {total: read_docs_per_sec, labels: {db}};
  metrics['written.docs.per.sec'] = {total: written_docs_per_sec, labels: {db}};

  return metrics;
};

// Create a Goblin with initial state and handlers
module.exports = Goblin.configure(goblinName, logicState, logicHandlers, {
  getMetrics,
});
