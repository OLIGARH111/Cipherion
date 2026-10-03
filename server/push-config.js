import webpush from 'web-push';

// Keep the signing identity in the persistent database, never on Render's disk.
// Existing environment keys remain authoritative; a partial override is an error.
export function pushConfig(db, env=process.env) {
  const publicKey=env.VAPID_PUBLIC_KEY,privateKey=env.VAPID_PRIVATE_KEY;
  const subject=env.VAPID_SUBJECT||env.PUBLIC_ORIGIN||env.RENDER_EXTERNAL_URL||'https://cipherion-messenger.onrender.com';
  if(publicKey||privateKey)return publicKey&&privateKey?{publicKey,privateKey,subject}:null;
  db.exec('CREATE TABLE IF NOT EXISTS push_configuration(id INTEGER PRIMARY KEY CHECK(id=1),public_key TEXT NOT NULL,private_key TEXT NOT NULL)');
  let keys=db.prepare('SELECT public_key,private_key FROM push_configuration WHERE id=1').get();
  if(!keys){
    const generated=webpush.generateVAPIDKeys();
    db.prepare('INSERT OR IGNORE INTO push_configuration VALUES(1,?,?)').run(generated.publicKey,generated.privateKey);
    keys=db.prepare('SELECT public_key,private_key FROM push_configuration WHERE id=1').get();
  }
  return {publicKey:keys.public_key,privateKey:keys.private_key,subject};
}
