import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envFile = fs.readFileSync('.env', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const match = line.replace('\r', '').match(/^([^=]+)=(.*)$/);
  if (match) env[match[1]] = match[2];
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY;
const email = 'admin@verify.me';
const password = 'pass@123';

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing URL/Key");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runAudit() {
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError) {
    console.error("Auth Error (admin):", authError);
    // try the email from .env just to verify it's the right credentials format
    const fallbackEmail = env.E2E_STAFF_EMAIL;
    const fallbackPassword = env.E2E_STAFF_PASSWORD;
    const fallbackRes = await supabase.auth.signInWithPassword({ email: fallbackEmail, password: fallbackPassword });
    if (fallbackRes.error) {
      console.error("Auth Error (staff):", fallbackRes.error);
      process.exit(1);
    } else {
      console.log("Logged in fallback as:", fallbackRes.data.user.email);
    }
  } else {
    console.log("Logged in as:", authData.user.email);
  }
  
  // Check if we are admin
  const { data: roleData } = await supabase.rpc('my_role');
  console.log("Role:", roleData);

  console.log("\n--- 1. EVENTS ---");
  const { data: events, error: eventsError } = await supabase.from('events').select('id, name, event_date, status, created_at');
  if (eventsError) console.log("Events Error:", eventsError);
  else console.log(JSON.stringify(events, null, 2));

  console.log("\n--- 2. FORMS ---");
  const { data: forms, error: formsError } = await supabase.from('forms').select('id, event_id, name, created_at');
  if (formsError) console.log("Forms Error:", formsError);
  else console.log(JSON.stringify(forms, null, 2));

  console.log("\n--- 3. FORM FIELDS ---");
  const { data: formFields, error: formFieldsError } = await supabase.from('form_fields')
    .select('id, form_id, field_key, label, field_type, options')
    .in('field_key', ['sex', 'pwd', 'first_time_job_seeker', 'returning_ofw', 'returning_worker', 'interested_in_skills_training']);
  if (formFieldsError) console.log("Form Fields Error:", formFieldsError);
  else console.log(JSON.stringify(formFields, null, 2));

  console.log("\n--- 4. REGISTRATIONS DUPLICATE ANALYSIS ---");
  const { data: registrations, error: registrationsError } = await supabase.from('registrations')
    .select('id, event_id, email, mobile_number, first_name, last_name');
  if (registrationsError) console.log("Registrations Error:", registrationsError);
  else {
    const eventCounts = {};
    const emailToEvents = {};
    const mobileToEvents = {};
    const sameEventEmailDups = {};
    const sameEventMobileDups = {};
    
    registrations.forEach(r => {
      // Basic count
      eventCounts[r.event_id] = (eventCounts[r.event_id] || 0) + 1;
      
      const email = r.email.toLowerCase().trim();
      const mobile = r.mobile_number.replace(/[^0-9]/g, '');
      
      // Tracking cross event and same event for email
      if (!emailToEvents[email]) emailToEvents[email] = [];
      if (emailToEvents[email].includes(r.event_id)) {
        if (!sameEventEmailDups[r.event_id]) sameEventEmailDups[r.event_id] = 0;
        sameEventEmailDups[r.event_id]++;
      } else {
        emailToEvents[email].push(r.event_id);
      }
      
      // Tracking cross event and same event for mobile
      if (!mobileToEvents[mobile]) mobileToEvents[mobile] = [];
      if (mobileToEvents[mobile].includes(r.event_id)) {
        if (!sameEventMobileDups[r.event_id]) sameEventMobileDups[r.event_id] = 0;
        sameEventMobileDups[r.event_id]++;
      } else {
        mobileToEvents[mobile].push(r.event_id);
      }
    });
    
    const eventsList = Object.keys(eventCounts);
    
    // Cross event email count
    let bothEventsEmailCount = 0;
    Object.values(emailToEvents).forEach(events => {
      if (events.length > 1) bothEventsEmailCount++;
    });
    
    // Cross event mobile count
    let bothEventsMobileCount = 0;
    Object.values(mobileToEvents).forEach(events => {
      if (events.length > 1) bothEventsMobileCount++;
    });

    console.log("Total registrations:", registrations.length);
    console.log("Registrations per event:", eventCounts);
    
    console.log("\nCross-Event Repeat Applicants:");
    console.log(`- By Email (appeared in >1 event): ${bothEventsEmailCount}`);
    console.log(`- By Mobile (appeared in >1 event): ${bothEventsMobileCount}`);
    
    console.log("\nSame-Event Duplicates:");
    console.log(`- By Email:`, sameEventEmailDups);
    console.log(`- By Mobile:`, sameEventMobileDups);
  }

  console.log("\n--- 5. CHECK-INS ---");
  const { data: checkIns, error: checkInsError } = await supabase.from('check_ins')
    .select('id, registration_id, event_id, status, scanned_at, override_reason');
  if (checkInsError) console.log("Check-ins Error:", checkInsError);
  else {
    const checkInSummary = {};
    checkIns.forEach(c => {
      if (!checkInSummary[c.event_id]) checkInSummary[c.event_id] = { total: 0, min_date: c.scanned_at, max_date: c.scanned_at };
      const summary = checkInSummary[c.event_id];
      summary.total++;
      if (c.scanned_at < summary.min_date) summary.min_date = c.scanned_at;
      if (c.scanned_at > summary.max_date) summary.max_date = c.scanned_at;
    });
    console.log(JSON.stringify(checkInSummary, null, 2));
  }
}

runAudit().catch(console.error);
