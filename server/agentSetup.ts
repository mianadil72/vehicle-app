import { AIProjectClient } from '@azure/ai-projects';
import { DefaultAzureCredential } from '@azure/identity';
import { AGENT_INSTRUCTIONS, AGENT_TOOLS } from './agentTools.ts';
import { AGENT_NAME } from './chat.ts';

/**
 * `npm run agent:setup`: publishes a new version of the Foundry agent with the instructions and
 * function tools from server/agentTools.ts. Run it once, and again whenever those change.
 * Other tools already on the agent (e.g. a Foundry toolbox / MCP tool added in the portal) are kept.
 * Needs PROJECT_ENDPOINT in .env (and MODEL_DEPLOYMENT_NAME for a brand-new agent), plus `az login`.
 */

const endpoint = process.env.PROJECT_ENDPOINT;
if (!endpoint) {
  console.error('Set PROJECT_ENDPOINT in .env first.');
  process.exit(1);
}

const project = new AIProjectClient(endpoint, new DefaultAzureCredential());

type Tool = { type: string; name?: string } & Record<string, unknown>;
let existing: { model?: string; tools?: Tool[] } | undefined;
try {
  const latest = (await project.agents.get(AGENT_NAME)).versions.latest;
  existing = latest.definition as typeof existing;
} catch (err) {
  if ((err as { statusCode?: number }).statusCode !== 404) throw err; // 404: a new agent
}

const ours = new Set(AGENT_TOOLS.map((t) => t.name));
const kept = (existing?.tools ?? []).filter((t) => !(t.type === 'function' && t.name && ours.has(t.name)));
const model = process.env.MODEL_DEPLOYMENT_NAME || existing?.model;
if (!model) {
  console.error('Set MODEL_DEPLOYMENT_NAME in .env (the agent does not exist yet, so there is no model to reuse).');
  process.exit(1);
}

const version = await project.agents.createVersion(AGENT_NAME, {
  kind: 'prompt',
  model,
  instructions: AGENT_INSTRUCTIONS,
  tools: [...kept, ...AGENT_TOOLS] as typeof AGENT_TOOLS,
});
const names = [...kept.map((t) => (t.server_label as string | undefined) ?? t.name ?? t.type), ...ours];
console.log(`Published ${version.name} version ${version.version} (model ${model}, tools: ${names.join(', ')})`);
