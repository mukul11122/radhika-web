function dateKey(value) {
  const text = String(value || '').trim(), m = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0,10) : '';
}
function records(rows, query) {
  const q = String(query.q || '').trim().toLowerCase().slice(0,100), date = String(query.date || '');
  const dates = new Map();
  const searched = rows.filter(r => !q || Object.values(r).some(v => String(v || '').toLowerCase().includes(q)));
  searched.forEach(r => {const key=dateKey(r.dispatch_date); dates.set(key,(dates.get(key)||0)+1)});
  const filtered = searched.filter(r => !date || (date === 'unknown' ? !dateKey(r.dispatch_date) : dateKey(r.dispatch_date) === date));
  const keys = ['dispatch_date','organization','store_owner','mobile','docket_no','courier','tracking','status','boxes','items'];
  const sort = keys.includes(query.sort) ? query.sort : 'dispatch_date';
  const direction = query.direction === 'asc' ? 1 : -1;
  const value = r => sort === 'dispatch_date' ? dateKey(r[sort]) : String(r[sort] || '').trim().replace(sort === 'organization' ? /^(pmbjk|pmjbk|pmbi)/i : /^$/, '');
  filtered.sort((a,b) => {
    const x = value(a), y = value(b);
    if (!x || !y) return x ? -1 : y ? 1 : b.id-a.id;
    return direction * x.localeCompare(y, 'en', {numeric:true,sensitivity:'base'}) || b.id-a.id;
  });
  const requestedSize = Number(query.limit);
  const limit = [10, 20, 50, 100, 200].includes(requestedSize) ? requestedSize : 50;
  const pages=Math.max(1,Math.ceil(filtered.length/limit)), page=Math.min(pages,Math.max(1,parseInt(query.page,10)||1));
  return {ok:true,total:filtered.length,page,pages,dates:[...dates].sort((a,b)=>b[0].localeCompare(a[0])).map(([date,count])=>({date,count})),items:filtered.slice((page-1)*limit,page*limit)};
}
function docketRankings(rows, now = new Date()) {
  const today = require('./order-insights').dateKey(now), monday = new Date(today + 'T00:00:00Z');
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const starts = { weekly: monday.toISOString().slice(0, 10), monthly: today.slice(0, 7) + '-01', yearly: today.slice(0, 4) + '-01-01' };
  const groups = Object.fromEntries(Object.keys(starts).map(k => [k, new Map()]));
  for (const row of rows) {
    const day = dateKey(row.dispatch_date);
    const parsed = new Date(day + 'T00:00:00Z');
    if (!day || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== day) continue;
    const store = String(row.organization || '').trim().replace(/^(pmbjk|pmjbk|pmbi)[\s_-]*/i, '').trim().toUpperCase();
    if (!store) continue;
    for (const key of Object.keys(starts)) if (day >= starts[key] && day <= today) groups[key].set(store, (groups[key].get(store) || 0) + 1);
  }
  return { today, starts, rankings: Object.fromEntries(Object.entries(groups).map(([key, group]) => [key, [...group].map(([storeCode, count]) => ({storeCode, count})).sort((a,b) => b.count - a.count || a.storeCode.localeCompare(b.storeCode, 'en', {numeric:true}))])) };
}
function register(app,{db,stockAuth,courierTrackUrl}) {
  app.get('/api/admin/docket-priority',stockAuth,async(req,res)=>{
    res.set('Cache-Control','no-store');
    try { const pool=await db.getPool(); const [rows]=await pool.query('SELECT dispatch_date,organization FROM dockets'); res.json({ok:true,...docketRankings(rows)}); }
    catch(e){res.status(500).json({ok:false,message:'Docket rankings could not be loaded. Please try again.'});}
  });
  app.get('/api/admin/dockets',stockAuth,async(req,res)=>{
    res.set('Cache-Control','no-store');
    try {const pool=await db.getPool();const [rows]=await pool.query('SELECT id,mobile,docket_no,courier,tracking,status,dispatch_date,organization,items,boxes,store_owner FROM dockets');const result=records(rows,req.query);result.items=result.items.map(r=>({...r,courierUrl:courierTrackUrl(r.courier,r.tracking || r.docket_no || 'lookup')}));res.json(result);}
    catch(e){res.status(500).json({ok:false,message:'Docket records could not be loaded. Please try again.'})}
  });
}
module.exports={register,records,dateKey,docketRankings};
