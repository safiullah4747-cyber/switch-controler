'use strict';
const express=require('express'), helmet=require('helmet'),cookieParser=require('cookie-parser');
const crypto=require('crypto'), {Pool}=require('pg'), bcrypt=require('bcryptjs');
const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:false}));app.use(express.json({limit:'16kb'}));app.use(cookieParser());
// Reject cross-site browser writes; device calls authenticate separately with a secret.
app.use((req,res,next)=>{if(!['POST','PATCH','DELETE','PUT'].includes(req.method)||req.path.startsWith('/api/device/'))return next();const origin=req.get('origin');if(origin){try{const u=new URL(origin);if(u.host!==req.get('host')||u.protocol!=='https:'&&process.env.NODE_ENV==='production')return send(res,403,{error:'Cross-site request blocked'});}catch{return send(res,403,{error:'Invalid origin'})}}next()});
const pool=new Pool({connectionString:process.env.DATABASE_URL, max:5, connectionTimeoutMillis:10000});
const SECRET=process.env.SESSION_SECRET;
if(!SECRET||SECRET.length<24||!process.env.DATABASE_URL)throw Error('Set DATABASE_URL and SESSION_SECRET');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const rand=n=>crypto.randomBytes(n).toString('hex');
const hmac=x=>crypto.createHmac('sha256',SECRET).update(x).digest('hex');
const safeEq=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const send=(res,code,obj)=>res.status(code).json(obj);
const emailOK=e=>typeof e==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)&&e.length<=180;
const pending=new Map();const attempts=new Map();
function undoLimit(k){const v=attempts.get(k);if(v?.length)v.pop();}
function limit(k,max=8,windowMs=15*60000){const t=Date.now(),v=attempts.get(k)||[];const recent=v.filter(x=>t-x<windowMs);recent.push(t);attempts.set(k,recent);return recent.length<=max;}
function sessionCookie(res,uid){const expiry=Date.now()+7*86400000;const data=`${uid}.${expiry}`;res.cookie('ss_session',`${data}.${hmac(data)}`,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:7*86400000,path:'/'});}
async function auth(req,res,next){const c=req.cookies.ss_session||'',p=c.split('.');if(p.length!==3||!safeEq(hmac(`${p[0]}.${p[1]}`),p[2])||Number(p[1])<Date.now())return send(res,401,{error:'Sign in required'});req.uid=Number(p[0]);if(!Number.isSafeInteger(req.uid))return send(res,401,{error:'Invalid session'});next();}
async function db(sql,params=[]){return pool.query(sql,params);}
async function init(){await db(`CREATE TABLE IF NOT EXISTS users(id BIGSERIAL PRIMARY KEY,email TEXT UNIQUE NOT NULL,created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,key_hash TEXT NOT NULL,online_at TIMESTAMPTZ,last_state BOOLEAN DEFAULT false,last_ip TEXT,created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS commands(id BIGSERIAL PRIMARY KEY,device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,action TEXT NOT NULL CHECK(action IN ('on','off','countdown','cancel')),minutes INTEGER,created_at TIMESTAMPTZ DEFAULT now(),acked_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS schedules(id BIGSERIAL PRIMARY KEY,device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,hour INTEGER NOT NULL,minute INTEGER NOT NULL,action TEXT NOT NULL CHECK(action IN ('on','off')),enabled BOOLEAN DEFAULT true,utc_offset INTEGER DEFAULT 300,last_run TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS admin_audit(id BIGSERIAL PRIMARY KEY,admin_id BIGINT NOT NULL,device_id TEXT NOT NULL,owner_email TEXT NOT NULL,action TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT now());`);}
// Signup uses one-time email verification. Existing verified accounts log in with password.
const normalizeEmail=v=>String(v||'').trim().toLowerCase();
const passwordOK=p=>typeof p==='string'&&p.length>=10&&Buffer.byteLength(p,'utf8')<=72;
async function sendOTP(email,purpose){
  const apiKey=process.env.RESEND_API_KEY,from=process.env.RESEND_FROM;
  if(!apiKey||!from)throw Object.assign(Error('Resend is not configured'),{status:503});
  const otp=String(crypto.randomInt(100000,1000000));
  let response;
  try {
    response=await fetch('https://api.resend.com/emails',{
      method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({from,to:[email],subject:purpose==='signup'?'Smart Switch - Verify Account':'Smart Switch - Reset Password',text:`Your Smart Switch code is ${otp}. It expires in 10 minutes. Never share it.`}),
      signal:AbortSignal.timeout(12000)
    });
  }catch(err){console.error('Resend connection failed:',err.name);throw Object.assign(Error('Email service temporarily unavailable. Try again later.'),{status:503});}
  if(!response.ok){console.error('Resend rejected email with HTTP status',response.status);throw Object.assign(Error('Email could not be sent. Check Resend settings or try later.'),{status:503});}
  pending.set(purpose+':'+email,{digest:hmac(purpose+':'+email+':'+otp),expires:Date.now()+600000,tries:0});
}
function checkOTP(email,purpose,otp){const key=purpose+':'+email,p=pending.get(key);if(!p||Date.now()>p.expires||p.tries++>=5||!/^\d{6}$/.test(otp)||!safeEq(p.digest,hmac(key+':'+otp)))return false;pending.delete(key);return true;}
app.post('/api/auth/signup/request',async(req,res,next)=>{try{
 const email=normalizeEmail(req.body.email),password=req.body.password;
 if(!emailOK(email)||!passwordOK(password))return send(res,400,{error:'Enter valid email and password of at least 10 characters'});
 if(!limit('signup-ip:'+req.ip,6)||!limit('signup-email:'+email,4))return send(res,429,{error:'Please wait before requesting another code'});
 const existing=await db('SELECT id FROM users WHERE email=$1',[email]);
 if(existing.rows.length)return send(res,409,{error:'Account already exists. Please log in or reset your password.'});
 const passwordHash=await bcrypt.hash(password,12);
 try{await sendOTP(email,'signup')}catch(e){undoLimit('signup-ip:'+req.ip);undoLimit('signup-email:'+email);throw e}
 const entry=pending.get('signup:'+email);entry.passwordHash=passwordHash;
 send(res,200,{ok:true,message:'Verification code sent'});
}catch(e){next(e)}});
app.post('/api/auth/signup/verify',async(req,res,next)=>{try{
 const email=normalizeEmail(req.body.email),otp=String(req.body.code||'');
 if(!limit('verify-ip:'+req.ip,15))return send(res,429,{error:'Too many attempts'});
 const p=pending.get('signup:'+email);if(!p||!p.passwordHash)return send(res,401,{error:'Signup code expired. Request another.'});
 const passwordHash=p.passwordHash;
 if(!checkOTP(email,'signup',otp))return send(res,401,{error:'Invalid or expired code'});
 const r=await db('INSERT INTO users(email,password_hash,verified) VALUES($1,$2,true) ON CONFLICT(email) DO NOTHING RETURNING id',[email,passwordHash]);
 if(!r.rows.length)return send(res,409,{error:'Account already exists'});
 sessionCookie(res,r.rows[0].id);send(res,200,{ok:true});
}catch(e){next(e)}});
app.post('/api/auth/login',async(req,res,next)=>{try{
 const email=normalizeEmail(req.body.email),password=String(req.body.password||'');
 if(!limit('login-ip:'+req.ip,20)||!limit('login-email:'+email,10))return send(res,429,{error:'Too many attempts. Try later.'});
 const r=await db('SELECT id,password_hash FROM users WHERE email=$1 AND verified=true',[email]);
 if(!r.rows.length||!r.rows[0].password_hash||!(await bcrypt.compare(password,r.rows[0].password_hash)))return send(res,401,{error:'Invalid email or password'});
 sessionCookie(res,r.rows[0].id);send(res,200,{ok:true});
}catch(e){next(e)}});
app.post('/api/auth/reset/request',async(req,res,next)=>{try{
 const email=normalizeEmail(req.body.email);if(!emailOK(email))return send(res,400,{error:'Invalid email'});
 if(!limit('reset-ip:'+req.ip,6)||!limit('reset-email:'+email,4))return send(res,429,{error:'Please wait before requesting another code'});
 const r=await db('SELECT id FROM users WHERE email=$1',[email]);
 if(r.rows.length){try{await sendOTP(email,'reset')}catch(e){undoLimit('reset-ip:'+req.ip);undoLimit('reset-email:'+email);throw e}}
 send(res,200,{ok:true,message:'If the account exists, a reset code has been sent.'});
}catch(e){next(e)}});
app.post('/api/auth/reset/confirm',async(req,res,next)=>{try{
 const email=normalizeEmail(req.body.email),otp=String(req.body.code||''),password=req.body.password;
 if(!passwordOK(password))return send(res,400,{error:'Password must be at least 10 characters'});
 if(!limit('reset-verify:'+req.ip,15))return send(res,429,{error:'Too many attempts'});
 if(!checkOTP(email,'reset',otp))return send(res,401,{error:'Invalid or expired code'});
 await db('UPDATE users SET password_hash=$1 WHERE email=$2',[await bcrypt.hash(password,12),email]);
 send(res,200,{ok:true,message:'Password updated. Please log in.'});
}catch(e){next(e)}});
app.post('/api/auth/logout',(req,res)=>{res.clearCookie('ss_session',{path:'/'});send(res,200,{ok:true})});
app.get('/api/me',auth,async(req,res,next)=>{try{const r=await db('SELECT email FROM users WHERE id=$1',[req.uid]);send(res,200,{email:r.rows[0]?.email||''});}catch(e){next(e)}});
app.get('/api/devices',auth,async(req,res,next)=>{try{const r=await db('SELECT id,name,last_state,online_at,created_at FROM devices WHERE owner_id=$1 ORDER BY created_at DESC',[req.uid]);send(res,200,{devices:r.rows.map(x=>({...x,online:!!x.online_at&&Date.now()-new Date(x.online_at).getTime()<90000}))});}catch(e){next(e)}});
// Device-initiated account linking. ESP-01 must call over verified HTTPS after local setup.
// A stable random 12-hex device ID and 48-hex device secret must be stored on the physical device.
// This is NOT a manufacturer-attested identity; physical tamper resistance is outside ESP-01 capabilities.
app.post('/api/device/claim',async(req,res,next)=>{try{
 const email=normalizeEmail(req.body.email),password=String(req.body.password||'');
 const id=String(req.body.device_id||''),key=String(req.body.device_secret||'');
 const name=String(req.body.name||'My Switch').trim().slice(0,40)||'My Switch';
 if(!limit('claim-ip:'+req.ip,8))return send(res,429,{error:'Too many pairing attempts'});
 if(!emailOK(email)||!/^[0-9a-f]{12}$/.test(id)||!/^[0-9a-f]{48}$/.test(key))return send(res,400,{error:'Invalid pairing information'});
 const u=await db('SELECT id,password_hash FROM users WHERE email=$1 AND verified=true',[email]);
 if(!u.rows.length||!u.rows[0].password_hash||!(await bcrypt.compare(password,u.rows[0].password_hash)))return send(res,401,{error:'Invalid account credentials'});
 const uid=u.rows[0].id;
 // Atomic first-claim; an already owned device cannot be transferred by this endpoint.
 const r=await db(`INSERT INTO devices(id,owner_id,name,key_hash) VALUES($1,$2,$3,$4)
 ON CONFLICT(id) DO NOTHING RETURNING id`,[id,uid,name,hash(key)]);
 if(!r.rows.length){const old=await db('SELECT owner_id,key_hash FROM devices WHERE id=$1',[id]);
   if(String(old.rows[0]?.owner_id)!==String(uid)||!safeEq(old.rows[0]?.key_hash||'',hash(key)))return send(res,409,{error:'Device already registered or credentials do not match. Owner/admin release required.'});
 }
 send(res,200,{ok:true,device_id:id,message:'Device linked to your account'});
}catch(e){next(e)}});
async function owned(req,res,next){try{const r=await db('SELECT * FROM devices WHERE id=$1 AND owner_id=$2',[req.params.id,req.uid]);if(!r.rows.length)return send(res,404,{error:'Device not found'});req.device=r.rows[0];next();}catch(e){next(e)}}
app.patch('/api/devices/:id',auth,owned,async(req,res,next)=>{try{const name=String(req.body.name||'').trim();if(!name||name.length>40)return send(res,400,{error:'Invalid name'});await db('UPDATE devices SET name=$1 WHERE id=$2',[name,req.params.id]);send(res,200,{ok:true});}catch(e){next(e)}});
app.post('/api/devices/:id/release',auth,owned,async(req,res,next)=>{try{
 const password=String(req.body.password||'');
 if(!limit('release:'+req.uid,8))return send(res,429,{error:'Too many attempts'});
 const u=await db('SELECT password_hash FROM users WHERE id=$1',[req.uid]);
 if(!u.rows[0]?.password_hash||!(await bcrypt.compare(password,u.rows[0].password_hash)))return send(res,403,{error:'Password confirmation failed'});
 // Delete credentials, schedules, queued commands atomically via cascading FK.
 // Old firmware credentials will no longer authenticate; the next owner must provision new credentials locally.
 await db('DELETE FROM devices WHERE id=$1 AND owner_id=$2',[req.params.id,req.uid]);
 send(res,200,{ok:true,message:'Device released. Old credentials revoked. Reprovision device before another account can use it.'});
}catch(e){next(e)}});
app.post('/api/devices/:id/command',auth,owned,async(req,res,next)=>{try{const action=req.body.action,minutes=Number(req.body.minutes);if(!['on','off','countdown','cancel'].includes(action))return send(res,400,{error:'Invalid action'});if(action==='countdown'&&(!Number.isInteger(minutes)||minutes<1||minutes>10080))return send(res,400,{error:'Minutes 1..10080'});await db('INSERT INTO commands(device_id,action,minutes) VALUES($1,$2,$3)',[req.params.id,action,action==='countdown'?minutes:null]);send(res,200,{queued:true,note:'Command will run when device polls while online'});}catch(e){next(e)}});
app.get('/api/devices/:id/schedules',auth,owned,async(req,res,next)=>{try{const r=await db('SELECT id,hour,minute,action,enabled,utc_offset FROM schedules WHERE device_id=$1 ORDER BY hour,minute',[req.params.id]);send(res,200,{schedules:r.rows});}catch(e){next(e)}});
app.post('/api/devices/:id/schedules',auth,owned,async(req,res,next)=>{try{const {hour,minute,action}=req.body,offset=Number(req.body.utc_offset??300);if(!Number.isInteger(hour)||hour<0||hour>23||!Number.isInteger(minute)||minute<0||minute>59||!['on','off'].includes(action)||!Number.isInteger(offset)||offset< -720||offset>840)return send(res,400,{error:'Invalid schedule'});const count=await db('SELECT count(*)::int AS n FROM schedules WHERE device_id=$1',[req.params.id]);if(count.rows[0].n>=16)return send(res,400,{error:'Maximum 16 cloud schedules'});await db('INSERT INTO schedules(device_id,hour,minute,action,utc_offset) VALUES($1,$2,$3,$4,$5)',[req.params.id,hour,minute,action,offset]);send(res,200,{ok:true});}catch(e){next(e)}});
app.patch('/api/devices/:id/schedules/:sid',auth,owned,async(req,res,next)=>{try{await db('UPDATE schedules SET enabled=$1 WHERE id=$2 AND device_id=$3',[!!req.body.enabled,req.params.sid,req.params.id]);send(res,200,{ok:true});}catch(e){next(e)}});
app.delete('/api/devices/:id/schedules/:sid',auth,owned,async(req,res,next)=>{try{await db('DELETE FROM schedules WHERE id=$1 AND device_id=$2',[req.params.sid,req.params.id]);send(res,200,{ok:true});}catch(e){next(e)}});
async function deviceAuth(req,res,next){try{const id=String(req.get('x-device-id')||''),key=String(req.get('x-device-key')||'');if(!/^[0-9a-f]{12}$/.test(id)||!/^[0-9a-f]{48}$/.test(key))return send(res,401,{error:'Invalid device credentials'});const r=await db('SELECT id,key_hash FROM devices WHERE id=$1',[id]);if(!r.rows.length||!safeEq(r.rows[0].key_hash,hash(key)))return send(res,401,{error:'Unauthorized device'});req.did=id;next();}catch(e){next(e)}}
app.post('/api/device/poll',deviceAuth,async(req,res,next)=>{try{const state=req.body.on===true;await db('UPDATE devices SET last_state=$1,online_at=now() WHERE id=$2',[state,req.did]);const r=await db("SELECT id,action,minutes FROM commands WHERE device_id=$1 AND acked_at IS NULL AND created_at > now() - interval '90 seconds' ORDER BY id ASC LIMIT 1",[req.did]);send(res,200,{command:r.rows[0]||null});}catch(e){next(e)}});
app.post('/api/device/ack',deviceAuth,async(req,res,next)=>{try{const id=Number(req.body.id);if(!Number.isSafeInteger(id))return send(res,400,{error:'Invalid command id'});await db('UPDATE commands SET acked_at=now() WHERE id=$1 AND device_id=$2',[id,req.did]);send(res,200,{ok:true});}catch(e){next(e)}});
// Admin role is assigned ONLY by ADMIN_EMAIL environment variable, never by public signup.
async function adminOnly(req,res,next){try{
 const r=await db('SELECT email FROM users WHERE id=$1 AND verified=true',[req.uid]);
 const adminEmail=normalizeEmail(process.env.ADMIN_EMAIL);
 if(!adminEmail||!r.rows.length||r.rows[0].email!==adminEmail)return send(res,403,{error:'Admin access only'});
 next();
}catch(e){next(e)}}
app.get('/api/admin/users',auth,adminOnly,async(req,res,next)=>{try{
 const email=normalizeEmail(req.query.email);
 if(!emailOK(email))return send(res,400,{error:'Enter exact user email'});
 if(!limit('admin-search:'+req.uid,60))return send(res,429,{error:'Too many searches'});
 const r=await db(`SELECT u.email,d.id,d.name,d.last_state,d.online_at,d.created_at
 FROM users u LEFT JOIN devices d ON d.owner_id=u.id WHERE u.email=$1 ORDER BY d.created_at DESC`,[email]);
 send(res,200,{email,found:r.rows.length>0,devices:r.rows.filter(x=>x.id).map(x=>({...x,online:!!x.online_at&&Date.now()-new Date(x.online_at).getTime()<90000}))});
}catch(e){next(e)}});
app.post('/api/admin/devices/:id/release',auth,adminOnly,async(req,res,next)=>{try{
 if(!limit('admin-release:'+req.uid,6,3600000))return send(res,429,{error:'Release limit reached'});
 const password=String(req.body.password||'');
 const user=await db('SELECT password_hash FROM users WHERE id=$1',[req.uid]);
 if(!user.rows[0]?.password_hash||!(await bcrypt.compare(password,user.rows[0].password_hash)))return send(res,403,{error:'Admin password incorrect'});
 const client=await pool.connect();try{
   await client.query('BEGIN');
   const r=await client.query('SELECT d.id,u.email FROM devices d JOIN users u ON u.id=d.owner_id WHERE d.id=$1 FOR UPDATE OF d',[req.params.id]);
   if(!r.rows.length){await client.query('ROLLBACK');return send(res,404,{error:'Device not found'})}
   await client.query('INSERT INTO admin_audit(admin_id,device_id,owner_email,action) VALUES($1,$2,$3,$4)',[req.uid,r.rows[0].id,r.rows[0].email,'admin_release']);
   await client.query('DELETE FROM devices WHERE id=$1',[req.params.id]);
   await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
 send(res,200,{ok:true,message:'Cloud ownership released; old credentials revoked. Physical firmware may require re-provisioning.'});
}catch(e){next(e)}});
app.get('/admin',auth,adminOnly,(req,res)=>res.sendFile(require('path').join(__dirname,'admin.html')));
app.get('/health',(req,res)=>res.json({ok:true}));
app.use(express.static(__dirname));
app.use((err,req,res,next)=>{console.error(err.message||err);send(res,err.status>=400&&err.status<600?err.status:500,{error:err.status?err.message:'Server error'})});
async function runSchedules(){const now=new Date();const r=await db('SELECT * FROM schedules WHERE enabled=true');for(const s of r.rows){const shifted=new Date(now.getTime()+s.utc_offset*60000);const hh=shifted.getUTCHours(),mm=shifted.getUTCMinutes(),day=shifted.toISOString().slice(0,10);const key=day+':'+hh+':'+mm;if(hh!==s.hour||mm!==s.minute||s.last_run===key)continue;const result=await db('UPDATE schedules SET last_run=$1 WHERE id=$2 AND last_run<>$1 RETURNING id',[key,s.id]);if(result.rowCount)await db('INSERT INTO commands(device_id,action) VALUES($1,$2)',[s.device_id,s.action]);}}
init().then(()=>{const port=process.env.PORT||3000;app.listen(port,()=>console.log('Smart Switch server listening on',port));setInterval(()=>runSchedules().catch(console.error),30000);}).catch(e=>{console.error('Database initialization failed',e);process.exit(1)});
