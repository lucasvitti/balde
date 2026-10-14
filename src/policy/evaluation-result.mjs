export function normalizeVerdict(value) {
  // Ausência ou resposta desconhecida não constitui evidência de aprovação.
  return value === 'pass' ? 'pass' : value === 'fail' ? 'fail' : 'pending';
}

export function gradeCriterionResults(criteria, response) {
  const byId = new Map(
    (Array.isArray(response?.results) ? response.results : [])
      .filter((result) => result && typeof result === 'object')
      .map((result) => [String(result.id), result])
  );
  const results = criteria.map((criterion) => {
    const result = byId.get(String(criterion.id)) || {};
    return {
      id: criterion.id,
      text: criterion.text,
      verdict: normalizeVerdict(result.verdict),
      note: String(result.note || '')
        .replace(/\s+/g, ' ')
        .slice(0, 200)
    };
  });
  const overall = results.some((result) => result.verdict === 'fail')
    ? 'fail'
    : results.length && results.every((result) => result.verdict === 'pass')
      ? 'pass'
      : 'pending';
  return { overall, results };
}
