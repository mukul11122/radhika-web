(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OrderBulk = factory();
})(typeof window === 'undefined' ? this : window, function () {
  async function update(entries, send, progress = () => {}) {
    const unique = [...new Map(entries.map((entry) => [entry.id, entry])).values()];
    if (!unique.length || unique.length > 30)
      throw Error('Select between 1 and 30 orders on this page.');
    const results = [];
    for (const entry of unique) {
      try {
        const out = await send(entry);
        results.push({ id: entry.id, label: entry.label, ok: true, message: out.message });
      } catch (e) {
        results.push({
          id: entry.id,
          label: entry.label,
          ok: false,
          message: e.message || 'Update failed. Retry this order.',
        });
      }
      progress(results.length, unique.length);
    }
    return results;
  }
  return { update };
});
