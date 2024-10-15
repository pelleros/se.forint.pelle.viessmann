'use strict';

const { OAuth2Driver } = require('homey-oauth2app');

module.exports = class MyBrandDriver extends OAuth2Driver {

  async onOAuth2Init() {
    this.log('onOAuth2Init');
    // Register Flow Cards etc.
  }

  async onPairListDevices({ oAuth2Client }) {
    this.log('onPairListDevices');
    const installations = await oAuth2Client.getInstallations();
    const gateways = await oAuth2Client.getGatewaySerial();
    this.log('gatewaySerial:', gateways.data[0].serial);
    const devices = await oAuth2Client.getDeviceId({installationId:installations.data[0].id, gatewaySerial:gateways.data[0].serial}); 
    this.log('onPairListDevices::installations:', JSON.stringify(devices,null,3));
    this.log('deviceId', devices.data[0].id);
    return [{
      name: 'Viessmann',
      data: {
        installationId: installations.data[0].id,
        gatewaySerial: gateways.data[0].serial,
        deviceId: devices.data[0].id,
      },
    }];
  }
}

