import fs from 'fs';
const storeFile = '/tmp/evo_test_b02_experiment_storage.json';
const data = JSON.parse(fs.readFileSync(storeFile, 'utf-8'));
const runs = JSON.parse(data.evo_experiment_runs || '[]');
console.log('Total runs recorded:', runs.length);
runs.forEach((r, idx) => {
  console.log(`Run ${idx+1}: ID=${r.id}, Group=${r.group}, CapId=${r.capabilityId}, CapVer=${r.capabilityVersion}, Duration=${r.executionDurationMs}ms, Success=${r.success}`);
});
