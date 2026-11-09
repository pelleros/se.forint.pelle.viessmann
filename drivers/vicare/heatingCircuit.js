'use strict';

// Keep existing capability/Flow identifiers while resolving API paths per device.
function resolveCircuitPath(path, circuitId = '0') {
  return path.replace(/^heating\.circuits\.0\./, `heating.circuits.${circuitId}.`);
}

function detectHeatingCircuit(data) {
  const circuits = data.find((item) => item.feature === 'heating.circuits' && item.isEnabled);
  const enabled = circuits?.properties?.enabled?.value;
  const candidates = Array.isArray(enabled)
    ? enabled.map(String)
    : data.filter((item) => item.isEnabled)
      .map((item) => item.feature.match(/^heating\.circuits\.(\d+)\.operating\.modes\.active$/)?.[1])
      .filter((id) => id !== undefined);

  // Preserve the previous choice when circuit 0 is available.
  return candidates.includes('0') ? '0' : (candidates[0] || '0');
}

function normalizeCircuitFeatures(response, circuitId = '0') {
  return {
    ...response,
    data: response.data.filter((item) => {
      const match = item.feature.match(/^heating\.circuits\.(\d+)(?:\.|$)/);
      return !match || match[1] === String(circuitId);
    }).map((item) => ({
      ...item,
      feature: item.feature.replace(/^heating\.circuits\.(\d+)\./, 'heating.circuits.0.'),
    })),
  };
}

module.exports = { resolveCircuitPath, detectHeatingCircuit, normalizeCircuitFeatures };
