require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

async function createUser() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  
  const email = 'test@gmail.com';
  const password = 'password123';
  const hash = await bcrypt.hash(password, 12);
  
  const { data, error } = await supabase.from('gyms').insert([
    {
      owner_name: 'Test Owner',
      gym_name: 'Test Gym',
      phone: '1234567890',
      email: email,
      auth_password_hash: hash
    }
  ]);
  
  if (error) {
    console.error('Error creating user:', error.message);
  } else {
    console.log(`Successfully created user: ${email} with password: ${password}`);
  }
}

createUser();
