const RUNNER_INSTANCE_KEY = Symbol.for('goblin-rethink.jobRunnerInstance');
const watt = require('gigawatts');

class EtlJobRunner {
  constructor() {
    this.jobs = {};
    this.run = this.run.bind(this);
    watt.wrapAll(this);
  }

  kill(jobId) {
    if (this.jobs[jobId]) {
      this.jobs[jobId].kill('SIGINT');
      delete this.jobs[jobId];
    }
  }

  *run({jobId, mandate, exportPath, src, print, printStatus}, next) {
    if (!jobId) {
      throw new Error('Goblin-rethink ETL: JobId not provided');
    }
    if (this.jobs[jobId]) {
      throw new Error('Goblin-rethink ETL: Job already running');
    }
    const status = {duration: null, failed: false};
    try {
      const {fork} = require('child_process');
      let execArgv = [];
      if (process.env.NODE_ENV === 'development') {
        execArgv.push('--inspect=' + (process.debugPort + 1));
      }

      const path = require('path');
      this.jobs[jobId] = fork(path.join(__dirname, 'jobWorker.js'), [], {
        execArgv,
      });
      const worker = this.jobs[jobId];

      const msg = {
        mandate,
        host: 'localhost',
        port: '28015',
        queryFileName: jobId,
        querySrc: src,
        exportPath,
      };
      const start = process.hrtime();
      worker.send(msg);
      const ended = next.parallel();
      let printCounter = 0;
      worker.on('message', (res) => {
        switch (res.type) {
          case 'print': {
            //TODO: param.
            if (printCounter < 100) {
              print({line: res.line});
            } else {
              printStatus({printCounter});
            }
            printCounter++;
            break;
          }
          case 'error': {
            print({line: res.message});
            status.failed = true;
            ended();
            break;
          }
          case 'end': {
            ended();
            break;
          }
        }
      });
      yield next.sync();
      const ntime = process.hrtime(start);
      const delta = (ntime[0] * 1e9 + ntime[1]).toFixed(0);
      status.duration = `${(delta / 1e6).toFixed(2)} [ms]`;
    } finally {
      this.kill(jobId);
    }
    return status;
  }
}

// check if the global object has this symbol
// add it if it does not have the symbol, yet
// ------------------------------------------
const globalSymbols = Object.getOwnPropertySymbols(global);
const hasInstance = globalSymbols.indexOf(RUNNER_INSTANCE_KEY) > -1;
if (!hasInstance) {
  global[RUNNER_INSTANCE_KEY] = new EtlJobRunner();
}

// define the singleton API
// ------------------------

const singleton = {};

Object.defineProperty(singleton, 'instance', {
  get: function () {
    return global[RUNNER_INSTANCE_KEY];
  },
});

// ensure the API is never changed
// -------------------------------

Object.freeze(singleton);

// export the singleton API only
// -----------------------------
module.exports = singleton;
