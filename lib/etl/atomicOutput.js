const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class AtomicOutput {
  constructor(filePath, createOutput) {
    this.filePath = filePath;
    this.tempFilePath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
    );
    this.output = createOutput(this.tempFilePath);
    this._streamError = null;
    this._captureStreamError = (err) => {
      this._streamError = this._streamError || err;
    };
    this.output.file.on('error', this._captureStreamError);
    this._closePromise = null;
    this._closed = false;
    this._committed = false;
  }

  insert(...args) {
    return this.output.insert(...args);
  }

  close() {
    if (this._closePromise) {
      return this._closePromise;
    }

    this._closePromise = new Promise((resolve, reject) => {
      const stream = this.output.file;
      let settled = false;

      const settle = () => {
        if (settled) {
          return;
        }
        settled = true;
        stream.removeListener('error', this._captureStreamError);
        stream.removeListener('close', onClose);
        this._closed = true;
        if (this._streamError) {
          reject(this._streamError);
        } else {
          resolve();
        }
      };
      const onClose = () => settle();

      if (stream.closed) {
        settle();
        return;
      }

      stream.once('close', onClose);
      try {
        this.output.dispose((err) => {
          this._streamError = this._streamError || err;
          if (stream.closed) {
            settle();
          }
        });
      } catch (err) {
        this._streamError = this._streamError || err;
        stream.destroy();
      }
    });

    return this._closePromise;
  }

  async commit() {
    if (!this._closed) {
      throw new Error(`Output must be closed before commit: ${this.filePath}`);
    }
    await fs.promises.rename(this.tempFilePath, this.filePath);
    this._committed = true;
  }

  async abort() {
    let closeError = null;
    if (!this._closed) {
      try {
        await this.close();
      } catch (err) {
        closeError = err;
      }
    }

    if (!this._committed) {
      try {
        await fs.promises.unlink(this.tempFilePath);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          throw err;
        }
      }
    }

    if (closeError) {
      throw closeError;
    }
  }
}

class AtomicOutputs {
  constructor(exportPath) {
    this.exportPath = exportPath;
    this.outputs = [];
    this.filePaths = new Set();
  }

  create(fileName, createOutput) {
    const filePath = path.join(this.exportPath, path.basename(fileName));
    if (this.filePaths.has(filePath)) {
      throw new Error(`Output is already declared by this job: ${filePath}`);
    }

    const output = new AtomicOutput(filePath, createOutput);
    this.outputs.push(output);
    this.filePaths.add(filePath);
    return output;
  }

  async closeAll() {
    const results = await Promise.allSettled(
      this.outputs.map((output) => output.close())
    );
    const errors = results
      .filter(({status}) => status === 'rejected')
      .map(({reason}) => reason);
    if (errors.length) {
      throw new AggregateError(errors, 'Failed to close ETL outputs');
    }
  }

  async commitAll() {
    const filePaths = [];
    for (const output of this.outputs) {
      await output.commit();
      filePaths.push(output.filePath);
    }
    return filePaths;
  }

  async abortAll() {
    const results = await Promise.allSettled(
      this.outputs.map((output) => output.abort())
    );
    const errors = results
      .filter(({status}) => status === 'rejected')
      .map(({reason}) => reason);
    if (errors.length) {
      throw new AggregateError(errors, 'Failed to abort ETL outputs');
    }
  }
}

module.exports = {AtomicOutput, AtomicOutputs};
