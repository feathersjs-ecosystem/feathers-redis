import Proto from 'uberproto';
import filter from 'feathers-query-filters';
import errors from 'feathers-errors';
import uuid from 'node-uuid';
import Promise from 'bluebird';
import { sorter, matcher, select } from 'feathers-commons';

const DEFAULT_ID = 'id';  // or '_id' ?

// Create the service.
class Service {
  constructor (options) {
    if (!options) {
      throw new Error('Redis options must be provided');
    }

    if (!options.Model) {
      throw new Error('Redis database `Model` must be provided');
    }

    this.Model = options.Model;
    this.id = options.id || DEFAULT_ID;
    this.idPrefix = options.idPrefix || null; // redis namespace
    this.autoPrefix = options.autoPrefix || false;
    this.events = options.events || [];
    this.paginate = options.paginate || {};
    this.useMonitor = options.monitor || false;
    this.selected = options.db || 0;
    this.path = 'unknown';

    let _this = this;

    if (this.useMonitor) {
      this.Model.on('monitor', function (time, args, rawReply) {
        if (_this.useMonitor) {
          console.log(time + ': ' + args); // 1458910076.446514:['set', 'foo', 'bar']
        }
      });
    }
    this.Model.on('error', function (err) {
      console.log('Redis error: ' + err);
    });

    this.Model.on('connect', function () {
      if (_this.useMonitor) {
        console.log('monitor: connected to Redis');
      }
    });

    this.Model.on('end', function () {
      if (_this.useMonitor) {
        console.log('monitor: connection to Redis closed');
      }
    });

    this.Model.on('reconnecting', function () {
      if (_this.useMonitor) {
        console.log('monitor: reconnecting to Redis');
      }
    });
  }

  extend (obj) {
    return Proto.extend(obj, this);
  }

  _pick (source, ...keys) {
    const result = {};
    for (let key of keys) {
      result[key] = source[key];
    }
    return result;
  }

  setup (app, path) {
    this.app = app;
    this.path = path;
    if (!this.idPrefix) {
      this.idPrefix = path + ':'; // e.g. 'todos:' for 'todos:123' IDs
    }
    console.log('setup: feathers-redis initialized for: ' + path);
  }

  _newId () {
    var buffer = new Buffer(16);
    uuid.v4(null, buffer, 0);
    var id = uuid.unparse(buffer);
    if (this.autoPrefix && this.idPrefix) {
      if (!id.startsWith(this.idPrefix)) {
        id = this.idPrefix + id;
      }
    }
    return id;
  }

  _multiOptions (id, params) {
    let query = Object.assign({}, params.query);
    let options = Object.assign({ multi: true }, params.redis || params.options);

    if (id !== null) {
      options.multi = false;
      query[this.id] = id;
    }

    return { query, options };
  }

  _getSelect (select) {
    if (Array.isArray(select)) {
      var result = {};
      select.forEach(name => {
        result[name] = 1;
      });
      return result;
    }

    return select;
  }

  // This actually does the Redis SCAN query to return the IDs that match.
  _scan (query, limit) {
    if (this.useMonitor) {
      console.log('monitor: _scan:', query);
    }

    for (let member in query) {
      // This only supports query by id (redis.scan).
      if (member !== this.id) {
        throw new errors.AssertionError('_scan: redis query only supports id field');
      }
    }
    // This only supports query by id (redis.scan).
    let id = query.id;  // this can be a pattern
    let args = [0];
    args.push('match', '*');
    if (limit) {
      // redis has fuzzy limits, often off by a few. ensure it has enough.
      args.push('count', (limit * 2));
    }
    if (this.useMonitor) {
      console.log('monitor: _scan:', args);
    }
    return this.Model.scanAsync(args)
    .then(data => {
      if (!data) {
        throw new errors.NotFound(`No record found for id 'scan'`);
      }

      if (this.useMonitor) {
        console.log('monitor: _scan(' + id + ') =', data);
      }
      return {
        cursor: data[0],
        keys: data[1]
      };
    });
  }

  _postFilter (data, filters) {
    const total = data.length;
    console.log('_find: initial filter to', data.length, 'of', total);

    let values = data.filter(matcher(filters));

    if (filters.$sort) {
      values.sort(sorter(filters.$sort));
    }

    if (filters.$skip) {
      values = values.slice(filters.$skip);
    }

    if (filters.$limit) {
      values = values.slice(0, filters.$limit);
    }

    if (filters.$select) {
      values = values.map(value => this._pick(values, filters.$select));
    }

    return {
      total,
      limit: filters.$limit,
      skip: filters.$skip || 0,
      data: values
    };
  }

  _idToObject (id) {
    let result = { };
    result[this.id] = id;
    return result;
  }

  _find (params, count, getFilter = filter) {
    // Start with finding all, and limit when necessary.
    let {filters, query} = getFilter(params.query || {});
    return this._scan(query, filters.$limit)
    .then(data => {
      let cursor = data.cursor;
      console.log('_find: scan result: cursor at', cursor);
      let allKeys = data.keys.map(key => {
        console.log('_find: scan result:', key);
        return this._idToObject(key);
      });

      // Now fetch the actual records for the keys
      let filteredKeys = allKeys.filter(matcher(filters));
      console.log('_find: filteredKeys = ', filteredKeys);
      return filteredKeys;
    })
    .then(data => {
      // get the full records for the matching keys
      console.log('_find: matching keys:', data);
      return (data.length >= 1) ? this._get(data) : [ ];
    })
    .then(data => {
      console.log('_find: matching records:', data);
      let results = this._postFilter(data, filters);
      console.log('_find: final results:', results);
      return Promise.resolve(results);
    })
    .catch(err => {
      console.error('_find: exception ', err);
    });
  }

  find (params) {
    if (this.useMonitor) {
      console.log('monitor: find(', params);
    }

    const paginate = (params && typeof params.paginate !== 'undefined')
      ? params.paginate : this.paginate;
    const result = this._find(params, !!paginate.default,
      query => filter(query, paginate)
    );

    if (!paginate.default) {
      return result.then(page => page.data);
    }

    return result;
  }

  _get (id) {
    if (id === undefined) {
      console.trace('_get: id is undefined');
    }
    if (typeof id === 'object') {
      console.error('_get with object for id:', id);
    }
    return this.Model.getAsync(id)
    .then(data => {
      if (!data) {
        throw new errors.NotFound(`No record found for id '${id}'`);
      }

      if (this.useMonitor) {
        console.log('monitor: get(', id, ') =', data);
      }
      return data;
    });
  }

  get (id, params) {
    return this._get(id, params);
  }

  _findOrGet (id, params) {
    if (!id) {
      return this._find(params).then(page => page.data);
    }

    return this._get(id, params);
  }

  create (data) {
    const setId = item => {
      const resource = Object.assign({}, item);

      // Generate a Redis ID if we use a custom id
      if (this.id !== DEFAULT_ID && typeof resource[this.id] === 'undefined') {
        resource[this.id] = this._newId();
      }
      if (!resource[this.id]) {
        resource[this.id] = this._newId();
      }
      return resource;
    };

    const createResource = item => {
      var resource = setId(item);
      var key = resource[this.id];
      var value = JSON.stringify(resource);

      if (this.useMonitor) {
        console.log('monitor: create(', key, ' =', value);
      }

      return this.Model
        .setAsync(key, value)
        .then(res => console.log(res));
    };

    if (Array.isArray(data)) {
      return Promise.map(data, function (entry) {
        // Promise.map awaits for returned promises.
        return createResource(entry);
      });
    } else {
      return createResource(data);
    }
  }

  patch (id, data, params) {
    if (this.useMonitor) {
      console.log('monitor: patch(', id, ',', data);
    }

    return this._findOrGet(id, params)
    .then(function (items) {
      let patchData = [];
      if (Array.isArray(items)) {
        for (var x = 0; x < items.length; x++) {
          patchData.push(items[x].id, Object.assign({}, items[x], data));
        }
      } else {
        patchData.push(items.id, Object.assign({}, items, data));
      }

      // Run the query
      return this.Model
        .msetAsync(patchData)
        .then(() => this._findOrGet(id, params))
        .then(select(params, this.id));
    });
  }

  update (id, data, params) {
    if (this.useMonitor) {
      console.log('monitor: update(', id, ',', data);
    }

    if (Array.isArray(data) || id === null) {
      return Promise.reject('Not replacing multiple records. Did you mean `patch`?');
    }

    return this.Model
    .setAsync(id, data)
    .then(() => this._findOrGet(id))
    .then(select(params, this.id));
  }

  remove (id, params) {
    let _this = this;
    if (this.useMonitor) {
      console.log('monitor: remove(', id, ',', params);
    }

    return this._findOrGet(id, params)
      .then(items => {
        _this.Model.delAsync(id)
        .then(() => items)
        .then(select(params, this.id));
      });
  }
}

export default function init (options) {
  return new Service(options);
}

init.Service = Service;
