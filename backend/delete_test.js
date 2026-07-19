require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

async function deleteTest() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  
  const { error } = await supabase
    .from('gyms')
    .delete()
    .eq('email', 'test@gmail.com');
    
  if (error) console.error('Error deleting:', error.message);
  else console.log('Successfully deleted test@gmail.com');
}

deleteTest();
