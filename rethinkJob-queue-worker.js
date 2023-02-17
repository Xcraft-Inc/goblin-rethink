const Goblin = require('xcraft-core-goblin');

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function () {
  return Goblin.buildQueueWorker('rethinkJob-queue', {
    workQuest: function* (
      quest,
      desktopId,
      rethinkJobId,
      customJobId,
      customPayload
    ) {
      const workshopAPI = quest.getAPI('workshop');
      const storageRootPath = yield workshopAPI.getMandateStorageRootPath({
        desktopId,
      });
      const jobId = customJobId || quest.uuidV4();
      if (storageRootPath) {
        const path = require('path');
        const exportPath = path.join(storageRootPath, 'exports');
        const jobAPI = yield quest.create(rethinkJobId, {
          id: rethinkJobId,
          desktopId,
          mustExist: true,
        });
        const src = yield jobAPI.get({path: 'source'});
        const jobRunner = require('./lib/etl/jobRunner.js').instance;
        const status = yield jobRunner.run({
          jobId,
          exportPath,
          mandate: quest.getSession(),
          src,
          print: () => null,
          printStatus: () => null,
          customPayload,
        });
        yield jobAPI.updateLastRun({status});
        return status;
      }
      return {jobId, duration: null, failed: true, filePaths: []};
    },
  });
};
