const allowed = {
  lowStock: ['code', 'name', 'quantity'],
  expiring: ['code', 'name', 'expiry', 'days', 'quantity'],
  expired: ['code', 'name', 'expiry', 'quantity'],
};
function selection(section, query = {}) {
  const keys = allowed[section] || allowed.lowStock;
  return {
    key: keys.includes(query[section + 'Sort'])
      ? query[section + 'Sort']
      : section === 'lowStock'
        ? 'quantity'
        : 'expiry',
    direction: query[section + 'Direction'] === 'desc' ? -1 : 1,
  };
}
function orderBy(section, query) {
  const { key, direction } = selection(section, query),
    dir = direction === 1 ? 'ASC' : 'DESC';
  if (key === 'code')
    return (
      "CASE WHEN code REGEXP '^[0-9]+$' THEN 0 ELSE 1 END,CAST(code AS UNSIGNED) " +
      dir +
      ',code ' +
      dir +
      (section === 'lowStock' ? '' : ',ordinal')
    );
  if (key === 'name')
    return 'name ' + dir + (section === 'lowStock' ? ',code' : ',batch ' + dir + ',ordinal');
  if (key === 'quantity')
    return 'quantity ' + dir + (section === 'lowStock' ? ',code' : ',ordinal');
  return 'expiry ' + dir + ',ordinal';
}
function sort(section, rows, query) {
  const { key, direction } = selection(section, query);
  return rows.sort((a, b) => {
    const comparison = ['quantity', 'days'].includes(key)
      ? Number(a[key]) - Number(b[key])
      : String(a[key] ?? '').localeCompare(String(b[key] ?? ''), undefined, {
          numeric: key === 'code',
          sensitivity: 'base',
        });
    return (
      comparison * direction ||
      String(a.code).localeCompare(String(b.code), undefined, { numeric: true }) ||
      String(a.batch || '').localeCompare(String(b.batch || ''))
    );
  });
}
module.exports = { selection, orderBy, sort };
