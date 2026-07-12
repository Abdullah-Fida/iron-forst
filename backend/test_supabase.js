require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

async function testSupabase() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase.from('gyms').select('id').limit(1);
  console.log('Error:', error);
  console.log('Data:', data);
}
testSupabase();
