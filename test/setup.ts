import { createClient } from 'redis';

async function checkRedisConnection() {
  const client = createClient({ url: 'redis://localhost:6379' });
  
  try {
    await client.connect();
    console.log('✅ Redis connection successful');
    await client.quit();
  } catch (error) {
    console.error('❌ Redis connection failed:', error);
    process.exit(1);
  }
}

beforeAll(async () => {
  await checkRedisConnection();
});

jest.setTimeout(30000); 