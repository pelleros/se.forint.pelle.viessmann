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

/*
 * Web API for the settings page: the status and the report for the developer. Users share the
 * report in diagnostic reports, forum posts and e-mails, so it is anonymized (lib/report.js with
 * lib/anonymize.js, TROUBLESHOOTING_STYLE): serials, installation, gateway and device ids become
 * placeholders such as `anonymized-installation-1`, and addresses, descriptions and contact
 * fields are removed. One Anonymizer per app instance keeps the placeholders the same in later
 * reports. Pairing and polling read the API directly and are not affected.
 */

const { Anonymizer, TROUBLESHOOTING_STYLE } = require('./lib/anonymize');
const { ApiQuota, DAILY_LIMIT, nextReset } = require('./lib/apiQuota');
const { collectReport, summarizeReport } = require('./lib/report');

const anonymizers = new WeakMap();

function anonymizerFor(homey) {
  if (!anonymizers.has(homey)) anonymizers.set(homey, new Anonymizer({ style: TROUBLESHOOTING_STYLE }));
  return anonymizers.get(homey);
}

module.exports = {
  /*
    Health for the settings page: per Viessmann login the API calls the app used today and plans
    per day, per device its update interval, last successful update and last error. Nothing here
    calls the API.
  */
  async getHealth({ homey }) {
    const driver = homey.drivers.getDriver('vicare');
    const devices = driver.getDevices();
    const quota = ApiQuota.for(homey);
    const sessions = Object.keys(homey.app.getSavedOAuth2Sessions?.() || {});
    for (const device of devices) {
      const sessionId = device.getStoreValue('OAuth2SessionId');
      if (sessionId && !sessions.includes(sessionId)) sessions.push(sessionId);
    }
    const accountOf = (device) => sessions.indexOf(device.getStoreValue('OAuth2SessionId')) + 1;
    return {
      limit: DAILY_LIMIT,
      resetsAt: new Date(nextReset(Date.now())).toISOString(),
      accounts: sessions.map((sessionId, index) => ({
        account: index + 1,
        usedToday: quota.usedToday(sessionId),
        plannedPerDay: driver.plannedCallsPerDay(sessionId),
        devices: devices.filter((device) => device.getStoreValue('OAuth2SessionId') === sessionId).length,
      })),
      devices: devices.map((device) => ({
        name: device.getName(),
        account: accountOf(device),
        available: device.getAvailable(),
        intervalMinutes: Math.round(driver._calculatePollInterval(device) / 60000),
        eventLogMinutes: Number(device.getPollSetting?.('eventLog')) || 0,
        ...device.getMonitor().health,
      })),
    };
  },

  /*
    One-step report for the developer: the installations and every device's features of the
    first login, anonymized. The compact summary goes to the app's log, so that a diagnostic
    report the user sends from the Homey app carries it; the full report is returned for copying.
  */
  async getReport({ homey }) {
    try {
      const oAuth2Client = homey.app.getFirstSavedOAuth2Client();
      const report = await collectReport(oAuth2Client, { appVersion: homey.manifest?.version, anonymizer: anonymizerFor(homey) });
      const summary = summarizeReport(report);
      for (const line of summary) homey.app.log(line);
      return { report, summaryLines: summary.length };
    } catch (error) {
      homey.error('Error in getReport API:', error);
      throw error;
    }
  },

};
