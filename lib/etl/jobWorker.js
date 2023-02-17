const r = require('rethinkdb');
const watt = require('gigawatts');
const vm = require('vm');
const {CSVOutput, JSONOutput} = require('goblin-workshop');

const runner = watt(function* (msg, next) {
  const {
    mandate,
    host,
    port,
    queryFileName,
    querySrc,
    exportPath,
    customPayload,
  } = msg;

  let conn;
  const toDispose = [];
  const user = `${mandate}-reader`;
  const password = mandate;
  try {
    console.log('(っ◕‿◕)っ Goblin-Rethinkdb - ETL✨');
    console.log(`connecting to ${user} to ${host}:${port}...`);
    conn = yield r.connect({host, port, user, password}, next);
    console.log('connected ✨');

    const context = {
      dir: (a) => console.dir(a),
      print: (line) => process.send({type: 'print', line}),
      con: conn,
      r,
      watt: watt,
      end: () => process.send({type: 'end'}),
      csv: (fileName, config) => {
        const inst = CSVOutput.prepare(exportPath)(fileName, config);
        toDispose.push(inst);
        return inst;
      },
      json: (fileName) => {
        const inst = JSONOutput.prepare(exportPath)(fileName);
        toDispose.push(inst);
        return inst;
      },
      payload: customPayload || {},
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
      }))();`;
    const script = new vm.Script(runnable, {
      filename: queryFileName,
      lineOffset: 1,
      columnOffset: 1,
      displayErrors: true,
      timeout: 1000,
    });
    console.log('running query...');
    yield script.runInContext(context);
  } catch (err) {
    console.error(err);
    process.send({
      type: 'error',
      message: err.stack.split('at new Script (')[0],
    });
  } finally {
    console.log('disposing...');
    const filePaths = [];
    for (const i of toDispose) {
      if (i.filePath) {
        filePaths.push(i.filePath);
      }
      yield i.dispose(next.arg(0));
    }
    console.log('ETL JOB DONE ✨');
    process.send({type: 'end', filePaths});
  }
});

process.on('message', (msg) => runner(msg));
