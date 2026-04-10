import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.AI_CONFIG_DIR = path.join(__dirname, 'fixtures', 'ai-config');
const { handleToolCall } = await import('../src/index.js');

describe('ai-config-provider tools', () => {
  it('read_skill_content: returns content if skill exists', async () => {
    const result = await handleToolCall('read_skill_content', { tool_id: 'skill:test-skill' });
    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain('# Test Skill');
  });

  it('read_skill_content: returns error if skill does not exist', async () => {
    const result = await handleToolCall('read_skill_content', { tool_id: 'skill:non-existent' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Tool record not found');
  });

  it('execute_mcp_tool: executes downstream mcp tool correctly and sets cwd', async () => {
    // test-mcp returns its process.cwd() when get_cwd tool is called
    const result = await handleToolCall('execute_mcp_tool', {
      target_server_id: 'mcp:test-mcp',
      tool_name: 'get_cwd',
      tool_args: {}
    });

    expect(result.isError).not.toBe(true);
    // The cwd should be the test-mcp directory, not the provider directory!
    const expectedCwd = path.join(process.env.AI_CONFIG_DIR!, 'skills/custom/test-mcp');
    expect(result.content[0].text).toBe(expectedCwd);
  });
});
