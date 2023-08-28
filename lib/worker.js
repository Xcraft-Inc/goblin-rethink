const {r} = require('rethinkdb-ts');
const queryRunner = require('rethinkdb-ts/lib/query-builder/query-runner.js');

// Patch bug with validation of terms
r.deserialize = (termStr) => {  
  return queryRunner.toQuery(JSON.parse(termStr));
};

const {CursorPump} = require('xcraft-core-utils');
const watt = require('gigawatts');

const run = function* (expr) {
  return yield expr.run();
};

const runCursor = function* (expr) {
  return yield expr.getCursor();
};

const workerFunc = watt(function* ({jobId, query, isCursor, caller}) {
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
    return {jobId, data};
  } catch (err) {
    console.log(caller);
    console.dir(err);
  }
});

module.exports = watt(function* (next) {
  const {database, host, port} = require('piscina').workerData;
  yield r.connectPool({
    db: database,
    servers: [{host, port}],
    pingInterval: 60 * 60 * 1000,
    log: (msg) => console.log(msg),
  });
  //log the "bee" as worker presence
  yield process.stdout.write('\u{1F41D}', next);
  return workerFunc;
})();
