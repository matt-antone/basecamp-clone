import { listNotificationRecipients } from '../lib/repositories';

async function main(){
  const actorId='db7c4ff5-767b-42aa-b81b-b5265b7f36b9';
  const recipients = await listNotificationRecipients(actorId);
  console.log(JSON.stringify({count: recipients.length, recipients}, null, 2));
}

main().catch((e)=>{ console.error(e); process.exit(1); });
