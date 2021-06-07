const Goblin = require('xcraft-core-goblin');

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function () {
  return Goblin.buildQueue('rethinkJob-queue', {
    sub: '*::*.<rethinkJob-run-requested>',
    queueSize: 10,
  });
};
