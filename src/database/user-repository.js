/* jslint node:true */

'use strict';

/**
 * @deprecated UserRepository abstract class was retired.
 * MongoDB is the exclusive production account repository.
 * Re-exports MongoUserRepository for backward compatibility.
 */
module.exports = require('./users-mongo.js');
