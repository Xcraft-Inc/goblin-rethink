'use strict';
//T:2019-04-09

const T = require('goblin-nabu/widgets/helpers/t.js');
const {buildHinter} = require('goblin-elasticsearch');

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function () {
  return buildHinter({
    type: 'rethinkJob',
    fields: ['info'],
    title: T('Extractions RethinkDB'),
    newWorkitem: {
      name: 'rethinkJob-workitem',
      description: T('Nouvelle extraction'),
      newEntityType: 'rethinkJob',
      view: 'default',
      icon: 'solid/pencil',
      mapNewValueTo: 'name',
      kind: 'tab',
      isClosable: true,
      navigate: true,
    },
    newButtonTitle: T('Nouvelle extraction'),
  });
};
