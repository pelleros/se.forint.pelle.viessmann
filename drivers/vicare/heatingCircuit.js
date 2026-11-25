'use strict';

// Keep existing capability/Flow identifiers while resolving API paths per device.
function resolveCircuitPath(path, circuitId = '0') {
  return path.replace(/^heating\.circuits\.0\./, `heating.circuits.${circuitId}.`);
}

// The feature entries of a response that the app can read; anything else (null, no feature
// name) is ignored instead of breaking the whole response
function featureEntries(data) {
  return Array.isArray(data)
    ? data.filter((item) => item && typeof item === 'object' && typeof item.feature === 'string')
    : [];
}

function detectHeatingCircuit(rawData, selectedCircuit = 'auto') {
  const data = featureEntries(rawData);
  const circuits = data.find((item) => item.feature === 'heating.circuits' && item.isEnabled);
  const enabled = circuits?.properties?.enabled?.value;
  const candidates = Array.isArray(enabled)
    ? enabled.map(String)
    : data.filter((item) => item.isEnabled)
      .map((item) => item.feature.match(/^heating\.circuits\.(\d+)\.operating\.modes\.active$/)?.[1])
      .filter((id) => id !== undefined);

  if (selectedCircuit !== 'auto') {
    if (!candidates.includes(String(selectedCircuit))) {
      const error = new Error(`Heating circuit ${selectedCircuit} is not available on this installation. `
        + `Available circuits: ${candidates.join(', ') || 'none'}.`);
      error.code = 'heating_circuit_not_available';
      error.circuit = String(selectedCircuit);
      error.available = candidates;
      throw error;
    }
    return String(selectedCircuit);
  }
  // Preserve the previous choice when circuit 0 is available.
  return candidates.includes('0') ? '0' : (candidates[0] || '0');
}

function normalizeCircuitFeatures(response, circuitId = '0') {
  return {
    ...response,
    data: featureEntries(response?.data).filter((item) => {
      const match = item.feature.match(/^heating\.circuits\.(\d+)(?:\.|$)/);
      return !match || match[1] === String(circuitId);
    }).map((item) => ({
      ...item,
      feature: item.feature.replace(/^heating\.circuits\.(\d+)\./, 'heating.circuits.0.'),
    })),
  };
}

module.exports = {
  resolveCircuitPath, detectHeatingCircuit, normalizeCircuitFeatures, featureEntries,
};
