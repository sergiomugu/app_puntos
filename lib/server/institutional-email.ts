export const INSTITUTIONAL_DOMAIN_SUFFIX = "unrc.edu.ar";

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isInstitutionalDomain(value: unknown) {
  if (typeof value !== "string") return false;
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  if (domain === INSTITUTIONAL_DOMAIN_SUFFIX) return true;
  if (!domain.endsWith(`.${INSTITUTIONAL_DOMAIN_SUFFIX}`)) return false;
  const prefix = domain.slice(
    0,
    -(INSTITUTIONAL_DOMAIN_SUFFIX.length + 1),
  );
  return prefix.length > 0 && prefix.split(".").every((label) => DNS_LABEL.test(label));
}

export function isInstitutionalEmail(value: unknown) {
  if (typeof value !== "string") return false;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || /\s/.test(email)) return false;
  const separator = email.lastIndexOf("@");
  if (separator <= 0 || separator !== email.indexOf("@")) return false;
  const localPart = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  return localPart.length <= 64 && isInstitutionalDomain(domain);
}

export function institutionalEmailRequirement() {
  return "El correo debe pertenecer a unrc.edu.ar o a uno de sus subdominios institucionales (por ejemplo, ac.unrc.edu.ar, eco.unrc.edu.ar, exa.unrc.edu.ar o ing.unrc.edu.ar).";
}
