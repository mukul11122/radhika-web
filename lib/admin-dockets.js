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
  const pages=Math.max(1,Math.ceil(filtered.length/50)), page=Math.min(pages,Math.max(1,parseInt(query.page,10)||1));
  return {ok:true,total:filtered.length,page,pages,dates:[...dates].sort((a,b)=>b[0].localeCompare(a[0])).map(([date,count])=>({date,count})),items:filtered.slice((page-1)*50,page*50)};
}
function register(app,{db,stockAuth,courierTrackUrl}) {
  app.get('/api/admin/dockets',stockAuth,async(req,res)=>{
    res.set('Cache-Control','no-store');
    try {const pool=await db.getPool();const [rows]=await pool.query('SELECT id,mobile,docket_no,courier,tracking,status,dispatch_date,organization,items,boxes,store_owner FROM dockets');const result=records(rows,req.query);result.items=result.items.map(r=>({...r,courierUrl:courierTrackUrl(r.courier,r.tracking || r.docket_no || 'lookup')}));res.json(result);}
    catch(e){res.status(500).json({ok:false,message:'Docket records could not be loaded. Please try again.'})}
  });
}
module.exports={register,records,dateKey};
