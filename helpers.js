'use strict';

const _ = require('lodash');

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

  const keys = Object.keys(filterObj);

  if (keys.length === 0) {
    return {};
  } else {
    return _construct(
      keys.slice(1),
      _constructNestedObject(keys[0]).match(filterRegex(filterObj[keys[0]]))
    );
  }
}

function _escapeRegExp(str) {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
}

function buildFilterReql(filter, regex) {
  function _constructValidKeys(obj, path, validKeys) {
    if (obj == undefined || obj === '') {
      return;
    } else if (typeof obj === 'object') {
      Object.keys(obj).forEach(key =>
        _constructValidKeys(obj[key], `${path}.${key}`, validKeys)
      );
    } else {
      // primitive type
      validKeys[_.trimStart(path, '.')] = obj;
    }
  }

  const validKeys = {};
  _constructValidKeys(filter, '', validKeys);

  return entry =>
    _constructFilterReql(entry, validKeys, value =>
      regex(_escapeRegExp(value))
    );
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
