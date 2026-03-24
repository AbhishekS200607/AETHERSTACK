require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function test() {
  console.log('Testing Supabase connection and table structure...');
  const testId = Date.now();
  const { data, error } = await supabase.from('submissions').insert([
    { 
      id: testId,
      name: 'Test User',
      email: 'test@example.com',
      project_type: 'Web App',
      budget: '1000',
      message: 'This is a test message'
    }
  ]).select();

  if (error) {
    console.error('FAILED to save submission:');
    console.error('Error Code:', error.code);
    console.error('Error Message:', error.message);
    console.error('Hint:', error.hint);
    console.error('Details:', error.details);
  } else {
    console.log('SUCCESS! Test submission saved:', data);
    // Cleanup
    await supabase.from('submissions').delete().eq('id', testId);
    console.log('Test cleanup successful.');
  }
}

test();
