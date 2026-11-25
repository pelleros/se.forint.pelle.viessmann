# Test fixtures

Anonymized responses from the Viessmann IoT API, one set per installation type:

- `<model>_features.json`: `GET /iot/v2/features/installations/{id}/gateways/{serial}/devices/0/features`
- `<model>_installations.json`: `GET /iot/v2/equipment/installations?includeGateways=true`, reduced
  to the installation the features belong to

`drivers/vicare/__tests__/device.test.js` runs every `*_features.json` here through
`device.onFeaturesUpdated`, so adding a file adds test coverage.

| Fixture | Source installation | Useful for |
| --- | --- | --- |
| `vitocal_222_*` | Vitocal 222 heat pump, dump from 2026 (current API host) | compressor, heating rod, COP; buffer sensor `notConnected` |
| `vitocal_222_2024_features.json` | Vitocal 222 heat pump, dump from 2024 (before the API host change) | heating circuits 1 and 2 (disabled), solar, ventilation, buffer sensor connected |
| `vitodens_200_e3_*` | Vitodens 200 E3 gas boiler | burner, room temperature; installation with TCU, room control and zigbee devices |
| `vitodens_200_2016_*` | Vitodens 200 gas boiler (2016 model) | burner, boiler temperature; Optolink gateway |
| `vitodens_200_dh_*` | Vitodens 200 E3 gas boiler | burner, common supply temperature; TCU gateway |
| `vitovalor_pt2_*` | Vitovalor PT2 fuel cell with gas boiler | fuel cell phase, mode and statistics; burner |

## Anonymization

All files were produced from real dumps by `scripts/anonymizeDump.js` (via
`scripts/generateFixtures.js`), which uses the rules in `lib/anonymize.js` (the app anonymizes its
troubleshooting data with the same rules, but with placeholders such as `anonymized-serial-1`). Installation ids, gateway, boiler, BMU, device and controller
serials, material numbers, zigbee device ids, addresses, descriptions, building contact fields,
service partner names and user-defined circuit names are replaced by obviously fake values
(`900001`, `9999000000000001`, `zigbee-fa4e000000000001`, `anonymized`, `Heating circuit 0`, ...),
all timestamps are set to `2000-01-01T00:00:00.000Z` and URIs use
`api.viessmann-climatesolutions.com`. Feature names, properties, commands and constraints are
unchanged.

`test/fixtures.privacy.test.js` fails if any fixture contains an identifier that is not from the
fake ranges, so never edit these files by hand to add real data. To add a new installation type,
put the raw dump in the untracked `documentation/json-example-files/` folder, add it to
`scripts/generateFixtures.js` (or run `node scripts/anonymizeDump.js <raw.json> <fixture.json>`)
and run `npm test`. Data copied from the troubleshooting section of the app's settings page works
as input too; its placeholders become fake values.

## Regenerating

Most raw dumps from other users' installations have been deleted on purpose once their fixtures
existed. `npm run fixtures` (`node scripts/generateFixtures.js`) regenerates the fixtures whose raw
dumps are in `documentation/json-example-files/`; for every other fixture it keeps the committed
file as it is and prints a note. The fake values the kept fixtures use are never handed out again,
so a regenerated or new fixture cannot reuse them for another installation. With the same raw
dumps, regenerated fixtures are byte-identical to the committed ones.
