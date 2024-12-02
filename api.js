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

module.exports = {
  async getInstallations({ homey }) {
    try {
      const oAuth2Client = homey.app.getFirstSavedOAuth2Client();
      if (!oAuth2Client) throw new Error('No OAuth2Client found');
      return await oAuth2Client.getInstallations();
    } catch (error) {
      homey.error('Error in getInstallations API:', error);
      throw error;
    }
  },

  async getFeatures({ homey, body }) {
    console.log('Received body:', body);
    try {
      const { deviceId } = body;
      if (!deviceId) throw new Error('Device ID is required');
      
      const driver = homey.drivers.getDriver('vicare');
      const devices = driver.getDevices();
      const device = devices.find((d) => d.getData().id === deviceId);

      if (!device) throw new Error(`No device found with ID: ${deviceId}`);
      return await device.getFeatures(false);
    } catch (error) {
      homey.error('Error in getFeatures API:', error);
      throw error;
    }
  },

  async getDevices({ homey }) {
    try {
      const driver = homey.drivers.getDriver('vicare');
      const devices = driver.getDevices();
      if (!devices || devices.length === 0) throw new Error('No device found');

      const devicesData = [];
      for (const device of devices) {
        const { id } = device.getData();
        devicesData.push({
          deviceId: id,
          name: device.getName(),
        });
      }
      return devicesData;
    } catch (error) {
      homey.error('Error in getDevices API:', error);
      throw error;
    }
  },

};
