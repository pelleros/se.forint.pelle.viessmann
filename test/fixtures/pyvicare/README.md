# PyViCare device responses

Feature responses of Viessmann devices from [PyViCare](https://github.com/openviess/PyViCare), the
Python library for the Viessmann API. They let the tests cover many more models than the
installation types in [`test/fixtures/`](..).

| | |
| --- | --- |
| Source | <https://github.com/openviess/PyViCare>, folder `tests/response/` |
| Commit | [`5e48411f736c87a0d4b00e8dfb7b915170b75841`](https://github.com/openviess/PyViCare/tree/5e48411f736c87a0d4b00e8dfb7b915170b75841/tests/response) (2026-11-25) |
| Copyright | The PyViCare contributors |
| License | Apache License 2.0, copy in [LICENSE](LICENSE) (PyViCare has no NOTICE file) |

## Files

Every file directly in `tests/response/` at that commit, under its original name (57 files):
`Ecotronic.json`, `RoomControl.json`, `RoomControlOne.json`, `Solar.json`, `TCU300_ethernet.json`,
`VitoairFs300E.json`, `Vitocal111S.json`, `Vitocal151A.json`, `Vitocal200.json`,
`Vitocal200A_OutdoorUnit.json`, `Vitocal200A_SystemController.json`,
`Vitocal200S-with-Vitovent300W.json`, `Vitocal200S.json`, `Vitocal200S_AWB-M-E-AC-201.D10.json`,
`Vitocal200S_E8NEV.json`, `Vitocal222S-with-Vitovent.json`, `Vitocal222S.json`, `Vitocal250A.json`,
`Vitocal250A_NoiseReduction.json`, `Vitocal250A_TwoCircuits.json`, `Vitocal252.json`,
`Vitocal252A.json`, `Vitocal262A_T2H-R290.json`, `Vitocal300G_CU401B.json`,
`Vitocal333G-with-Vitovent300F.json`, `Vitocal333G.json`, `Vitocaldens222F.json`,
`Vitocharge03.json`, `Vitocharge05.json`, `VitochargeEvolution08.json`, `VitoconnectOpto1.json`,
`VitoconnectOpto2.json`, `Vitodens050W.json`, `Vitodens100NA.json`, `Vitodens100W.json`,
`Vitodens100W_B1HC-26.json`, `Vitodens111W.json`, `Vitodens200W.json`, `Vitodens200W_2.json`,
`Vitodens200W_B2HA.json`, `Vitodens200W_B2HF.json`, `Vitodens222W.json`, `Vitodens300W.json`,
`Vitodens300W_B3HF-19.json`, `Vitodens333F.json`, `Vitodens343F_B3UF.json`,
`Vitodens_100_BHC_0421.json`, `VitolaUniferral.json`, `Vitoladens300-C_J3RA.json`,
`Vitopure350.json`, `VitosetAqua.json`, `VitovalorPT2.json`, `zigbee_zk03838_fht_channel.json`,
`zigbee_zk03838_fht_main.json`, `zigbee_zk03839_cs.json`, `zigbee_zk03840_trv.json`,
`zigbee_zk05390_repeater.json`.

Not taken: the sub-folders `deviceerrors/`, `errors/`, `events/` and `gatewayWithDevices/`
(error responses, event lists and responses for a whole gateway rather than for one device).

## Modifications

These are not PyViCare's original files. Feature names, properties, commands and constraints are
unchanged; only identifiers, timestamps, host names and formatting were changed, in two steps:

1. PyViCare replaces identifiers with `#` characters (for example `################` for a gateway
   serial), which `scripts/anonymizeDump.js` does not recognize inside URIs. In every `uri` and in
   the `gatewayId`, `gatewaySerial`, `deviceId` and `installationId` fields, `#` was replaced by
   `0`, and URIs on the retired host `api.viessmann-platform.io` were moved to
   `api.viessmann-climatesolutions.com`. One zigbee hardware address (the value of
   `device.zigbee.parent.id` in `zigbee_zk03839_cs.json`) was masked with `#`, as PyViCare does in
   its other zigbee files.
2. Each file was then anonymized on its own with `node scripts/anonymizeDump.js <in> <out>` (rules
   in `lib/anonymize.js`), like the fixtures in `test/fixtures/`. Besides the masked values from step 1, this replaced
   identifiers that were still in the files (installation ids in the URIs of two files, other
   placeholder serials such as `XXXXXX`, and user-defined heating circuit names) with fake
   values (installation `900001`, serials
   `9999000000000001`, ..., zigbee device ids `zigbee-fa4e000000000001`, circuit names
   `Heating circuit N`), set every timestamp to `2000-01-01T00:00:00.000Z`, moved URIs from
   `api.viessmann.com` to `api.viessmann-climatesolutions.com` and re-indented the JSON with two
   spaces.

## Tests

- `drivers/vicare/__tests__/pyvicare.models.test.js` feeds every file through
  `device.onFeaturesUpdated` and checks the mapped capabilities.
- `drivers/vicare/__tests__/pyvicare.upgrade.test.js` pairs a device from every file the way
  1.0.14 did and starts it on the current code.
- `test/pyvicare.privacy.test.js` fails if a file still contains something for the anonymizer to
  replace, so never add files here without step 2.

## Updating

Take the files from a newer PyViCare commit, repeat both steps, update the commit and the file
list above, and run `npm test`.
