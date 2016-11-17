import omit from 'lodash.omit';
import Proto from 'uberproto';
import filter from 'feathers-query-filters';
import errors from 'feathers-errors';
import uuid from 'node-uuid';
import Promise from 'bluebird';

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
    this.id = options.id || '_id';
    this.idPrefix = options.idPrefix; // redis namespace
    this.events = options.events || [];
    this.paginate = options.paginate || {};
    this.useMonitor = options.monitor || false;

    this.Model.on('connect', function () {
      console.log('Connected to Redis');
    });

    this.Model.on('error', function (err) {
      console.log('Redis error: ' + err);
    });

    if (this.useMonitor) {
      this.Model.on('monitor', function (time, args, rawReply) {
        console.log(time + ': ' + args); // 1458910076.446514:['set', 'foo', 'bar']
      });
    }
    console.log('feathers-redis initialized.');
  }

  extend (obj) {
    return Proto.extend(obj, this);
  }

  _newId () {
    var buffer = new Buffer(16);
    uuid.v4(null, buffer, 0);
    var id = uuid.unparse(buffer);
    return (this.idPrefix) ? this.idPrefix + id : id;
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

  _find (params, count, getFilter = filter) {
    // Start with finding all, and limit when necessary.
    let { filters, query } = getFilter(params.query || {});
    let q = this.Model.get(query);

    if (filters.$select) {
      q = this.Model.get(query, this._getSelect(filters.$select));
    }

    if (filters.$sort) {
      q.sort(filters.$sort);
    }

    if (filters.$limit) {
      q.limit(filters.$limit);
    }

    if (filters.$skip) {
      q.skip(filters.$skip);
    }

    const runQuery = total => {
      return q.toArray().then(data => {
        return {
          total,
          limit: filters.$limit,
          skip: filters.$skip || 0,
          data
        };
      });
    };

    if (count) {
      return this.Model.count(query).then(runQuery);
    }

    return runQuery();
  }

  find (params) {
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
    return this.Model.getAsync(id)
    .then(data => {
      if (!data) {
        throw new errors.NotFound(`No record found for id '${id}'`);
      }

      return data;
    });
  }

  get (id, params) {
    return this._get(id, params);
  }

  _findOrGet (id, params) {
    if (id === null) {
      return this._find(params).then(page => page.data);
    }

    return this._get(id, params);
  }

  create (data) {
    const setId = item => {
      const resource = Object.assign({}, item);

      // Generate a Redis ID if we use a custom id
      if (this.id !== '_id' && typeof resource[this.id] === 'undefined') {
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

      console.log("Creating resource '" + key + "' = '" + value + "'.");
      return this.Model
        .setAsync(key, value)
        .then(res => console.log(res));
    };

    if (Array.isArray(data)) {
      return Promise.map(data, function (entry) {
        // Promise.map awaits for returned promises.
        return createResource(entry);
      }).then(function () {
        console.log('done with array');
      });
    } else {
      return createResource(data);
    }
  }

  _normalizeId (id, data) {
    if (this.id === '_id') {
      // Default Redis IDs cannot be updated. The Redis library handles
      // this automatically.
      return omit(data, this.id);
    } else {
      // If not using the default Redis _id field set the ID to its
      // previous value. This prevents orphaned documents.
      return Object.assign({}, data, { [this.id]: id });
    }
  }

  patch (id, data, params) {
    const { query, options } = this._multiOptions(id, params);
    const patchParams = Object.assign({}, params, {
      query: Object.assign({}, query)
    });

    // Account for potentially modified data
    Object.keys(query).forEach(key => {
      if (query[key] !== undefined && data[key] !== undefined &&
        typeof data[key] !== 'object') {
        patchParams.query[key] = data[key];
      } else {
        patchParams.query[key] = query[key];
      }
    });

    // Run the query
    return this.Model
    .update(query, { $set: this._normalizeId(id, data) }, options)
    .then(() => this._findOrGet(id, patchParams));
  }

  update (id, data, params) {
    if (Array.isArray(data) || id === null) {
      return Promise.reject('Not replacing multiple records. Did you mean `patch`?');
    }

    let { query, options } = this._multiOptions(id, params);

    return this.Model
    .update(query, this._normalizeId(id, data), options)
    .then(() => this._findOrGet(id));
  }

  remove (id, params) {
    let { query, options } = this._multiOptions(id, params);

    return this._findOrGet(id, params)
    .then(items => this.Model
      .remove(query, options)
      .then(() => items));
  }
}

export default function init (options) {
  return new Service(options);
}

init.Service = Service;
