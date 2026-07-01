/**
 * The leading "<DEPT>-FO<YY>-" segment of an auto-generated quotation reference.
 *
 * The department code's trailing two characters are replaced by the first two
 * letters of the author's username, so a reference identifies the PERSON as well
 * as the department: department "ITD1" + user "Yahya" → "ITYA". The 4-hex counter
 * (appended by the caller) is scoped per this prefix and per calendar year, so it
 * keeps its full 65,535/year capacity and stays unique across users.
 *
 * Falls back to the raw department code (or "GEN") when there's no username, and
 * to "GEN" when there's no department.
 */
export function quotationRefPrefix(
  departmentCode: string,
  username: string,
): string {
  const dept = (departmentCode || "GEN").trim().toUpperCase() || "GEN";
  const initials = (username || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 2)
    .toUpperCase();
  // Swap the department's last two chars for the user initials (e.g. the "D1"
  // in "ITD1" → "YA"); on a very short department code, append instead.
  const base = initials
    ? (dept.length > 2 ? dept.slice(0, dept.length - 2) : dept) + initials
    : dept;
  const yy = String(new Date().getFullYear()).slice(-2);
  return `${base}-FO${yy}-`;
}
