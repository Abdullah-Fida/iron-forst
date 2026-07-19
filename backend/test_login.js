require('dotenv').config({ path: '.env' });
const { supabase } = require('./db/supabase');
const bcrypt = require('bcryptjs');

async function testLogin() {
  const email = 'test@gmail.com';
  const password = 'password123';
  
  console.log('Querying Supabase for email:', email);
  const { data: gym, error } = await supabase
    .from('gyms')
    .select('*, auth_password_hash')
    .eq('email', email.trim().toLowerCase())
    .single();

  if (error) {
    console.error('Supabase Error:', error);
    return;
  }
  
  if (!gym) {
    console.log('Gym not found!');
    return;
  }
  
  console.log('Found Gym:', gym.email, 'ID:', gym.id);
  const storedValue = gym.auth_password_hash || '';
  const [actualHash] = storedValue.split('::');
  
  const valid = await bcrypt.compare(password, actualHash);
  console.log('Password valid:', valid);
}

testLogin();
