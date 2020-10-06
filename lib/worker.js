const {workerData, parentPort} = require('worker_threads');
const {r} = require('rethinkdb-ts');

//patch bug with validation of terms
const query = require('rethinkdb-ts/lib/query-builder/query.js');
r.deserialize = (termStr) => query.toQuery(JSON.parse(termStr));

const {CursorPump} = require('xcraft-core-utils');
const watt = require('gigawatts');

/*const run = watt(function* (quest, expr) {
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
});*/

const run = function* (expr) {
  return yield expr.run();
};

const runCursor = function* (expr) {
  return yield expr.getCursor();
};

const connect = watt(function* ({database, host}) {
  return yield r.connectPool({
    db: database,
    servers: [{host, port: 28015}],
    pingInterval: 60 * 60 * 1000,
    log: (msg) => console.log(msg),
  });
});

watt(function* () {
  parentPort.on(
    'message',
    watt(function* ({jobId, query, isCursor, caller}) {
      try {
        let data;
        const q = r.deserialize(query);
        if (isCursor) {
          const cursor = yield* runCursor(q);
          const p = new CursorPump(cursor);
          data = yield p.toArray();
        } else {
          data = yield* run(q);
        }
        parentPort.postMessage({jobId, data});
      } catch (err) {
        console.log(caller);
        console.dir(err);
      }
    })
  );
  yield connect(workerData);
  parentPort.postMessage('worker-ready');
})();
