import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('ai-config-provider', () => {
  it('should start and respond to healthcheck', async () => {
    const aiConfigDir = path.join(__dirname, 'fixtures', 'ai-config');
    const child = spawn('node', ['dist/index.js'], {
      env: { ...process.env, AI_CONFIG_DIR: aiConfigDir, PORT: '8081' },
      cwd: path.resolve(__dirname, '..'),
    });

    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const response = await fetch('http://localhost:8081/healthz');
    const text = await response.text();
    expect(text).toBe('OK');
    expect(response.status).toBe(200);

    child.kill();
  });
});
