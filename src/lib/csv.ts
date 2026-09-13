export function sessionsToCsv(
  rows: {
    name: string;
    employeeId: string;
    loginAt: string;
    logoutAt: string | null;
    source: string;
    notes: string | null;
  }[],
  timeZone: string,
): string {
  const header = "Name,Employee ID,Login,Logout,Source,Notes";
  const escape = (v: string) => `"${v.replaceAll('"', '""')}"`;
  const body = rows
    .map((r) =>
      [
        r.name,
        r.employeeId,
        new Date(r.loginAt).toLocaleString("en-GB", { timeZone }),
        r.logoutAt ? new Date(r.logoutAt).toLocaleString("en-GB", { timeZone }) : "",
        r.source,
        r.notes ?? "",
      ]
        .map(escape)
        .join(","),
    )
    .join("\n");
  return `${header}\n${body}`;
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
