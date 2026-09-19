const EMAIL_RE = /[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?:\+\d[\d\s().-]{7,}\d|\b\d{2,4}[\s().-]\d{3}[\s().-]\d{3,4}\b)/g;
const URL_RE = /https?:\/\/[^\s<>'"]+/gi;

export function keepClassifiedItems(items, classifications, profile = {}) {
  const rule = profile.keep;
  return items.filter((_, index) => {
    const result = classifications[index];
    if (!result || result.status !== 'classified') return false;
    if (!rule) return true;
    const values = Array.isArray(rule.choices) ? rule.choices : [];
    return values.includes(result.labels?.[rule.dimension]);
  });
}

export function enrichContactEvidence(item) {
  const text = [item?.text, item?.summary, item?.title].filter(Boolean).join(' ');
  const links = Array.isArray(item?.links) ? item.links.map((link) => typeof link === 'string' ? link : link?.href).filter(Boolean) : [];
  const known = [item?.apply_url, ...(item?.apply_urls ?? []), ...(item?.external_urls ?? []), ...(item?.profile_urls ?? []), ...(item?.company_urls ?? [])].filter(Boolean);
  return {
    emails: unique([...(text.match(EMAIL_RE) ?? []), ...(item?.emails ?? [])]),
    phones: unique([...(text.match(PHONE_RE) ?? []), ...(item?.phones ?? [])]),
    urls: unique([...links, ...known, ...(text.match(URL_RE) ?? [])]),
  };
}

export function unique(values) {
  return [...new Set(values.map((value) => String(value).replace(/[.,);]+$/, '')).filter(Boolean))];
}
