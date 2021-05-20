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
      print: (line) => process.send({type: 'print', line}),
      con: conn,
      r,
      next,
      end: () => process.send({type: 'end'}),
    };
    vm.createContext(context);

    const runnable = `(function*(dir,con,r,next){
        ${querySrc}
        if(typeof extract !== 'function'){
          print('Missing function* extract()');
          end();
          return;
        }
        if(typeof transform !== 'function'){
          print('Missing function* transform()');
          end();
          return;
        }
        if(typeof load !== 'function'){
          print('Missing function* load()');
          end();
          return;
        }
        const runCursor = yield * extract();
        let run = true;
        do {
          try {
            const row = yield runCursor.next(next);
            dir(row);
            const tRow = yield* transform(row);
            yield *load(tRow);
          } catch {
            run = false;
          }
        } while (run);
        end();
      })(dir,con,r,next);`;
    const script = new vm.Script(runnable, {
      filename: queryFileName,
      lineOffset: 1,
      columnOffset: 1,
      displayErrors: true,
      timeout: 10000,
    });
    console.log('running query...');

    yield* script.runInContext(context);
    console.log('done ✨');
    process.send({type: 'end'});
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
