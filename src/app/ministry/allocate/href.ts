/**
 * The allocation screen's address: a district and, optionally, one of its DS offices (REL-1), and a recorded
 * letter open as a pop-up over it (REL-10).
 */
export const allocateHref = (districtId: number | null, dsOfficeId: number | null, open: string | null = null) => {
  const query = new URLSearchParams();
  if (districtId !== null) query.set("districtId", String(districtId));
  if (districtId !== null && dsOfficeId !== null) query.set("dsOfficeId", String(dsOfficeId));
  if (open !== null) query.set("open", open);
  const text = query.toString();
  return text ? `/ministry/allocate?${text}` : "/ministry/allocate";
};
