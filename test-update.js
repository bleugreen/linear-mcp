const { LinearService } = require('./dist/services/linear-service');
const { IdentifierResolver } = require('./dist/services/identifier-resolver');
const { LinearClient } = require('@linear/sdk');

async function test() {
  const client = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });
  const resolver = new IdentifierResolver(client);
  const service = new LinearService(client, resolver);

  try {
    console.log('Testing state update for OPS-1...');
    const result = await service.updateIssue({
      id: 'OPS-1',
      stateId: 'Todo'
    });
    console.log('Success:', result);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

test();