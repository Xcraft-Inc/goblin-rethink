'use strict';

const goblinName = 'rethink';
const Goblin = require ('xcraft-core-goblin');
const r = require ('rethinkdb');

const connect = (db, next) => r.connect ({db}, next);
const run = (quest, expr, next) => expr.run (quest.goblin.getX ('conn'), next);

// Define initial logic values
const logicState = {};

// Define logic handlers according rc.json
const logicHandlers = {
  create: state => {
    return state;
  },
};

// Register quest's according rc.json
Goblin.registerQuest (goblinName, 'create', function* (quest, database, next) {
  try {
    const conn = yield connect (database, next);
    quest.goblin.defer (conn.close);
    quest.goblin.setX ('conn', conn);
  } catch (err) {
    quest.log.err (err.stack);
    throw new Error ('RethinkDB connection failed');
  }
  return quest.goblin.id;
});

Goblin.registerQuest (goblinName, 'get', function* (
  quest,
  table,
  documentId,
  next
) {
  return yield run (quest, r.table (table).get (documentId), next);
});

Goblin.registerQuest (goblinName, 'getAll', function* (quest, table, next) {
  const cursor = yield run (quest, r.table (table), next);
  return yield cursor.toArray (next);
});

Goblin.registerQuest (goblinName, 'start-quest-on-changes', function* (
  quest,
  table,
  onChangeQuest,
  goblinId,
  next
) {
  const cursor = yield run (
    quest,
    r.table (table).changes ({
      includeInitial: true,
      includeStates: true,
      includeTypes: true,
    }),
    next
  );

  quest.goblin.setX (`${table}-cursor`, cursor);
  quest.cmd ('rethink.start-listen-changes', {
    id: quest.goblin.id,
    cursorName: `${table}-cursor`,
    goblinId,
    onChangeQuest,
  });
});

Goblin.registerQuest (goblinName, 'stop-on-changes', function (quest, table) {
  quest.goblin.delX (`${table}-cursor`);
});

Goblin.registerQuest (goblinName, 'start-listen-changes', function* (
  quest,
  cursorName,
  onChangeQuest,
  goblinId,
  next
) {
  const cursor = quest.goblin.getX (cursorName);
  if (!cursor) {
    return;
  }
  try {
    const change = yield cursor.next (next);

    // CALL onChangeQuest with id and change
    quest.cmd (onChangeQuest, {id: goblinId, change});

    // RECURSE
    quest.cmd ('rethink.start-listen-changes', {
      id: quest.goblin.id,
      cursorName,
      onChangeQuest,
      goblinId,
    });
  } catch (err) {
    quest.log.err (err);
  }
});

Goblin.registerQuest (goblinName, 'delete', function (quest) {});

// Create a Goblin with initial state and handlers
module.exports = Goblin.configure (goblinName, logicState, logicHandlers);
