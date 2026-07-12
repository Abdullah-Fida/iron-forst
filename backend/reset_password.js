require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

async function resetPassword() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  
  const password = 'CoreGym2026!';
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(password, salt);
  
  const { data, error } = await supabase
    .from('gyms')
    .update({ auth_password_hash: hash })
    .eq('email', 'ironfost@gmail.com')
    .select();
    
  if (error) console.error('Error updating:', error.message);
  else console.log('Successfully updated ironfost@gmail.com password to "CoreGym2026!"!');
}

resetPassword();
