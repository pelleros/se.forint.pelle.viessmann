'use strict';

const { OAuth2App } = require('homey-oauth2app');
const MyBrandOAuth2Client = require('./lib/MyBrandOAuth2Client');

class MyApp extends OAuth2App {

  static OAUTH2_CLIENT = MyBrandOAuth2Client; // Default: OAuth2Client
  static OAUTH2_DEBUG = true; // Default: false
  // static OAUTH2_MULTI_SESSION = false; // Default: false
  // static OAUTH2_DRIVERS = [ 'vicare' ]; // Default: all drivers

  async onOAuth2Init() {
    this.log('onOAuth2Init called');
    this.enableOAuth2Debug();
    // this.log('CLIENT_SECRET' + OAUTH2_CLIENT.CLIENT_SECRET);
    // this.log('OAUTH2_CLIENT.authurl' + OAUTH2_CLIENT.getAuthorizationUrl());
    // Do App logic here
  }

}

module.exports = MyApp;
