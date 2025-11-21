
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🚀 Starting server with 4GB memory limit...');

const serverProcess = spawn('node', [
  '--max-old-space-size=4096',
  'server.js'
], {
  stdio: 'inherit',
  shell: true
});

serverProcess.on('close', (code) => {
  console.log(`✅ Server process exited with code ${code}`);
});

serverProcess.on('error', (err) => {
  console.error('❌ Failed to start server:', err);
});