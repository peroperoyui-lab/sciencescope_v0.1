import { Type } from '@earendil-works/pi-ai';
import { abortable } from './requests.js';

function fieldSchema(field) {
  const { properties, items, ...schema } = field;
  delete schema.required;
  if (properties) Object.assign(schema, objectSchema(properties));
  if (items) schema.items = fieldSchema(items);
  return schema;
}

function objectSchema(fields) {
  return {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(fields).map(([name, field]) => [name, fieldSchema(field)]),
    ),
    required: Object.entries(fields)
      .filter(([, field]) => field.required === true)
      .map(([name]) => name),
  };
}

/**
 * @param {import('../port.js').ToolSpec[]} specs
 * @param {import('../port.js').ToolHandler} handler
 * @returns {import('@earendil-works/pi-agent-core').AgentTool[]}
 */
export function agentTools(specs, handler) {
  return specs.map((spec) => ({
    name: spec.name,
    label: spec.name,
    description: spec.description,
    parameters: Type.Unsafe(objectSchema(spec.parameters)),
    async execute(callId, args, signal) {
      const result = await abortable(handler({ name: spec.name, args, callId, signal }), signal);
      return { content: [{ type: 'text', text: JSON.stringify(result ?? null) }], details: result };
    },
  }));
}
