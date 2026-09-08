import fs from 'fs';
const storeFile = '/tmp/evo_test_b02_experiment_storage.json';
const data = JSON.parse(fs.readFileSync(storeFile, 'utf-8'));
const objectives = JSON.parse(data.evo_objectives || '[]');
console.log('Objectives:', JSON.stringify(objectives, null, 2));
const runs = JSON.parse(data.evo_experiment_runs || '[]');
console.log('Runs:', JSON.stringify(runs, null, 2));
