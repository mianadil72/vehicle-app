import type { Request } from 'express';
import { AIProjectClient } from '@azure/ai-projects';
import { DefaultAzureCredential } from '@azure/identity';
import type { ChatReply, ChatVehicle } from '../src/types.ts';
import { runTool } from './agentTools.ts';

/**
 * Customer chat, answered by the Microsoft Foundry agent `FOUNDRY_AGENT_NAME` (default "vehicle-new-agent-gpt-mini").
 * The agent's function tools (server/agentTools.ts) run here, against our database.
 *
 * Auth is DefaultAzureCredential: `az login` on a developer machine, a managed identity in Azure.
 * The identity needs the "Azure AI User" role on the Foundry project.
 */

const endpoint = process.env.PROJECT_ENDPOINT;
export const AGENT_NAME = process.env.FOUNDRY_AGENT_NAME || 'vehicle-new-agent-gpt-mini';
export const CHAT_MESSAGE_MAX_LENGTH = 1000;
const MAX_TOOL_ROUNDS = 4;
const VEHICLES_SHOWN = 5; // matches "at most 5 vehicles" in AGENT_INSTRUCTIONS

export const chatEnabled = () => Boolean(endpoint);

type OpenAIClient = ReturnType<AIProjectClient['getOpenAIClient']>;
let client: OpenAIClient | undefined;
const openai = () => (client ??= new AIProjectClient(endpoint!, new DefaultAzureCredential()).getOpenAIClient());

const agentRef = { body: { agent_reference: { name: AGENT_NAME, type: 'agent_reference' } } };

// --- Conversations ------------------------------------------------------------------------------
// Only conversations this server created are accepted, so a client can't attach to arbitrary ones.
// In memory: a restart starts customers on a fresh conversation, which the widget handles.

const CONVERSATION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_CONVERSATIONS = 2000;
const conversations = new Map<string, number>(); // id → last used

function forget(id: string) {
  conversations.delete(id);
  openai().conversations.delete(id).catch(() => {}); // best effort; Foundry also expires them
}

async function conversationFor(requested: unknown): Promise<string> {
  const now = Date.now();
  for (const [id, used] of conversations) if (now - used > CONVERSATION_TTL_MS) forget(id);
  if (typeof requested === 'string' && conversations.has(requested)) {
    conversations.set(requested, now);
    return requested;
  }
  if (conversations.size >= MAX_CONVERSATIONS) forget(conversations.keys().next().value!);
  const { id } = await openai().conversations.create();
  conversations.set(id, now);
  return id;
}

// --- Rate limit: 20 messages per IP per 5 minutes (each one costs model tokens) -----------------

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 5 * 60 * 1000;
const recent = new Map<string, number[]>();

/** Seconds until this IP may send another message, or 0. Counts the message when allowed. */
export function chatThrottle(req: Request): number {
  const key = req.ip ?? '';
  const now = Date.now();
  const times = (recent.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (times.length >= RATE_LIMIT) return Math.ceil((times[0] + RATE_WINDOW_MS - now) / 1000);
  recent.set(key, [...times, now]);
  if (recent.size > 10_000) recent.delete(recent.keys().next().value!);
  return 0;
}

// --- One customer message → one reply -----------------------------------------------------------

/** `clientKey` identifies the customer (their IP) for the lead-submission rate limit. */
export async function chat(conversationId: unknown, message: string, clientKey: string): Promise<ChatReply> {
  const conversation = await conversationFor(conversationId);
  let vehicles: ChatVehicle[] = [];

  let response = await openai().responses.create(
    { conversation, input: [{ type: 'message', role: 'user', content: message }] },
    agentRef,
  );

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const calls = response.output.filter((item) => item.type === 'function_call');
    if (calls.length === 0) break;
    const outputs = [];
    for (const call of calls) {
      const result = await runTool(call.name, call.arguments, { clientKey });
      if (result.vehicles?.length) vehicles = result.vehicles; // show the latest search
      outputs.push({ type: 'function_call_output' as const, call_id: call.call_id, output: result.output });
    }
    response = await openai().responses.create({ conversation, input: outputs }, agentRef);
  }

  const reply = response.output_text.trim() || "Sorry, I couldn't come up with an answer. Could you rephrase that?";
  return { conversationId: conversation, reply, vehicles: vehicles.slice(0, VEHICLES_SHOWN) };
}
