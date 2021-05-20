const r = require('rethinkdb');
const watt = require('watt');
const vm = require('vm');
const {CSV} = require('goblin-workshop');
const {js} = require('xcraft-core-utils');
const runner = watt(function* (msg, next) {
  const {host, port, queryFileName, querySrc, exportPath} = msg;
  console.log('(っ◕‿◕)っ rethinkdb ✨');
  console.log(`connecting to ${host}:${port}...`);
  let conn;
  const disposer = [];
  try {
    conn = yield r.connect({host, port}, next);
    console.log('connected ✨');

    const context = {
      dir: (a) => console.dir(a),
      print: (line) => process.send({type: 'print', line}),
      con: conn,
      r,
      watt: watt,
      end: () => process.send({type: 'end'}),
      csv: (fileName, config) => {
        const inst = CSV.prepare(exportPath)(fileName, config);
        disposer.push(inst.dispose);
        return inst;
      },
    };
    vm.createContext(context);

    const runnable = `(watt(function*(next){
        ${querySrc}
        if(typeof extract !== 'function'){
          print('Missing function* extract()');
          end();
          return;
        }
        extract = watt(extract);
        if(typeof transform !== 'function'){
          print('Missing function* transform()');
          end();
          return;
        }
        transform = watt(transform);
        if(typeof load !== 'function'){
          print('Missing function* load()');
          end();
          return;
        }
        load = watt(load);
        const runCursor = yield extract();
        let run = true;
        do {
          try {
            const row = yield runCursor.next(next);
            const tRow = yield transform(row);
            yield load(tRow);
          } catch {
            run = false;
          }
        } while (run);
        end();
      }))();`;
    const script = new vm.Script(runnable, {
      filename: queryFileName,
      lineOffset: 1,
      columnOffset: 1,
      displayErrors: true,
      timeout: 10000,
    });
    console.log('running query...');

    yield script.runInContext(context);
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
    console.log('disposing...');
    for (const func of disposer) {
      if (js.isGenerator(func)) {
        yield* func();
      } else {
        func();
      }
    }
  }
});

process.on('message', (msg) => runner(msg));
