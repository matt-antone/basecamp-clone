import { listNotificationRecipients } from '../lib/repositories';

async function main(){
  const recipients = await listNotificationRecipients();
  console.log(JSON.stringify({count: recipients.length, recipients}, null, 2));
}

main().catch((e)=>{ console.error(e); process.exit(1); });
