const r = require('rethinkdb');
const watt = require('watt');
const vm = require('vm');

const runner = watt(function* (msg, next) {
  const {host, port, queryFileName, querySrc} = msg;
  console.log('(っ◕‿◕)っ rethinkdb ✨');
  console.log(`connecting to ${host}:${port}...`);
  let conn;
  try {
    conn = yield r.connect({host, port}, next);
    console.log('connected ✨');
    const context = {
      dir: (a) => console.dir(a),
      con: conn,
      r,
      next,
    };
    vm.createContext(context);

    const runnable = `(function*(dir,con,r,next){
        ${querySrc}
      })(dir,con,r,next);`;
    const script = new vm.Script(runnable, {
      filename: queryFileName,
      lineOffset: 1,
      columnOffset: 1,
      displayErrors: true,
      timeout: 10000,
    });
    console.log('running query...');

    const data = yield* script.runInContext(context);
    console.log('done ✨');
    process.send({type: 'data', data});
  } catch (err) {
    console.error(err);
    process.send({
      type: 'error',
      message: err.stack.split('at new Script (')[0],
    });
  } finally {
    if (conn) {
      console.log('disconnecting...');
      conn.removeAllListeners();
      yield conn.close({noreplyWait: true}, next);
      console.log('querx disconnected ✨');
    }
  }
});

process.on('message', (msg) => runner(msg));
