const SECTIONS = Object.freeze(['dashboard','orders','priority','docket-priority','dispatch-report','employee-workload','reorder','customer-history','exports','alerts','operations','kendras','demands','stock','dockets','employees']);
const allowed = new Set(SECTIONS), ready = new WeakMap();
function setup(pool) {
  if (!ready.has(pool)) ready.set(pool, pool.query("CREATE TABLE IF NOT EXISTS employee_access (employee_id VARCHAR(36) PRIMARY KEY, sections LONGTEXT NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)").catch(error => { ready.delete(pool); throw error; }));
  return ready.get(pool);
}
function validateSections(value) {
  if (!Array.isArray(value) || value.length > SECTIONS.length || value.some(s => typeof s !== 'string' || !allowed.has(s)) || new Set(value).size !== value.length) throw Error('Invalid employee sections.');
  return value;
}
async function getSections(pool, id) {
  await setup(pool);
  const [rows] = await pool.query('SELECT sections FROM employee_access WHERE employee_id=?', [id]);
  if (!rows.length) return [];
  try { return validateSections(JSON.parse(rows[0].sections)); } catch { return []; }
}
async function authenticate(db, authorization) {
  const token = require('./employees').verify(authorization), pool=await db.getPool();
  await require('./employees').setup(pool);
  const [rows]=await pool.query('SELECT id,username,name,active,session_version FROM employees WHERE id=?',[token.id]);
  const person=rows[0]; if(!person || !person.active || Number(person.session_version)!==Number(token.ver)) throw Error('Employee session expired.');
  return {id:person.id,name:person.name,username:person.username,sections:await getSections(pool,person.id)};
}
function requiredSection(method,path) {
  if (/^\/api\/admin\/employees(?:\/|$)/.test(path)) return null;
  if (/^\/api\/admin\/backups(?:\/|$)/.test(path) || path === '/api/admin/operations/clear-failures') return null;
  if (/^\/api\/admin\/orders\/[^/]+\/status$/.test(path)) return method==='POST'?'orders':null;
  if (/^\/api\/admin\/orders\/[^/]+\/history$/.test(path)) return method==='GET'?'orders':null;
  if (path==='/api/admin/orders') return method==='GET'?'orders':null;
  if (path==='/api/admin/dashboard') return method==='GET'?'dashboard':null;
  if (path==='/api/admin/order-priority') return method==='GET'?'priority':null;
  if (path==='/api/admin/docket-priority') return method==='GET'?'docket-priority':null;
  if (path==='/api/admin/dispatch-performance') return method==='GET'?'dispatch-report':null;
  if (path==='/api/admin/employee-workload') return method==='GET'?'employee-workload':null;
  if (path==='/api/admin/reorder-suggestions') return method==='GET'?'reorder':null;
  if (path==='/api/admin/customer-orders') return method==='GET'?'customer-history':null;
  if (path==='/api/admin/export-records') return method==='GET'?'exports':null;
  if (path==='/api/admin/stock-alerts') return method==='GET'?'alerts':null;
  if (path==='/api/admin/operations') return method==='GET'?'operations':null;
  if (path==='/api/admin/kendras' || /^\/api\/admin\/kendras\//.test(path)) return 'kendras';
  if (path==='/api/admin/demands' || /^\/api\/admin\/demands\//.test(path)) return 'demands';
  if (path==='/api/admin/stock-records' || path==='/api/admin/stock-records/remove') return 'stock';
  if (path==='/api/admin/dockets') return method==='GET'?'dockets':null;
  if (path==='/api/admin/employee-progress' || path==='/api/admin/employee-reports') return method==='GET'?'employees':null;
  return null;
}
function register(app, {db, stockAuth}) {
  app.get('/api/employee/access', async(req,res)=>{ res.set('Cache-Control','no-store'); try { const person=await authenticate(db,req.headers.authorization); res.json({ok:true,name:person.name,sections:person.sections}); } catch(error) { res.status(401).json({ok:false,message:'Employee session expired. Please sign in again.'}); } });
  app.get('/api/admin/employees/:id/access', stockAuth, async(req,res)=>{
    res.set('Cache-Control','no-store');
    try { const pool=await db.getPool(); await require('./employees').setup(pool); const [rows]=await pool.query('SELECT id FROM employees WHERE id=?',[req.params.id]); if(!rows.length)return res.status(404).json({ok:false,message:'Employee not found.'}); res.json({ok:true,sections:await getSections(pool,req.params.id),available:SECTIONS}); }
    catch(error){res.status(503).json({ok:false,message:'Employee access could not be loaded.'});}
  });
  app.put('/api/admin/employees/:id/access', stockAuth, async(req,res)=>{
    res.set('Cache-Control','no-store');
    let sections; try { sections=validateSections(req.body?.sections); } catch(error){return res.status(400).json({ok:false,message:error.message});}
    try { const pool=await db.getPool(); await require('./employees').setup(pool); await setup(pool); const [rows]=await pool.query('SELECT id FROM employees WHERE id=?',[req.params.id]);if(!rows.length)return res.status(404).json({ok:false,message:'Employee not found.'});await pool.query('INSERT INTO employee_access (employee_id,sections) VALUES (?,?) ON DUPLICATE KEY UPDATE sections=VALUES(sections)',[req.params.id,JSON.stringify(sections)]);res.json({ok:true,sections,message:'Employee access saved.'}); }
    catch(error){res.status(503).json({ok:false,message:'Employee access could not be saved.'});}
  });
}
module.exports = {SECTIONS,setup,getSections,validateSections,authenticate,requiredSection,register};
