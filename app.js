/*
 * 
 *  Copyright (C) 2024 Per Rosengren
 *  This file is part of se.forint.pelle.viessmann project.
 * 
 *  se.forint.pelle.viessmann project is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 * 
 *  se.forint.pelle.viessmann project is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 * 
 *  You should have received a copy of the GNU General Public License
 *  along with se.forint.pelle.viessmann project.  If not, see <http://www.gnu.org/licenses/>.
 * 
 */

'use strict';

const { OAuth2App } = require('homey-oauth2app');
const ViessmannOAuth2Client = require('./lib/ViessmannOAuth2Client');

class MyApp extends OAuth2App {

  static OAUTH2_CLIENT = ViessmannOAuth2Client; // Default: OAuth2Client
  static OAUTH2_DEBUG = process.env.DEBUG; // Default: false

  async onOAuth2Init() {
    if (process.env.DEBUG) {
      this.log('onOAuth2Init');
      this.enableOAuth2Debug();
    }
  }

}

module.exports = MyApp;
