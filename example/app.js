const feathers = require('feathers');
const rest = require('feathers-rest');
const socketio = require('feathers-socketio');
const bodyParser = require('body-parser');
const handler = require('feathers-errors/handler');
const Promise = require('bluebird');
const service = require('../lib');

// var to allow promisifyAll
var redis = require('redis');
Promise.promisifyAll(redis.RedisClient.prototype);
Promise.promisifyAll(redis.Multi.prototype);

// const port = 3030;

// Create a feathers instance.
const app = feathers()
// Enable Socket.io
.configure(socketio())
// Enable REST services
.configure(rest())
// Turn on JSON parser for REST services
.use(bodyParser.json())
// Turn on URL-encoded parser for REST services
.use(bodyParser.urlencoded({extended: true}));

const redisOptions = {
  // some example connection configuration options
  // url: 'redis://h:abc123@host.com:6379'
  // host: "pub-redis-12345.us-east-1-1.1.ec2.bigredis.blah"
  // host: 'host.com'
  // port: 6379,
  // password: 'abc123',
  db: 0, // the default, if set, redis will run select(db) on connect
  host: 'localhost' // the default, so it could be left out
};
// Connect to your Redis client instance(s) with the options above.
var client = redis.createClient(redisOptions);

let messagesService = service({
  Model: client,
  paginate: {
    default: 2,
    max: 4
  },
  monitor: true,
  id: '_id',
  debugLevel: 1,    // some debugging
  autoPrefix: true, // enable ID/key prefix:
  // idPrefix: 'messages:', // this would be the default
  redisOptions: redisOptions
});

let usersService = service({
  Model: client,
  paginate: {
    default: 2,
    max: 4
  },
  monitor: true,
  id: 'username',
  autoPrefix: true, // enable ID/key prefix:
  idPrefix: 'people:',  // override default
  redisOptions: redisOptions
});

app.use('/messages', messagesService);
app.use('/users', usersService);
// A basic error handler, just like Express
app.use(handler());

// Message 1 will have the specific numbered ID, 2 will be auto-generated (UUID), 3 will be special text.
/*
const message1Id = 'messages:1';
const message3Id = 'messages:mySpecialMessage3';

let messages = app.service('messages');
*/
let users = app.service('users');

// Create a dummy Message
/*
messages.create({
  _id: message1Id,
  text: 'message1: Oh hai!'
}).then(function () {
  console.log('app: Created message 1.');
  messages.find({query: {_id: {$like: 'messages:1%'}}}).then(
    data => console.log('app: get returned:', data)
  );
})
.catch(function (err) {
  console.error('app: create 1 error: ' + err.message);
});
*/

// Next try the second service instance
users.create({
  username: 'fred',
  name: 'Fred Flintstone',
  email: 'fred@slaterock.co'
}).then(function () {
  console.log('app: Created user.');
  users.find({query: {username: 'fred'}}).then(
    user => console.log('app: get(fred) returned:', user)
  );
})
.catch(function (err) {
  console.error('app: create 1 error: ' + err.message);
});

/*
// Try a create passing an array.
messages.create(
  [
    {
      // this one has no id specified, custom or default
      text: 'message 2: hai2u2!'
    }, {
      // this one has a custom text ID
      _id: message3Id,
      text: 'message 3: how r u?'
    }
  ]).then(function (items) {
    console.log('app: created message 2 and 3:', items);

    messages.get(message3Id)
      .then(function (item) {
        console.log('app: get message 3 success: ', item);
      })
      .catch(function (err) {
        console.error('app: get message 3 failed: ', err);
      });

    messages.remove(message3Id)
      .then(function () {
        console.log('app: remove message 3 success.');
      })
      .catch(function (err) {
        console.error('app: remove message 3 failed: ', err);
      });
  })
  .catch(function (err) {
    console.error('app: create 2 or 3 error: ' + err.message);
  });

// Start the server
app.listen(port, function () {
  console.log(`app: Feathers server listening on port ${port}`);
});
*/
