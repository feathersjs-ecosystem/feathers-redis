# feathers-redis

[![Build Status](https://travis-ci.org/feathersjs/feathers-redis.png?branch=master)](https://travis-ci.org/feathersjs/feathers-redis)
[![Code Climate](https://codeclimate.com/github/feathersjs/feathers-redis/badges/gpa.svg)](https://codeclimate.com/github/feathersjs/feathers-redis)
[![Test Coverage](https://codeclimate.com/github/feathersjs/feathers-redis/badges/coverage.svg)](https://codeclimate.com/github/feathersjs/feathers-redis/coverage)
[![Issue Count](https://codeclimate.com/github/feathersjs/feathers-redis/badges/issue_count.svg)](https://codeclimate.com/github/feathersjs/feathers-redis)
[![Dependency Status](https://img.shields.io/david/feathersjs/feathers-redis.svg?style=flat-square)](https://david-dm.org/feathersjs/feathers-redis)
[![Download Status](https://img.shields.io/npm/dm/feathers-redis.svg?style=flat-square)](https://www.npmjs.com/package/feathers-redis)

> A Feathers redis service adapter

> __Important:__ This is a proof of concept and not published or intended to be used. For further information see [this issue](https://github.com/feathersjs-ecosystem/feathers-redis/issues/4).

## Installation

```
npm install feathers-redis --save
```

## Documentation

Please refer to the [feathers-redis documentation](http://docs.feathersjs.com/) for more details.

## Complete Example

Here's an example of a Feathers server that uses `feathers-redis`. 

```js
const feathers = require('feathers');
const rest = require('feathers-rest');
const hooks = require('feathers-hooks');
const bodyParser = require('body-parser');
const errorHandler = require('feathers-errors/handler');
const plugin = require('feathers-redis');

// Initialize the application
const app = feathers()
  .configure(rest())
  .configure(hooks())
  // Needed for parsing bodies (login)
  .use(bodyParser.json())
  .use(bodyParser.urlencoded({ extended: true }))
  // Initialize your feathers plugin
  .use('/plugin', plugin())
  .use(errorHandler());

app.listen(3030);

console.log('Feathers app started on 127.0.0.1:3030');
```

## License

Copyright (c) 2016

Licensed under the [MIT license](LICENSE).
