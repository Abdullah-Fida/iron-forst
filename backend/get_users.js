require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

async function getUsers() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: gyms, error } = await supabase.from('gyms').select('email, gym_name, auth_password_hash');
  if (error) console.error('Error:', error.message);
  else console.log('Gyms Users:', gyms);
}

getUsers();
