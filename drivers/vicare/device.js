'use strict';

const { OAuth2Device } = require('homey-oauth2app');

const POLL_INTERVAL = 1000 * 60 * 2; // 1 min

module.exports = class MyBrandDevice extends OAuth2Device {

  static TEMP_HOT_WATER = 'heating.dhw.sensors.temperature.hotWaterStorage';
  static TEMP_OUTSIDE = 'heating.sensors.temperature.outside';
  static POWER_CONSUMPTION_HEATING = 'heating.power.consumption.heating';
  static POWER_CONSUMPTION_DHW = 'heating.power.consumption.dhw';

  async onOAuth2Init() {
    // await this.oAuth2Client.getThingState()
    //   .then(async state => {
    //     await this.setCapabilityValue('onoff', !!state.on);
    //   });

    const { installationId, gatewaySerial, deviceId } = this.getData();
    this._installationId = installationId;
    this._gatewaySerial = gatewaySerial;
    this._deviceId = deviceId;

    // this.getGatewayFeatures()
    //   .then((response) => {
    //     this.log('device.onOAuth2Init::res:', JSON.stringify(response, null, 3));
    //   }).catch((err) => {
    //     this.log('device::onOAuth2Init error:', err);
    //   });

    // this.getDhwPower()
    //   .then((response) => {
    //     this.log('device.onOAuth2Init::res:', JSON.stringify(response, null, 3));
    //   }).catch((err) => {
    //     this.log('device::onOAuth2Init error:', err);
    //   });

    // this.oAuth2Client.getDeviceId({
    //   installationId: this._installationId,
    //   gatewaySerial: this._gatewaySerial,
    // })
    //   .then((response) => {
    //     this.log('device.onOAuth2Init::res:', JSON.stringify(response, null, 3));
    //   }).catch((err) => {
    //     this.log('device::onOAuth2Init error:', err);
    //   });

    this._sync = this._sync.bind(this);

    this._sync();
    this._syncInterval = setInterval(this._sync, POLL_INTERVAL);
  }

  async onOAuth2Deleted() {
    // Clean up here
  }

  /*
		Hot Water methods
	*/
  async getHotWaterTemp() {
    return this.oAuth2Client.getHotWaterTemp({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
    });
  }

  async getDhwPower() {
    return this.oAuth2Client.getDhwPower({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
    });
  }

  async getGatewayFeatures() {
    return this.oAuth2Client.getGatewayFeatures({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
    });
  }

  async getFeatures() {
    return this.oAuth2Client.getFeatures({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
    });
  }

  _sync() {
    this.getFeatures()
      .then((response) => {
        this.setAvailable();

        //write response to log
        // only log when debugging        
        if (process.env.DEBUG) {
          this.log('device._sync::res:', JSON.stringify(response, null, 3));
        }

        /*
        const jsonData = JSON.parse(response);
        this.log('device._sync::res:', JSON.stringify(jsonData, null, 3));
        const featuresToFind = [
          MyBrandDevice.TEMP_HOT_WATER,
          MyBrandDevice.TEMP_OUTSIDE,
          MyBrandDevice.POWER_CONSUMPTION_DHW,
          MyBrandDevice.POWER_CONSUMPTION_HEATING,
        ];

        // Filtrerar ut objekt som matchar någon av de angivna features
        const foundFeatures = response.data.filter((item) => featuresToFind.includes(item.feature));

        // Extraherar 'value' för varje hittad feature
        const values = foundFeatures.map((item) => ({
          feature: item.feature,
          value: item.properties.value.value,
        }));
*/
        //this.log('device._sync::response:');
        //this.log(JSON.stringify(response, null, 3));
        const hwTemp = response.data.find((item) => item.feature === MyBrandDevice.TEMP_HOT_WATER);
        this.setCapabilityValue('measure_temperature.hotwater', hwTemp.properties.value.value);

        const outsideTemp = response.data.find((item) => item.feature === MyBrandDevice.TEMP_OUTSIDE);
        this.setCapabilityValue('measure_temperature.outside', outsideTemp.properties.value.value);

        /*
        const powerDhw = response.data.find((item) => item.feature === MyBrandDevice.POWER_CONSUMPTION_DHW);
        this.setCapabilityValue('measure_power.hotwater', powerDhw.properties.value.value);

        const powerHeating = response.data.find((item) => item.feature === MyBrandDevice.POWER_CONSUMPTION_HEATING);
        this.setCapabilityValue('measure_power.heating', powerHeating.properties.value.value);
        */

        /**
        let desiredFeature = "heating.dhw.sensors.temperature.hotWaterStorage";

        let result = jsonData.data.find(obj => obj.feature === desiredFeature);

        if(result && result.properties && result.properties.value && result.properties.value.value) {
            let value = result.properties.value.value;
          } else {
            this.error('Failed to parse data');
            this.setUnavailable('Failed to parse data');
            log('Failed to parse data')
          }
          */
        // this.log('device._sync::res:', JSON.stringify(res, null, 3));
        //this.setCapabilityValue('measure_temperature.hotwater', res.data.properties.value.value);
        // this.setCapabilityValue('target_temperature', res.target_temperature);
      })
      .catch((err) => {
        this.error(err);
        this.setUnavailable(err);
      });
  }

};
