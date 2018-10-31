'use strict';

function _constructFilterReql(entry, filterObj, filterRegex) {
  function _constructNestedObject(key) {
    const subfields = key.split('.');
    let nestedObj = null;

    for (let subfield of subfields) {
      nestedObj =
        nestedObj == undefined ? entry(subfield) : nestedObj(subfield);
    }

    return nestedObj;
  }

  function _construct(_keys, _reql) {
    if (_keys.length === 0) {
      return _reql;
    } else {
      return _construct(
        _keys.slice(1),
        _reql.and(
          _constructNestedObject(_keys[0]).match(
            filterRegex(filterObj[_keys[0]])
          )
        )
      );
    }
  }

  const validKeys = Object.keys(filterObj).filter(
    key => filterObj[key] != undefined && filterObj[key] !== ''
  );

  if (validKeys.length === 0) {
    return {};
  } else {
    return _construct(
      validKeys.slice(1),
      _constructNestedObject(validKeys[0]).match(
        filterRegex(filterObj[validKeys[0]])
      )
    );
  }
}

function _escapeRegExp(str) {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
}

function buildFilterReql(filter, regex) {
  return entry =>
    _constructFilterReql(entry, filter, value => regex(_escapeRegExp(value)));
}

function buildOrderByReql(key, dir, indexed) {
  const r = require('rethinkdb');
  const reql = r[dir](key);

  if (indexed) {
    return {index: reql};
  } else {
    return reql;
  }
}

module.exports = {
  buildFilterReql: buildFilterReql,
  buildOrderByReql: buildOrderByReql,
};
